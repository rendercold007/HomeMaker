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

# Entrance sides, in the app's screen-y-down world: N=top, S=bottom, W=left, E=right.
ENTRANCE_SIDES = ("N", "S", "E", "W")

CORRIDOR_WIDTH = 120  # cm — a comfortable single corridor that fits a 100 cm door
MIN_ROOMS_FOR_CORRIDOR = 4  # below this, rooms connect directly (a hall isn't worth the area)
HALLWAY_TYPE = "hallway"

NOTCH_FRAC = 0.4  # an L-shape removes this fraction of width AND height in one corner
PLOT_SHAPES = ("rectangular", "lshape")  # "irregular" is approximated by "lshape"

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


def _split_index(rooms: list[RoomRequest]) -> int:
    """Weight-median split point (same rule as bsp_layout's first cut)."""
    total = sum(max(r.weight, 0.01) for r in rooms)
    half, acc, idx = total / 2, 0.0, 1
    for k, r in enumerate(rooms):
        acc += max(r.weight, 0.01)
        if acc >= half:
            idx = k + 1
            break
    return max(1, min(idx, len(rooms) - 1))


def layout_with_corridor(
    x0: int, y0: int, x1: int, y1: int, rooms: list[RoomRequest], entrance: str | None
) -> list[PlacedRoom]:
    """Carve a straight spine corridor through the plot and BSP the rooms onto
    either side of it, so rooms open onto a hallway instead of onto each other.

    The corridor runs perpendicular to the entrance wall (so it reaches the front
    door): a N/S entrance gives a vertical full-height spine, an E/W entrance a
    horizontal full-width one. With no entrance it follows the longer axis. Rooms
    are weight-split into the two sides and each side is laid out by `bsp_layout`,
    so the whole plot still tiles exactly (the wall graph stays planar and valid).
    """
    w, h = x1 - x0, y1 - y0
    vertical = entrance in ("N", "S") if entrance in ENTRANCE_SIDES else h >= w
    idx = _split_index(rooms)
    side_a, side_b = rooms[:idx], rooms[idx:]
    total = sum(max(r.weight, 0.01) for r in rooms)
    frac_a = sum(max(r.weight, 0.01) for r in side_a) / total

    if vertical:
        cw = max(GRID, min(CORRIDOR_WIDTH, w - 2 * GRID))
        cx0 = max(x0 + GRID, min(_snap(x0 + (w - cw) * frac_a), x1 - cw - GRID))
        cx1 = cx0 + cw
        left = bsp_layout(x0, y0, cx0, y1, side_a)
        right = bsp_layout(cx1, y0, x1, y1, side_b)
        hall = PlacedRoom("Hallway", HALLWAY_TYPE, (cx0, y0, cx1, y1))
        return left + [hall] + right

    cw = max(GRID, min(CORRIDOR_WIDTH, h - 2 * GRID))
    cy0 = max(y0 + GRID, min(_snap(y0 + (h - cw) * frac_a), y1 - cw - GRID))
    cy1 = cy0 + cw
    top = bsp_layout(x0, y0, x1, cy0, side_a)
    bottom = bsp_layout(x0, cy1, x1, y1, side_b)
    hall = PlacedRoom("Hallway", HALLWAY_TYPE, (x0, cy0, x1, cy1))
    return top + [hall] + bottom


def notch_corner(entrance: str | None) -> str:
    """Which corner of the bounding box the L-shape's notch is cut from.

    We keep the notch away from the entrance so the front of the house stays a
    full wing. Deterministic; defaults to SE when no entrance is given."""
    return {"N": "SE", "S": "NE", "E": "SW", "W": "SE"}.get(entrance, "SE")


def lshape_layout(
    x0: int, y0: int, x1: int, y1: int, rooms: list[RoomRequest], corner: str
) -> list[PlacedRoom]:
    """Lay the rooms into an L-shaped footprint: the bounding box minus a corner
    notch. The L splits cleanly into two rectangles (a full-length wing + a
    shorter block beside the notch); rooms are divided between them by area and
    each wing is laid out by `bsp_layout`. The two wings exactly tile the L, so
    the (shape-agnostic) wall graph comes out planar with the notch as exterior.
    """
    w, h = x1 - x0, y1 - y0
    nw = max(GRID, min(_snap(w * NOTCH_FRAC), w - GRID))
    nh = max(GRID, min(_snap(h * NOTCH_FRAC), h - GRID))

    # Two rectangles that tile the L. `wing` is the full-length side; `block` is
    # the shorter piece next to the notch.
    if corner == "SE":  # notch bottom-right
        wing = (x0, y0, x1 - nw, y1)
        block = (x1 - nw, y0, x1, y1 - nh)
    elif corner == "NE":  # notch top-right
        wing = (x0, y0, x1 - nw, y1)
        block = (x1 - nw, y0 + nh, x1, y1)
    elif corner == "SW":  # notch bottom-left
        wing = (x0 + nw, y0, x1, y1)
        block = (x0, y0, x0 + nw, y1 - nh)
    else:  # "NW" — notch top-left
        wing = (x0 + nw, y0, x1, y1)
        block = (x0, y0 + nh, x0 + nw, y1)

    a_wing = (wing[2] - wing[0]) * (wing[3] - wing[1])
    a_block = (block[2] - block[0]) * (block[3] - block[1])
    n = len(rooms)
    k = max(1, min(n - 1, round(n * a_wing / (a_wing + a_block))))
    return bsp_layout(*wing, rooms[:k]) + bsp_layout(*block, rooms[k:])


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


def _wall_compass_side(wall: dict, pts: dict, bounds: Rect) -> str | None:
    """Which footprint edge an exterior wall lies on: N(top)/S(bottom)/W/E, or
    None if it isn't on the bounding edge (e.g. an interior notch of an L-shape).
    Screen-y-down world: North = smaller y."""
    px0, py0, px1, py1 = bounds
    a, b = pts[wall["a"]], pts[wall["b"]]
    if a["y"] == b["y"]:  # horizontal
        if a["y"] == py0:
            return "N"
        if a["y"] == py1:
            return "S"
    elif a["x"] == b["x"]:  # vertical
        if a["x"] == px0:
            return "W"
        if a["x"] == px1:
            return "E"
    return None


def place_openings(
    placed: list[PlacedRoom],
    points: list[dict],
    walls: list[dict],
    rects: list[Rect],
    entrance_side: str | None = None,
) -> list[dict]:
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

    corridor = next((i for i, p in enumerate(placed) if p.type == HALLWAY_TYPE), None)

    # Interior doors: a spanning tree so every room is reachable. When a corridor
    # exists, prefer its edges first so it becomes the hub — rooms hang off the
    # hall rather than chaining through each other.
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _edge_key(kv):
        pair, wlist = kv
        longest = max(_wall_len(pts[w["a"]], pts[w["b"]]) for w in wlist)
        on_corridor = corridor is not None and corridor in pair
        return (0 if on_corridor else 1, -longest)

    for pair, wlist in sorted(interior.items(), key=_edge_key):
        a, b = tuple(pair)
        if find(a) != find(b):
            wall = max(wlist, key=lambda w: _wall_len(pts[w["a"]], pts[w["b"]]))
            if _add_opening(openings, wall, pts, "door", 90):
                parent[find(a)] = find(b)

    # Entrance door. With a corridor, you enter into the hall, so the front door
    # goes on a corridor exterior wall (preferring the requested side). Without a
    # corridor, put it on an exterior wall of the requested side — preferring a
    # public room (living/dining) and the longest wall — else the v1 fallback.
    def _is_public(i: int) -> bool:
        return placed[i].type in ("living", "dining")

    bounds = (
        min(r[0] for r in rects), min(r[1] for r in rects),
        max(r[2] for r in rects), max(r[3] for r in rects),
    )
    entrance_done = False

    if corridor is not None:
        cwalls = exterior.get(corridor, [])
        on_side = [w for w in cwalls if _wall_compass_side(w, pts, bounds) == entrance_side]
        cand = on_side or cwalls
        if cand:
            wall = max(cand, key=lambda w: _wall_len(pts[w["a"]], pts[w["b"]]))
            entrance_done = _add_opening(openings, wall, pts, "door", 100)

    if not entrance_done and entrance_side:
        on_side = [
            (i, w)
            for i in range(n)
            for w in exterior.get(i, [])
            if _wall_compass_side(w, pts, bounds) == entrance_side
        ]
        if on_side:
            i, wall = max(
                on_side,
                key=lambda iw: (_is_public(iw[0]), _wall_len(pts[iw[1]["a"]], pts[iw[1]["b"]])),
            )
            entrance_done = _add_opening(openings, wall, pts, "door", 100)

    if not entrance_done:
        for i in sorted(range(n), key=lambda i: 0 if _is_public(i) else 1):
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

def _bias_for_entrance(rooms: list[RoomRequest], entrance: str | None) -> list[RoomRequest]:
    """Best-effort: nudge public rooms (living/dining) toward the entrance side.

    BSP's first cut sends the head of the list to the West (x-split) / North
    (y-split) block and the tail to the East / South block. So we float public
    rooms to the front for N/W entrances and to the back for E/S entrances. It's
    a tendency, not a guarantee (deeper cuts decide the perpendicular axis), but
    it costs nothing and never breaks the tiling. Order is otherwise preserved.
    """
    if entrance not in ENTRANCE_SIDES:
        return rooms
    public = [r for r in rooms if r.type in ("living", "dining")]
    rest = [r for r in rooms if r.type not in ("living", "dining")]
    if not public or not rest:
        return rooms
    return public + rest if entrance in ("N", "W") else rest + public


def generate_plan(
    plot: Rect,
    rooms: list[RoomRequest],
    entrance: str | None = None,
    shape: str | None = None,
) -> dict:
    # Lays the program out inside the plot bounds. `entrance` (N/S/E/W, from the
    # prompt) places the front door on that side and biases public rooms toward
    # it. `shape` ("lshape") carves a corner notch so the footprint is an L;
    # otherwise, with enough rooms, a spine corridor is carved so rooms open onto
    # a hallway. The wall graph is shape-agnostic, so an L tiles + extrudes fine.
    entrance = entrance if entrance in ENTRANCE_SIDES else None
    shape = shape if shape in PLOT_SHAPES else None
    ordered = _bias_for_entrance(rooms, entrance)
    if shape == "lshape" and len(ordered) >= 2:
        # L-shape and the spine corridor don't compose yet — the L's wings already
        # break the footprint up, so v1 uses the notch alone.
        placed = lshape_layout(*plot, ordered, notch_corner(entrance))
    elif len(ordered) >= MIN_ROOMS_FOR_CORRIDOR:
        placed = layout_with_corridor(*plot, ordered, entrance)
    else:
        placed = bsp_layout(*plot, ordered)
    points, walls, rects = build_graph(placed)
    openings = place_openings(placed, points, walls, rects, entrance_side=entrance)
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
