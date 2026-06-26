"""
Multi-room floor-plan generator (Phase 4 — the chat → floor-plan moat).

Deterministic geometry: given the plot and a room program (rooms + types +
relative weights, from the LLM), produce a full editable plan — points, walls,
doors, windows, furniture — in CENTIMETRES (the app's native unit).

Pipeline:
  1. bsp_layout  — recursively slice the plot into non-overlapping room rectangles
                   sized by weight.
  2. build_graph — extract a clean planar wall graph from those rectangles:
                   one Point per corner/junction, walls merged along straight runs,
                   shared walls shared (so dragging a corner moves both rooms).
  3. place_openings — interior doors (a spanning tree so every room is reachable),
                   one entrance door, windows on exterior walls.
  4. furnish     — per-room templates placed by the step-2 solver, in room-local
                   coords, translated to global.

The LLM never sees coordinates; everything here is deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass

from catalog import lookup
from solver import FurnitureSpec, Room, SolveRequest, solve
from templates import template_for

GRID = 10  # snap splits to 10 cm
WALL_THICKNESS = 10
WALL_HEIGHT = 270

Rect = tuple[int, int, int, int]  # x0, y0, x1, y1 (cm)


@dataclass(frozen=True)
class RoomRequest:
    name: str
    type: str
    weight: float = 1.0


@dataclass(frozen=True)
class PlacedRoom:
    name: str
    type: str
    rect: Rect


def _snap(v: float) -> int:
    return int(round(v / GRID) * GRID)


# --------------------------------------------------------------------------- #
# 1. BSP layout                                                               #
# --------------------------------------------------------------------------- #

def bsp_layout(x0: int, y0: int, x1: int, y1: int, rooms: list[RoomRequest]) -> list[PlacedRoom]:
    """Slice the rectangle into one rect per room, sized by weight."""
    if len(rooms) == 1:
        r = rooms[0]
        return [PlacedRoom(r.name, r.type, (x0, y0, x1, y1))]

    total = sum(max(r.weight, 0.01) for r in rooms)
    half = total / 2
    acc = 0.0
    idx = 1
    for k, r in enumerate(rooms):
        acc += max(r.weight, 0.01)
        if acc >= half:
            idx = k + 1
            break
    idx = max(1, min(idx, len(rooms) - 1))

    left, right = rooms[:idx], rooms[idx:]
    frac = sum(max(r.weight, 0.01) for r in left) / total
    w, h = x1 - x0, y1 - y0

    if w >= h:  # split along x (longer side gets the cut)
        xm = max(x0 + GRID, min(_snap(x0 + w * frac), x1 - GRID))
        return bsp_layout(x0, y0, xm, y1, left) + bsp_layout(xm, y0, x1, y1, right)
    ym = max(y0 + GRID, min(_snap(y0 + h * frac), y1 - GRID))
    return bsp_layout(x0, y0, x1, ym, left) + bsp_layout(x0, ym, x1, y1, right)


# --------------------------------------------------------------------------- #
# 2. Wall graph                                                               #
# --------------------------------------------------------------------------- #

def _room_at(rects: list[Rect], x: float, y: float) -> int:
    for idx, (rx0, ry0, rx1, ry1) in enumerate(rects):
        if rx0 < x < rx1 and ry0 < y < ry1:
            return idx
    return -1  # exterior


def _orient(p: tuple[int, int], q: tuple[int, int]) -> str:
    return "h" if p[1] == q[1] else "v"


def build_graph(placed: list[PlacedRoom]):
    """Return (points, walls, rects). points: [{id,x,y}], walls: [{id,a,b}]."""
    rects = [r.rect for r in placed]
    px0 = min(r[0] for r in rects)
    py0 = min(r[1] for r in rects)
    px1 = max(r[2] for r in rects)
    py1 = max(r[3] for r in rects)

    xs = sorted({px0, px1, *(c for r in rects for c in (r[0], r[2]))})
    ys = sorted({py0, py1, *(c for r in rects for c in (r[1], r[3]))})
    ncol, nrow = len(xs) - 1, len(ys) - 1

    # Which room owns each grid cell (by its centre).
    grid = [
        [_room_at(rects, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2) for j in range(nrow)]
        for i in range(ncol)
    ]

    # Unit edges sit between two cells with different owners (incl. exterior).
    edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for i in range(len(xs)):  # vertical lines x = xs[i]
        for j in range(nrow):
            left = grid[i - 1][j] if i > 0 else -1
            right = grid[i][j] if i < ncol else -1
            if left != right:
                edges.add(((i, j), (i, j + 1)))
    for j in range(len(ys)):  # horizontal lines y = ys[j]
        for i in range(ncol):
            below = grid[i][j - 1] if j > 0 else -1
            above = grid[i][j] if j < nrow else -1
            if below != above:
                edges.add(((i, j), (i + 1, j)))

    adj: dict[tuple[int, int], set[tuple[int, int]]] = {}
    for a, b in edges:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)

    def is_vertex(p: tuple[int, int]) -> bool:
        nb = adj.get(p, set())
        if len(nb) != 2:
            return True  # corner, T-junction, or cross
        n1, n2 = tuple(nb)
        return _orient(p, n1) != _orient(p, n2)  # a bend is a vertex; a straight run is not

    vertices = {p for p in adj if is_vertex(p)}

    # Merge straight runs of unit edges between vertices into single walls.
    walls_idx: list[tuple[tuple[int, int], tuple[int, int]]] = []
    seen: set[frozenset] = set()
    for v in vertices:
        for start in adj[v]:
            if frozenset((v, start)) in seen:
                continue
            prev, cur = v, start
            seen.add(frozenset((prev, cur)))
            guard = 0
            while cur not in vertices and guard < len(adj) + 5:
                nxt = next(x for x in adj[cur] if x != prev)
                seen.add(frozenset((cur, nxt)))
                prev, cur = cur, nxt
                guard += 1
            walls_idx.append((v, cur))

    point_id: dict[tuple[int, int], str] = {}
    points: list[dict] = []
    for p in sorted(vertices):
        pid = f"p{len(points)}"
        point_id[p] = pid
        points.append({"id": pid, "x": xs[p[0]], "y": ys[p[1]]})

    walls: list[dict] = []
    for a, b in walls_idx:
        walls.append({"id": f"w{len(walls)}", "a": point_id[a], "b": point_id[b]})

    return points, walls, rects


# --------------------------------------------------------------------------- #
# 3. Openings (doors + windows)                                               #
# --------------------------------------------------------------------------- #

def _wall_len(a: dict, b: dict) -> int:
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])  # axis-aligned


def _wall_sides(wall: dict, pts: dict, rects: list[Rect], eps: float = 1.0) -> tuple[int, int]:
    a, b = pts[wall["a"]], pts[wall["b"]]
    mx, my = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
    if a["x"] == b["x"]:  # vertical → left / right
        return _room_at(rects, mx - eps, my), _room_at(rects, mx + eps, my)
    return _room_at(rects, mx, my - eps), _room_at(rects, mx, my + eps)  # horizontal → below / above


def _add_opening(openings: list, wall: dict, pts: dict, kind: str, desired: int) -> bool:
    a, b = pts[wall["a"]], pts[wall["b"]]
    length = _wall_len(a, b)
    margin = 10
    width = min(desired, length - 2 * margin)
    if width < 40:
        return False
    openings.append(
        {
            "id": f"o{len(openings)}",
            "wallId": wall["id"],
            "kind": kind,
            "offset": round((length - width) / 2),
            "width": round(width),
        }
    )
    return True


def place_openings(placed: list[PlacedRoom], points: list[dict], walls: list[dict], rects: list[Rect]) -> list[dict]:
    pts = {p["id"]: p for p in points}
    n = len(placed)

    interior: dict[frozenset, list[dict]] = {}
    exterior: dict[int, list[dict]] = {}
    for w in walls:
        l, r = _wall_sides(w, pts, rects)
        if l == -1 and r == -1:
            continue
        if l == -1 or r == -1:
            exterior.setdefault(r if l == -1 else l, []).append(w)
        elif l != r:
            interior.setdefault(frozenset((l, r)), []).append(w)

    openings: list[dict] = []

    # Interior doors: a spanning tree so every room is reachable.
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for pair, wlist in sorted(
        interior.items(),
        key=lambda kv: -max(_wall_len(pts[w["a"]], pts[w["b"]]) for w in kv[1]),
    ):
        a, b = tuple(pair)
        if find(a) != find(b):
            wall = max(wlist, key=lambda w: _wall_len(pts[w["a"]], pts[w["b"]]))
            if _add_opening(openings, wall, pts, "door", 90):
                parent[find(a)] = find(b)

    # Entrance door on a public room's longest exterior wall.
    for i in sorted(range(n), key=lambda i: 0 if placed[i].type in ("living", "dining") else 1):
        ext = exterior.get(i, [])
        if ext:
            wall = max(ext, key=lambda w: _wall_len(pts[w["a"]], pts[w["b"]]))
            _add_opening(openings, wall, pts, "door", 100)
            break

    # Windows on exterior walls of light-wanting rooms (one per room, avoid door walls).
    want_window = {"living", "bedroom", "kitchen", "dining", "study"}
    used = {o["wallId"] for o in openings}
    for i in range(n):
        if placed[i].type not in want_window:
            continue
        ext = [w for w in exterior.get(i, []) if w["id"] not in used]
        if not ext:
            continue
        wall = max(ext, key=lambda w: _wall_len(pts[w["a"]], pts[w["b"]]))
        if _add_opening(openings, wall, pts, "window", 120):
            used.add(wall["id"])

    return openings


# --------------------------------------------------------------------------- #
# 4. Furniture                                                                #
# --------------------------------------------------------------------------- #

def furnish(placed: list[PlacedRoom]) -> list[dict]:
    out: list[dict] = []
    for r in placed:
        x0, y0, x1, y1 = r.rect
        # Room centroid — emitted on each item so the frontend adapter can resolve
        # furniture back to its DERIVED room id (rooms aren't stored; they're found
        # by cycle detection after the plan lands). See applyGeneratedPlan.
        room_cx = round((x0 + x1) / 2)
        room_cy = round((y0 + y1) / 2)
        specs = [
            FurnitureSpec(
                id=f"{ft}_{k}",
                type=ft,
                width_cm=lookup(ft).width_cm,
                depth_cm=lookup(ft).depth_cm,
                rule=rule,
            )
            for k, (ft, rule) in enumerate(template_for(r.type))
        ]
        if not specs:
            continue
        # The room rectangle's edges are wall CENTERLINES (walls are WALL_THICKNESS
        # thick, centered on the line), so inset by half the wall so items sit flush
        # against the wall's inner face instead of overlapping its 5 cm inner slab.
        result = solve(
            SolveRequest(
                room=Room(width_cm=x1 - x0, length_cm=y1 - y0),
                furniture=specs,
                clearance_cm=WALL_THICKNESS / 2,
            )
        )
        for p in result.placements:
            out.append(
                {
                    "type": p.type,
                    "x": round(x0 + p.x_cm),
                    "y": round(y0 + p.y_cm),
                    "rotationDeg": p.rotation_deg,
                    "roomCx": room_cx,  # for roomId resolution in the frontend adapter
                    "roomCy": room_cy,
                }
            )
    return out


# --------------------------------------------------------------------------- #
# Top-level                                                                   #
# --------------------------------------------------------------------------- #

def generate_plan(plot: Rect, rooms: list[RoomRequest]) -> dict:
    # v1 scope: lays the program out in a single axis-aligned rectangle (the plot
    # bounds). Plot.shape (lshape/irregular) and the entrance side are intentionally
    # ignored here — not a bug; richer envelopes are future work.
    placed = bsp_layout(*plot, rooms)
    points, walls, rects = build_graph(placed)
    openings = place_openings(placed, points, walls, rects)
    furniture = furnish(placed)
    return {
        "plan": {
            "points": points,
            "walls": [
                {"id": w["id"], "a": w["a"], "b": w["b"], "thickness": WALL_THICKNESS, "height": WALL_HEIGHT}
                for w in walls
            ],
            "openings": openings,
            "furniture": furniture,
            "rooms": [
                {
                    "name": r.name,
                    "type": r.type,
                    "cx": round((r.rect[0] + r.rect[2]) / 2),
                    "cy": round((r.rect[1] + r.rect[3]) / 2),
                }
                for r in placed
            ],
        }
    }
