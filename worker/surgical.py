"""
Surgical structural edits (Phase 4 — chat → editable plan, v3).

v2 (restructure.py) re-flows the WHOLE floor for any structural change: it
regenerates every door/window and can shuffle the partition, so "make the
kitchen bigger" might move the living room and wipe a door you placed. v3 keeps
untouched rooms pixel-stable and preserves their openings, by working in the
RECTANGLE domain instead of the merged wall graph.

bsp_layout (layout.py) lays rooms out as a clean tiling of non-overlapping
rectangles. So we:

  1. recover each room's rectangle + its furniture from the current floor;
  2. apply the structural change to that rectangle set, touching the FEWEST
     rooms possible:
       - resize → move the shared edge with a clean full-edge neighbor
       - remove → a neighbour absorbs the room's rectangle
       - add    → split a donor room into two
       - swap   → exchange two rooms' identity + furniture in place (no walls move)
  3. rebuild the wall graph from the new rectangles (layout.build_graph), then
     REMAP the existing openings onto the new walls by world coordinate — this
     is what preserves doors/windows on untouched walls — and keep untouched
     rooms' furniture exactly where it was.

If the floor isn't a clean rectangle tiling (e.g. hand-drawn L-shaped rooms), or
an op has no clean target, apply_surgical returns None and the caller falls back
to the v2 full re-flow. So v3 is always safe: it's a fidelity upgrade on the
common (engine-generated) case, never a correctness risk.

The result is the same `replaceFloor` op v2 emits — the win is that the geometry
that comes back is locally stable, not that the wire changed.
"""

from __future__ import annotations

from layout import (
    GRID,
    WALL_HEIGHT,
    WALL_THICKNESS,
    PlacedRoom,
    build_graph,
)
from restructure import (
    STRUCTURAL_OPS,
    _resolve_existing,
    _template_furnish,
)

MIN_DIM = 120  # cm; a room edge won't shrink below this in a surgical move
_TOL = 1.0     # cm; coordinate match tolerance


# --------------------------------------------------------------------------- #
# Rectangle model                                                             #
# --------------------------------------------------------------------------- #

class Box:
    """One room as a rectangle + its furniture + bookkeeping for the rebuild."""

    __slots__ = ("name", "type", "room_id", "rect", "items", "changed", "is_new", "door_hint")

    def __init__(self, name, type_, room_id, rect, items):
        self.name = name
        self.type = type_
        self.room_id = room_id
        self.rect = rect  # (x0, y0, x1, y1), ints
        self.items = items  # list of furniture dicts (global cm coords)
        self.changed = False  # rect or contents changed → re-solve furniture
        self.is_new = False   # brand-new room → furnish from template
        self.door_hint = None  # (orient, const, lo, hi) split line to door, for new rooms


def _point_map(floor):
    return {p["id"]: p for p in floor.get("points", [])}


def _wall_map(floor):
    return {w["id"]: w for w in floor.get("walls", [])}


def _room_bbox(floor, room):
    pts, wmap = _point_map(floor), _wall_map(floor)
    xs, ys = [], []
    for wid in room.get("wallIds", []):
        w = wmap.get(wid)
        if not w:
            continue
        for pid in (w["a"], w["b"]):
            p = pts.get(pid)
            if p:
                xs.append(p["x"])
                ys.append(p["y"])
    if not xs:
        return None
    return (round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)))


def build_boxes(floor):
    """Recover the room rectangles + furniture. None if any room has no box."""
    by_room = {}
    for f in floor.get("furniture", []):
        by_room.setdefault(f.get("roomId"), []).append(f)
    boxes = []
    for r in floor.get("rooms", []):
        bbox = _room_bbox(floor, r)
        if not bbox:
            return None
        boxes.append(
            Box(
                str(r.get("name") or r.get("type") or "Room"),
                str(r.get("type") or "other"),
                r.get("id"),
                bbox,
                list(by_room.get(r.get("id"), [])),
            )
        )
    return boxes or None


def _area(rect):
    return (rect[2] - rect[0]) * (rect[3] - rect[1])


def _footprint(boxes):
    return (
        min(b.rect[0] for b in boxes),
        min(b.rect[1] for b in boxes),
        max(b.rect[2] for b in boxes),
        max(b.rect[3] for b in boxes),
    )


def _overlap_area(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return ix * iy


def is_clean_tiling(boxes):
    """True iff the boxes are non-overlapping rectangles that exactly tile their
    bounding footprint — i.e. the engine's slab layout, not a hand-drawn mess."""
    fp = _footprint(boxes)
    if sum(_area(b.rect) for b in boxes) != _area(fp):
        return False  # gaps, overlaps, or non-rectangular (bbox > true area) rooms
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if _overlap_area(boxes[i].rect, boxes[j].rect) > 0:
                return False
    return True


def _resolve_box(boxes, handle):
    h = str(handle or "").strip().lower()
    if not h:
        return None
    for b in boxes:  # exact name
        if b.name.strip().lower() == h:
            return b
    for b in boxes:  # exact type
        if b.type.strip().lower() == h:
            return b
    for b in boxes:  # fuzzy
        if h in b.name.lower() or b.name.lower() in h or (b.type and b.type in h):
            return b
    return None


# --------------------------------------------------------------------------- #
# Shared-edge adjacency                                                       #
# --------------------------------------------------------------------------- #

def _full_edge_neighbor(box, boxes, side):
    """A neighbour that shares `box`'s ENTIRE edge on `side`, so box ∪ neighbour
    is a rectangle and moving the shared edge disturbs no other room.

    side ∈ {"right","left","top","bottom"}. Returns the neighbour Box or None.
    """
    x0, y0, x1, y1 = box.rect
    for n in boxes:
        if n is box:
            continue
        nx0, ny0, nx1, ny1 = n.rect
        if side == "right" and abs(nx0 - x1) <= _TOL and ny0 == y0 and ny1 == y1:
            return n
        if side == "left" and abs(nx1 - x0) <= _TOL and ny0 == y0 and ny1 == y1:
            return n
        if side == "top" and abs(ny1 - y0) <= _TOL and nx0 == x0 and nx1 == x1:
            return n
        if side == "bottom" and abs(ny0 - y1) <= _TOL and nx0 == x0 and nx1 == x1:
            return n
    return None


def _snap(v):
    return int(round(v / GRID) * GRID)


# --------------------------------------------------------------------------- #
# Structural ops on the rectangle set                                         #
# --------------------------------------------------------------------------- #

def _resize(boxes, cmd, summary, warnings):
    from restructure import _resize_factor

    box = _resolve_box(boxes, cmd.get("room"))
    if box is None:
        return False  # not found → let the caller fall back (it messages)
    factor = _resize_factor(cmd)

    # Try each side; move the one whose clean neighbour can absorb the change.
    x0, y0, x1, y1 = box.rect
    for side in ("right", "left", "bottom", "top"):
        n = _full_edge_neighbor(box, boxes, side)
        if n is None:
            continue
        horizontal = side in ("right", "left")
        cur = (x1 - x0) if horizontal else (y1 - y0)
        n_extent = (n.rect[2] - n.rect[0]) if horizontal else (n.rect[3] - n.rect[1])
        new_dim = _snap(cur * factor)
        delta = new_dim - cur
        # Clamp so neither room drops below MIN_DIM.
        if delta > 0:
            delta = min(delta, n_extent - MIN_DIM)
        else:
            delta = max(delta, MIN_DIM - cur)
        if delta == 0:
            continue

        nb = list(n.rect)
        bb = [x0, y0, x1, y1]
        if side == "right":
            bb[2] += delta; nb[0] += delta
        elif side == "left":
            bb[0] -= delta; nb[2] -= delta
        elif side == "bottom":
            bb[3] += delta; nb[1] += delta
        else:  # top
            bb[1] -= delta; nb[3] -= delta
        box.rect = tuple(bb)
        n.rect = tuple(nb)
        box.changed = n.changed = True
        summary.append(("enlarged" if factor >= 1 else "shrank") + f" the {box.name}")
        return True

    warnings.append(f"Couldn't resize the {box.name} without disturbing other rooms.")
    return False  # no clean neighbour → fall back


def _remove(boxes, cmd, summary, warnings):
    box = _resolve_box(boxes, cmd.get("room"))
    if box is None:
        return False
    if len(boxes) <= 1:
        warnings.append("Can't remove the only room in the plan.")
        return False
    for side in ("right", "left", "bottom", "top"):
        n = _full_edge_neighbor(box, boxes, side)
        if n is None:
            continue
        x0, y0, x1, y1 = box.rect
        nb = list(n.rect)
        # The neighbour grows over box's rectangle (they share box's full edge).
        if side == "right":
            nb[0] = x0
        elif side == "left":
            nb[2] = x1
        elif side == "bottom":
            nb[1] = y0
        else:  # top
            nb[3] = y1
        n.rect = tuple(nb)
        n.changed = True
        boxes.remove(box)
        summary.append(f"removed the {box.name}")
        return True
    warnings.append(f"Couldn't remove the {box.name} cleanly.")
    return False


def _add(boxes, cmd, summary, warnings):
    from llm import ROOM_TYPES

    rtype = str(cmd.get("type", "other")).strip().lower()
    if rtype not in ROOM_TYPES:
        rtype = "other"
    name = str(cmd.get("name") or cmd.get("room") or rtype.title()).strip() or rtype.title()

    donor = _resolve_box(boxes, cmd.get("in") or cmd.get("from"))
    if donor is None:  # else carve from the largest room
        donor = max(boxes, key=lambda b: _area(b.rect))

    x0, y0, x1, y1 = donor.rect
    w, h = x1 - x0, y1 - y0
    # Split along the longer axis; new room gets ~40%, both must clear MIN_DIM.
    if w >= h:
        if w < 2 * MIN_DIM:
            warnings.append(f"The {donor.name} is too small to split.")
            return False
        cut = _snap(x0 + max(MIN_DIM, min(w - MIN_DIM, round(w * 0.6))))
        new_rect = (cut, y0, x1, y1)  # new room on the right
        donor.rect = (x0, y0, cut, y1)
        door_hint = ("V", cut, y0, y1)
    else:
        if h < 2 * MIN_DIM:
            warnings.append(f"The {donor.name} is too small to split.")
            return False
        cut = _snap(y0 + max(MIN_DIM, min(h - MIN_DIM, round(h * 0.6))))
        new_rect = (x0, cut, x1, y1)
        donor.rect = (x0, y0, x1, cut)
        door_hint = ("H", cut, x0, x1)

    donor.changed = True
    nb = Box(name, rtype, None, new_rect, [])
    nb.is_new = True
    nb.door_hint = door_hint
    boxes.append(nb)
    summary.append(f"added a {name}")
    return True


def _swap(boxes, cmd, summary, warnings):
    a = _resolve_box(boxes, cmd.get("room"))
    b = _resolve_box(boxes, cmd.get("with") or cmd.get("room2") or cmd.get("and"))
    if a is None or b is None or a is b:
        warnings.append("Couldn't find two distinct rooms to swap.")
        return False
    # Exchange identity + furniture; rectangles stay put. Both re-solve into
    # their new (swapped) contents.
    a.name, b.name = b.name, a.name
    a.type, b.type = b.type, a.type
    a.room_id, b.room_id = b.room_id, a.room_id
    a.items, b.items = b.items, a.items
    a.changed = b.changed = True
    summary.append(f"swapped the {a.name} and the {b.name}")
    return True


_OPS = {
    "resize_room": _resize,
    "remove_room": _remove,
    "add_room": _add,
    "swap_rooms": _swap,
}


# --------------------------------------------------------------------------- #
# Opening remap (the part that preserves doors/windows)                       #
# --------------------------------------------------------------------------- #

def _opening_span(o, a, b):
    """A door/window's absolute world span: (orient, const, lo, hi)."""
    length = abs(b["x"] - a["x"]) + abs(b["y"] - a["y"])
    if length == 0:
        return None
    off, wid = o["offset"], o["width"]
    if a["x"] == b["x"]:  # vertical wall, varies in y
        d = 1 if b["y"] > a["y"] else -1
        s, e = a["y"] + d * off, a["y"] + d * (off + wid)
        return ("V", a["x"], min(s, e), max(s, e))
    d = 1 if b["x"] > a["x"] else -1
    s, e = a["x"] + d * off, a["x"] + d * (off + wid)
    return ("H", a["y"], min(s, e), max(s, e))


def _match_wall(span, segs):
    """Find the new wall covering `span`; return (wall, offset) or None."""
    orient, const, lo, hi = span
    for w, a, b in segs:
        if orient == "V" and a["x"] == b["x"] and abs(a["x"] - const) <= _TOL:
            wlo, whi = min(a["y"], b["y"]), max(a["y"], b["y"])
            if wlo - _TOL <= lo and hi <= whi + _TOL:
                off = (lo - a["y"]) if b["y"] > a["y"] else (a["y"] - hi)
                return w, max(0, round(off))
        elif orient == "H" and a["y"] == b["y"] and abs(a["y"] - const) <= _TOL:
            wlo, whi = min(a["x"], b["x"]), max(a["x"], b["x"])
            if wlo - _TOL <= lo and hi <= whi + _TOL:
                off = (lo - a["x"]) if b["x"] > a["x"] else (a["x"] - hi)
                return w, max(0, round(off))
    return None


def _edge_of(box, span):
    """If `span` lies on one of `box`'s edges, return (side, local_offset) where
    local_offset is the distance along the edge from its low corner."""
    x0, y0, x1, y1 = box.rect
    orient, const, lo, hi = span
    if orient == "V":
        if abs(const - x0) <= _TOL and y0 - _TOL <= lo and hi <= y1 + _TOL:
            return "left", lo - y0
        if abs(const - x1) <= _TOL and y0 - _TOL <= lo and hi <= y1 + _TOL:
            return "right", lo - y0
    else:
        if abs(const - y0) <= _TOL and x0 - _TOL <= lo and hi <= x1 + _TOL:
            return "top", lo - x0
        if abs(const - y1) <= _TOL and x0 - _TOL <= lo and hi <= x1 + _TOL:
            return "bottom", lo - x0
    return None


def _capture_openings(floor, boxes):
    """Record each opening relative to the room edge it sits on, BEFORE any op.

    Tracking by box edge (not absolute coordinate) is what lets an opening follow
    a wall that moves under a resize, while staying put under a swap — and lets us
    drop the interior door between two rooms that get merged by a remove.
    """
    old_pts, old_walls = _point_map(floor), _wall_map(floor)
    metas = []
    for o in floor.get("openings", []):
        w = old_walls.get(o["wallId"])
        if not w:
            continue
        a, b = old_pts.get(w["a"]), old_pts.get(w["b"])
        if not a or not b:
            continue
        span = _opening_span(o, a, b)
        if not span:
            continue
        owners = []
        for box in boxes:
            e = _edge_of(box, span)
            if e:
                owners.append((box, e[0], e[1]))
        if not owners:
            continue
        owner, side, loff = owners[0]
        metas.append(
            {
                "kind": o["kind"],
                "owner": owner,
                "side": side,
                "loff": loff,
                "width": span[3] - span[2],
                "other": owners[1][0] if len(owners) > 1 else None,
                "span": span,  # absolute, for the owner-removed (absorbed) case
            }
        )
    return metas


def _edge_span(box, side, loff, width):
    x0, y0, x1, y1 = box.rect
    if side in ("left", "right"):
        const = x0 if side == "left" else x1
        loff = max(0, min(loff, (y1 - y0) - width))
        return ("V", const, y0 + loff, y0 + loff + width)
    const = y0 if side == "top" else y1
    loff = max(0, min(loff, (x1 - x0) - width))
    return ("H", const, x0 + loff, x0 + loff + width)


def _emit_openings(metas, points, walls, boxes):
    pts = {p["id"]: p for p in points}
    segs = [(w, pts[w["a"]], pts[w["b"]]) for w in walls]
    wlen = {w["id"]: abs(pts[w["a"]]["x"] - pts[w["b"]]["x"]) + abs(pts[w["a"]]["y"] - pts[w["b"]]["y"]) for w in walls}

    out, used = [], set()

    def place(span, kind):
        m = _match_wall(span, segs)
        if not m:
            return
        wall, off = m
        if wall["id"] in used:
            return
        width = min(span[3] - span[2], wlen[wall["id"]] - WALL_THICKNESS)
        if width < 40:
            return
        off = max(0, min(off, round(wlen[wall["id"]] - width)))
        out.append({"id": f"o{len(out)}", "wallId": wall["id"], "kind": kind, "offset": off, "width": round(width)})
        used.add(wall["id"])

    for m in metas:
        if m["owner"] in boxes:
            # Owner room survives → place box-relative so the opening follows a
            # wall the owner's resize moved.
            place(_edge_span(m["owner"], m["side"], m["loff"], m["width"]), m["kind"])
        elif m["other"] is None or m["other"] in boxes:
            # Owner room was absorbed by a neighbour. Its outer wall persists at
            # the same place on the absorber → match the original absolute span.
            # (The shared interior wall that vanished simply won't match → drop.)
            place(m["span"], m["kind"])

    # Give each brand-new room a door on its split wall, so it stays reachable.
    for box in boxes:
        if not box.is_new or not box.door_hint:
            continue
        orient, const, lo, hi = box.door_hint
        mid = (lo + hi) / 2
        place((orient, const, mid - 45, mid + 45), "door")
    return out


# --------------------------------------------------------------------------- #
# Rebuild + top-level                                                         #
# --------------------------------------------------------------------------- #

def _furniture(boxes):
    out = []
    for b in boxes:
        x0, y0, x1, y1 = b.rect
        cx, cy = round((x0 + x1) / 2), round((y0 + y1) / 2)
        if b.is_new:
            out.extend(_template_furnish(b.type, b.rect, cx, cy))
        elif b.changed:
            out.extend(_resolve_existing(b.type, b.items, b.rect, cx, cy))
        else:  # untouched room — keep its furniture exactly where it is
            for f in b.items:
                out.append(
                    {
                        "type": f["type"],
                        "x": round(f["x"]),
                        "y": round(f["y"]),
                        "rotationDeg": int(f.get("rotationDeg", 0)),
                        "roomCx": cx,
                        "roomCy": cy,
                    }
                )
    return out


def _rebuild(boxes, opening_metas):
    placed = [PlacedRoom(b.name, b.type, b.rect) for b in boxes]
    points, walls, _ = build_graph(placed)
    openings = _emit_openings(opening_metas, points, walls, boxes)
    furniture = _furniture(boxes)
    rooms_meta = [
        {"name": b.name, "type": b.type, "cx": round((b.rect[0] + b.rect[2]) / 2), "cy": round((b.rect[1] + b.rect[3]) / 2)}
        for b in boxes
    ]
    return {
        "op": "replaceFloor",
        "points": points,
        "walls": [
            {"id": w["id"], "a": w["a"], "b": w["b"], "thickness": WALL_THICKNESS, "height": WALL_HEIGHT}
            for w in walls
        ],
        "openings": openings,
        "furniture": furniture,
        "rooms": rooms_meta,
    }


def apply_surgical(floor, structural_cmds):
    """Try to satisfy structural commands surgically (local, opening-preserving).

    Returns {"patch": [replaceFloor], "summary": [...], "warnings": [...]} on
    success, or None to signal the caller to fall back to the v2 full re-flow.
    None is returned for anything not cleanly doable: a non-rectangular tiling,
    an op with no clean target, or an unresolved room.
    """
    boxes = build_boxes(floor)
    if not boxes or not is_clean_tiling(boxes):
        return None

    # Capture openings relative to room edges BEFORE mutating any rectangle, so
    # they can follow walls that move (resize) and be dropped on merges (remove).
    opening_metas = _capture_openings(floor, boxes)

    summary, warnings = [], []
    for cmd in structural_cmds:
        op = str(cmd.get("op", "")).strip()
        if op not in STRUCTURAL_OPS:
            continue
        handler = _OPS.get(op)
        if handler is None or not handler(boxes, cmd, summary, warnings):
            return None  # couldn't do it cleanly → fall back to v2

    if not summary or not boxes:
        return None
    return {"patch": [_rebuild(boxes, opening_metas)], "summary": summary, "warnings": warnings}
