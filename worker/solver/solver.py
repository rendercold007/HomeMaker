"""
The spatial solver (Phase 4 · Step 2) — deterministic, collision-free placement.

Algorithm (per docs/BackenAndAI.md, Step 4.4):
  1. Grid       — tile the room into `cell_cm` cells (occupancy bitmap).
  2. Obstacles  — mark each door's swing path impassable.
  3. Placement  — for each item, generate candidate (centre, rotation) positions
                  from its rule, in priority order, and take the first whose
                  footprint fits (in-bounds + every covered cell free).
  4. Lock       — occupy those cells so later items can't overlap.

It is DETERMINISTIC: candidate order is fixed, no randomness — the same request
always yields the same result. Cell coverage is computed on cell *interiors*, so
grid-collision-free provably implies continuous (AABB) non-overlap, while letting
items sit flush against walls and each other.

Box convention: an AABB is the tuple (min_x, min_y, max_x, max_y) in cm.
"""

from __future__ import annotations

import math
from typing import Iterable

from .models import (
    Door,
    FurnitureSpec,
    Placement,
    Room,
    SolveRequest,
    SolveResult,
    Wall,
    Window,
)

_EPS = 1e-6

_WALL_ROT: dict[Wall, int] = {
    Wall.TOP: 0,
    Wall.BOTTOM: 180,
    Wall.LEFT: 90,
    Wall.RIGHT: 270,
}


# --------------------------------------------------------------------------- #
# Geometry helpers (pure, also used by the tests).                            #
# --------------------------------------------------------------------------- #

def effective_dims(spec: FurnitureSpec, rotation_deg: int) -> tuple[float, float]:
    """Footprint (x_extent, y_extent) after an orthogonal rotation."""
    if rotation_deg in (90, 270):
        return spec.depth_cm, spec.width_cm
    return spec.width_cm, spec.depth_cm


def aabb(cx: float, cy: float, ew: float, eh: float) -> tuple[float, float, float, float]:
    """AABB centred at (cx, cy) with extents (ew, eh)."""
    return (cx - ew / 2, cy - eh / 2, cx + ew / 2, cy + eh / 2)


def boxes_overlap(a: tuple, b: tuple, eps: float = _EPS) -> bool:
    """True if two AABBs overlap by positive area (edge-touching is not overlap)."""
    return a[0] < b[2] - eps and b[0] < a[2] - eps and a[1] < b[3] - eps and b[1] < a[3] - eps


def door_swing_box(door: Door, room: Room) -> tuple[float, float, float, float]:
    """The rectangle in front of a door that its swing sweeps — impassable."""
    w = door.width_cm
    swing = door.swing_cm if door.swing_cm is not None else w
    p = door.position_cm
    if door.wall is Wall.TOP:
        return (p - w / 2, 0.0, p + w / 2, swing)
    if door.wall is Wall.BOTTOM:
        return (p - w / 2, room.length_cm - swing, p + w / 2, room.length_cm)
    if door.wall is Wall.LEFT:
        return (0.0, p - w / 2, swing, p + w / 2)
    return (room.width_cm - swing, p - w / 2, room.width_cm, p + w / 2)  # RIGHT


# --------------------------------------------------------------------------- #
# Occupancy grid.                                                             #
# --------------------------------------------------------------------------- #

def _grid_dims(room: Room, cell: float) -> tuple[int, int]:
    return (math.ceil(room.width_cm / cell), math.ceil(room.length_cm / cell))  # cols, rows


def _box_cells(box: tuple, cell: float, cols: int, rows: int) -> Iterable[tuple[int, int]]:
    """Cells whose INTERIOR intersects the box interior (clamped to the grid)."""
    min_x, min_y, max_x, max_y = box
    c_lo = max(0, int(math.floor((min_x + _EPS) / cell)))
    c_hi = min(cols - 1, int(math.floor((max_x - _EPS) / cell)))
    r_lo = max(0, int(math.floor((min_y + _EPS) / cell)))
    r_hi = min(rows - 1, int(math.floor((max_y - _EPS) / cell)))
    for r in range(r_lo, r_hi + 1):
        for c in range(c_lo, c_hi + 1):
            yield r, c


def _is_free(grid: list[list[bool]], box: tuple, cell: float) -> bool:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    for r, c in _box_cells(box, cell, cols, rows):
        if grid[r][c]:
            return False
    return True


def _occupy(grid: list[list[bool]], box: tuple, cell: float) -> None:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    for r, c in _box_cells(box, cell, cols, rows):
        grid[r][c] = True


def _in_bounds(box: tuple, req: SolveRequest) -> bool:
    min_x, min_y, max_x, max_y = box
    cl = req.clearance_cm
    room = req.room
    return (
        min_x >= cl - _EPS
        and min_y >= cl - _EPS
        and max_x <= room.width_cm - cl + _EPS
        and max_y <= room.length_cm - cl + _EPS
    )


# --------------------------------------------------------------------------- #
# Candidate generators (each yields (cx, cy, rotation_deg) in priority order). #
# --------------------------------------------------------------------------- #

def _slide(lo: float, hi: float, step: float) -> list[float]:
    """Positions from lo to hi inclusive, every `step`."""
    if lo > hi + 1e-9:
        return []
    out: list[float] = []
    v = lo
    while v <= hi + 1e-9:
        out.append(round(min(v, hi), 4))
        v += step
    if not out or abs(out[-1] - hi) > 1e-9:
        out.append(round(hi, 4))
    return out


def _expand_around(center: float, lo: float, hi: float, step: float) -> list[float]:
    """`center` first (clamped), then alternating outward by `step`, within [lo, hi]."""
    c = min(max(center, lo), hi)
    out = [round(c, 4)]
    k = 1
    while k < 10_000:
        added = False
        for s in (c - k * step, c + k * step):
            if lo - 1e-9 <= s <= hi + 1e-9:
                out.append(round(s, 4))
                added = True
        if not added:
            break
        k += 1
    return out


def _walls_with_openings(req: SolveRequest) -> set[Wall]:
    return {d.wall for d in req.doors} | {w.wall for w in req.windows}


def _wall_candidates(spec, req, solid_only: bool) -> list[tuple[float, float, int]]:
    room = req.room
    step = req.cell_cm
    cl = req.clearance_cm
    open_walls = _walls_with_openings(req)
    # Solid walls first, then walls with openings — stable within each group.
    order = sorted([Wall.TOP, Wall.BOTTOM, Wall.LEFT, Wall.RIGHT], key=lambda w: w in open_walls)
    out: list[tuple[float, float, int]] = []
    for wall in order:
        if solid_only and wall in open_walls:
            continue
        rot = _WALL_ROT[wall]
        ew, eh = effective_dims(spec, rot)
        if wall in (Wall.TOP, Wall.BOTTOM):
            cy = eh / 2 + cl if wall is Wall.TOP else room.length_cm - eh / 2 - cl
            out.extend((cx, cy, rot) for cx in _slide(ew / 2 + cl, room.width_cm - ew / 2 - cl, step))
        else:
            cx = ew / 2 + cl if wall is Wall.LEFT else room.width_cm - ew / 2 - cl
            out.extend((cx, cy, rot) for cy in _slide(eh / 2 + cl, room.length_cm - eh / 2 - cl, step))
    return out


def _near_window_candidates(spec, req) -> list[tuple[float, float, int]]:
    room = req.room
    step = req.cell_cm
    cl = req.clearance_cm
    out: list[tuple[float, float, int]] = []
    for win in req.windows:
        rot = _WALL_ROT[win.wall]
        ew, eh = effective_dims(spec, rot)
        if win.wall in (Wall.TOP, Wall.BOTTOM):
            for depth_off in (0.0, step):
                cy = (eh / 2 + cl + depth_off) if win.wall is Wall.TOP else (room.length_cm - eh / 2 - cl - depth_off)
                for cx in _expand_around(win.position_cm, ew / 2 + cl, room.width_cm - ew / 2 - cl, step):
                    out.append((cx, cy, rot))
        else:
            for depth_off in (0.0, step):
                cx = (ew / 2 + cl + depth_off) if win.wall is Wall.LEFT else (room.width_cm - ew / 2 - cl - depth_off)
                for cy in _expand_around(win.position_cm, eh / 2 + cl, room.length_cm - eh / 2 - cl, step):
                    out.append((cx, cy, rot))
    return out


def _center_candidates(spec, req) -> list[tuple[float, float, int]]:
    room = req.room
    step = req.cell_cm
    cx0, cy0 = room.width_cm / 2, room.length_cm / 2
    out: list[tuple[float, float, int]] = []
    max_r = int(max(room.width_cm, room.length_cm) / step) + 1
    for r in range(max_r + 1):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue  # ring shell only
                out.append((cx0 + dx * step, cy0 + dy * step, 0))
    return out


def _next_to_candidates(spec, ref_id, req, placed) -> list[tuple[float, float, int]]:
    ref = placed.get(ref_id)
    if ref is None:
        return []
    ref_p, ref_spec = ref
    rew, reh = effective_dims(ref_spec, ref_p.rotation_deg)
    rmin_x, rmin_y, rmax_x, rmax_y = aabb(ref_p.x_cm, ref_p.y_cm, rew, reh)
    gap = max(2.0, req.cell_cm / 2)
    ew, eh = effective_dims(spec, 0)
    return [
        (rmax_x + gap + ew / 2, ref_p.y_cm, 0),  # right
        (rmin_x - gap - ew / 2, ref_p.y_cm, 0),  # left
        (ref_p.x_cm, rmin_y - gap - eh / 2, 0),  # above
        (ref_p.x_cm, rmax_y + gap + eh / 2, 0),  # below
    ]


def _anywhere_candidates(spec, req) -> list[tuple[float, float, int]]:
    room = req.room
    step = req.cell_cm
    out: list[tuple[float, float, int]] = []
    for rot in (0, 90):
        ew, eh = effective_dims(spec, rot)
        for cy in _slide(eh / 2, room.length_cm - eh / 2, step):
            for cx in _slide(ew / 2, room.width_cm - ew / 2, step):
                out.append((cx, cy, rot))
    return out


def _candidates(spec, req, placed) -> list[tuple[float, float, int]]:
    rule = spec.rule or "anywhere"
    if rule.startswith("next_to:"):
        return _next_to_candidates(spec, rule.split(":", 1)[1], req, placed)
    if rule == "against_wall":
        return _wall_candidates(spec, req, solid_only=False)
    if rule == "against_solid_wall":
        return _wall_candidates(spec, req, solid_only=True)
    if rule == "near_window":
        return _near_window_candidates(spec, req)
    if rule == "center":
        return _center_candidates(spec, req)
    return _anywhere_candidates(spec, req)


# --------------------------------------------------------------------------- #
# Solve.                                                                      #
# --------------------------------------------------------------------------- #

def solve(req: SolveRequest) -> SolveResult:
    """Place every item collision-free, honouring its rule where possible.

    Items are placed in input order (so a `next_to:<id>` referent must come
    earlier). If an item's rule yields no fit, it falls back to an `anywhere`
    scan, so it is still placed whenever the room has room; only genuinely
    un-fittable items land in `unplaced`.
    """
    cell = req.cell_cm
    cols, rows = _grid_dims(req.room, cell)
    grid = [[False] * cols for _ in range(rows)]
    for door in req.doors:
        _occupy(grid, door_swing_box(door, req.room), cell)
    for box in req.obstacles:  # furniture already in the room (edit add) stays put
        _occupy(grid, box, cell)

    placements: list[Placement] = []
    unplaced: list[str] = []
    placed: dict[str, tuple[Placement, FurnitureSpec]] = {}

    for spec in req.furniture:
        chosen: tuple[float, float, int, tuple] | None = None
        # Rule-specific candidates first, then a generic scan as a safety net.
        for cx, cy, rot in (*_candidates(spec, req, placed), *_anywhere_candidates(spec, req)):
            ew, eh = effective_dims(spec, rot)
            box = aabb(cx, cy, ew, eh)
            if _in_bounds(box, req) and _is_free(grid, box, cell):
                chosen = (cx, cy, rot, box)
                break

        if chosen is None:
            unplaced.append(spec.id)
            continue

        cx, cy, rot, box = chosen
        _occupy(grid, box, cell)
        placement = Placement(spec.id, spec.type, round(cx, 2), round(cy, 2), rot)
        placements.append(placement)
        placed[spec.id] = (placement, spec)

    return SolveResult(placements, unplaced)
