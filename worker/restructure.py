"""
Structural edits (Phase 4 — chat → editable plan, v2).

v1 (edits.py) handles LOCAL edits that never touch the wall graph. v2 handles
STRUCTURAL edits — resize / add / remove / swap a ROOM — which DO change the
partition. Doing that surgically (re-slicing only the affected sub-region while
keeping every other room's walls pixel-stable) needs the original BSP tree,
which the floor doesn't store. So v2 takes the deterministic, robust route the
frontend already supports via the reserved `replaceFloor` patch op:

    1. reconstruct the room PROGRAM from the current floor (each room's name,
       type, and weight = its area), in left-to-right / top-to-bottom order;
    2. apply the structural change to that program (a pure list edit);
    3. re-flow it inside the SAME plot footprint with layout.bsp_layout — so the
       home's outer size is preserved, only the interior partition changes;
    4. carry furniture across by room IDENTITY: a room whose box is unchanged
       keeps its items exactly (translated); a resized room keeps the SAME items
       re-solved into the new box; a brand-new room is furnished from its
       template. Removed rooms' furniture is dropped.

The result is one `replaceFloor` op (a full new floor), which applyEditPatch
routes through applyGeneratedPlan — so 2D + 3D land it as a single undo step.
Openings (doors/windows) are regenerated, since the walls they sat on changed.

The LLM never sees coordinates here either; it only names which room to resize /
add / remove / swap. All geometry is computed deterministically below.
"""

from __future__ import annotations

from layout import (
    GRID,
    WALL_HEIGHT,
    WALL_THICKNESS,
    PlacedRoom,
    RoomRequest,
    bsp_layout,
    build_graph,
    place_openings,
)
from llm import ROOM_TYPES
from solver import FurnitureSpec, Room, SolveRequest, solve
from templates import template_for

# The structural ops v2 implements (re-flow the partition). `move_room` is left
# out on purpose — "move" is ambiguous for a space-filling partition; the model
# is steered toward `swap_rooms` instead (see llm.build_edit_prompt).
STRUCTURAL_OPS = {"resize_room", "add_room", "remove_room", "swap_rooms"}

# Default resize strength when the model gives only a direction, not a factor.
_BIGGER = 1.5
_SMALLER = 0.6

# Relative area for a brand-new room, as a multiple of the existing average.
_TYPE_SCALE = {
    "living": 1.5, "dining": 1.3, "bedroom": 1.2, "study": 1.0, "kitchen": 1.0,
    "bathroom": 0.6, "utility": 0.6, "pooja": 0.5, "parking": 1.2, "other": 1.0,
}


# --------------------------------------------------------------------------- #
# Floor helpers (self-contained so edits.py ← restructure.py stays one-way)    #
# --------------------------------------------------------------------------- #

def _point_map(floor: dict) -> dict:
    return {p["id"]: p for p in floor.get("points", [])}


def _wall_map(floor: dict) -> dict:
    return {w["id"]: w for w in floor.get("walls", [])}


def _room_bbox(floor: dict, room: dict):
    pts, wmap = _point_map(floor), _wall_map(floor)
    xs: list[float] = []
    ys: list[float] = []
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
    return (min(xs), min(ys), max(xs), max(ys))


def _plot_rect(floor: dict):
    """The home's outer footprint — the bbox of every point. Re-flow stays
    inside this, so a structural edit never changes the overall size."""
    pts = floor.get("points", [])
    if not pts:
        return None
    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _resolve_entry(program: list[dict], handle) -> dict | None:
    """Match a loose room handle (name or type) to a program entry."""
    h = str(handle or "").strip().lower()
    if not h:
        return None
    for e in program:  # exact name
        if e["name"].strip().lower() == h:
            return e
    for e in program:  # exact type
        if e["type"].strip().lower() == h:
            return e
    for e in program:  # fuzzy, e.g. "living" ~ "Living Room"
        name, typ = e["name"].lower(), e["type"].lower()
        if h in name or name in h or (typ and typ in h):
            return e
    return None


# --------------------------------------------------------------------------- #
# 1. Reconstruct the program                                                  #
# --------------------------------------------------------------------------- #

def build_program(floor: dict) -> list[dict]:
    """Derive an ordered room program from the current floor.

    Each entry is {name, type, weight, room_id, bbox}; weight is the room's
    area, so re-flowing reproduces roughly the same relative sizes. Order is
    left-to-right then top-to-bottom — the spatial order bsp_layout lays a
    program out in, so an unchanged program re-flows to a similar partition.
    """
    entries: list[dict] = []
    for r in floor.get("rooms", []):
        bbox = _room_bbox(floor, r)
        if not bbox:
            continue
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        area = max(w * h, 1.0)
        entries.append(
            {
                "name": str(r.get("name") or r.get("type") or "Room"),
                "type": str(r.get("type") or "other"),
                "weight": float(area),
                "room_id": r.get("id"),
                "bbox": bbox,
            }
        )
    entries.sort(key=lambda e: (e["bbox"][0], e["bbox"][1]))
    return entries


def _avg_weight(program: list[dict]) -> float:
    return sum(e["weight"] for e in program) / len(program) if program else 10000.0


# --------------------------------------------------------------------------- #
# 2. Apply a structural command to the program (pure list edit)               #
# --------------------------------------------------------------------------- #

def apply_structural_command(
    program: list[dict], cmd: dict, summary: list[str], warnings: list[str]
) -> bool:
    """Mutate `program` per one structural command. Returns True if it changed
    the program (so the caller knows a re-flow is warranted)."""
    op = str(cmd.get("op", ""))

    if op == "resize_room":
        e = _resolve_entry(program, cmd.get("room"))
        if e is None:
            warnings.append(f"Couldn't find a room matching '{cmd.get('room')}' to resize.")
            return False
        factor = _resize_factor(cmd)
        e["weight"] = max(e["weight"] * factor, 1.0)
        summary.append(("enlarged" if factor >= 1 else "shrank") + f" the {e['name']}")
        return True

    if op == "add_room":
        rtype = str(cmd.get("type", "other")).strip().lower()
        if rtype not in ROOM_TYPES:
            rtype = "other"
        name = str(cmd.get("name") or cmd.get("room") or rtype.title()).strip() or rtype.title()
        weight = _avg_weight(program) * _TYPE_SCALE.get(rtype, 1.0)
        program.append({"name": name, "type": rtype, "weight": weight, "room_id": None, "bbox": None})
        summary.append(f"added a {name}")
        return True

    if op == "remove_room":
        e = _resolve_entry(program, cmd.get("room"))
        if e is None:
            warnings.append(f"Couldn't find a room matching '{cmd.get('room')}' to remove.")
            return False
        if len(program) <= 1:
            warnings.append("Can't remove the only room in the plan.")
            return False
        program.remove(e)
        summary.append(f"removed the {e['name']}")
        return True

    if op == "swap_rooms":
        a = _resolve_entry(program, cmd.get("room"))
        b = _resolve_entry(program, cmd.get("with") or cmd.get("room2") or cmd.get("and"))
        if a is None or b is None or a is b:
            warnings.append("Couldn't find two distinct rooms to swap.")
            return False
        ia, ib = program.index(a), program.index(b)
        program[ia], program[ib] = program[ib], program[ia]
        summary.append(f"swapped the {a['name']} and the {b['name']}")
        return True

    return False


def _resize_factor(cmd: dict) -> float:
    """A resize multiplier from an explicit factor or a direction word."""
    raw = cmd.get("factor")
    if isinstance(raw, (int, float)) and raw > 0:
        return max(0.2, min(float(raw), 5.0))
    change = str(cmd.get("change", "")).strip().lower()
    if any(w in change for w in ("small", "less", "shrink", "reduce")):
        return _SMALLER
    return _BIGGER  # default reading of a bare "resize" is "bigger"


# --------------------------------------------------------------------------- #
# 3. Re-flow + carry furniture                                                #
# --------------------------------------------------------------------------- #

def _solve_into(room_type: str, specs: list[FurnitureSpec], rect, cx: int, cy: int) -> list[dict]:
    """Solve a furniture spec list into a room rect; emit GenFurniture dicts.

    Mirrors layout.furnish: the rect edges are wall CENTERLINES, so inset by
    half a wall so items sit flush against the inner face. roomCx/roomCy let the
    frontend adapter resolve each item back to its derived room id.
    """
    if not specs:
        return []
    x0, y0, x1, y1 = rect
    res = solve(
        SolveRequest(
            room=Room(width_cm=x1 - x0, length_cm=y1 - y0),
            furniture=specs,
            clearance_cm=WALL_THICKNESS / 2,
        )
    )
    return [
        {
            "type": p.type,
            "x": round(x0 + p.x_cm),
            "y": round(y0 + p.y_cm),
            "rotationDeg": p.rotation_deg,
            "roomCx": cx,
            "roomCy": cy,
        }
        for p in res.placements
    ]


def _template_furnish(room_type: str, rect, cx: int, cy: int) -> list[dict]:
    """Furnish a brand-new room from its type template (like layout.furnish)."""
    specs = [
        FurnitureSpec(
            id=f"{ft}_{k}",
            type=ft,
            width_cm=_dims(ft)[0],
            depth_cm=_dims(ft)[1],
            rule=rule,
        )
        for k, (ft, rule) in enumerate(template_for(room_type))
    ]
    return _solve_into(room_type, specs, rect, cx, cy)


def _resolve_existing(room_type: str, items: list[dict], rect, cx: int, cy: int) -> list[dict]:
    """Re-solve a resized room's OWN furniture (its types, preserved) into the
    new box, so user customisations survive a resize. Rules default from the
    room's template where the type matches, else 'anywhere'."""
    rules = dict(template_for(room_type))
    specs: list[FurnitureSpec] = []
    for k, f in enumerate(items):
        t = str(f.get("type", "")).strip()
        if not t:
            continue
        w, d = _dims(t)
        specs.append(FurnitureSpec(id=f"{t}_{k}", type=t, width_cm=w, depth_cm=d, rule=rules.get(t, "anywhere")))
    return _solve_into(room_type, specs, rect, cx, cy)


def _dims(ftype: str) -> tuple[float, float]:
    from catalog import lookup

    d = lookup(ftype)
    return d.width_cm, d.depth_cm


def _carry_furniture(floor: dict, program: list[dict], placed: list[PlacedRoom]) -> list[dict]:
    """Map each room's furniture onto its new rectangle.

    - unchanged box  → translate items exactly (preserve hand placement)
    - resized box    → re-solve the SAME items into the new box
    - brand-new room → furnish from template
    - removed room   → its items are simply absent (no program entry)
    """
    by_room: dict = {}
    for f in floor.get("furniture", []):
        by_room.setdefault(f.get("roomId"), []).append(f)

    out: list[dict] = []
    for entry, pr in zip(program, placed):
        x0, y0, x1, y1 = pr.rect
        cx, cy = round((x0 + x1) / 2), round((y0 + y1) / 2)
        rid = entry.get("room_id")
        old_bbox = entry.get("bbox")

        if rid is not None and old_bbox is not None:  # an existing room
            items = by_room.get(rid, [])
            if not items:
                continue  # respect a deliberately empty room — don't re-furnish
            ow, oh = old_bbox[2] - old_bbox[0], old_bbox[3] - old_bbox[1]
            nw, nh = x1 - x0, y1 - y0
            if abs(ow - nw) <= GRID and abs(oh - nh) <= GRID:  # box unchanged → keep exactly
                dx, dy = x0 - old_bbox[0], y0 - old_bbox[1]
                for f in items:
                    out.append(
                        {
                            "type": f["type"],
                            "x": round(f["x"] + dx),
                            "y": round(f["y"] + dy),
                            "rotationDeg": int(f.get("rotationDeg", 0)),
                            "roomCx": cx,
                            "roomCy": cy,
                        }
                    )
            else:  # box resized → re-solve its own items into the new box
                out.extend(_resolve_existing(entry["type"], items, pr.rect, cx, cy))
        else:  # brand-new room
            out.extend(_template_furnish(entry["type"], pr.rect, cx, cy))
    return out


def restructure(floor: dict, program: list[dict]) -> dict | None:
    """Re-flow `program` inside the floor's footprint → one `replaceFloor` op."""
    plot = _plot_rect(floor)
    if not plot or not program:
        return None

    reqs = [RoomRequest(e["name"], e["type"], max(e["weight"], 0.01)) for e in program]
    placed = bsp_layout(*plot, reqs)  # placed[i] ↔ program[i] (bsp_layout preserves order)
    points, walls, rects = build_graph(placed)
    openings = place_openings(placed, points, walls, rects)
    furniture = _carry_furniture(floor, program, placed)

    rooms_meta = [
        {
            "name": pr.name,
            "type": pr.type,
            "cx": round((pr.rect[0] + pr.rect[2]) / 2),
            "cy": round((pr.rect[1] + pr.rect[3]) / 2),
        }
        for pr in placed
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
