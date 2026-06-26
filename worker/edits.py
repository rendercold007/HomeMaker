"""
Iterative editing resolver (Phase 4 — chat → editable plan, v1).

Turns a list of LLM edit COMMANDS (loose intent: "add a window to the kitchen",
referencing rooms/items by name or type) into a concrete, id-level PATCH the
frontend applies through planEdits as ONE undo step. All geometry is computed
here, deterministically — the LLM never produces coordinates (see
docs/IterativeEditing.md).

Input is the current active floor, exactly as the frontend serialises it (cm):

    floor = {
      points:   [{id,x,y}],
      walls:    [{id,a,b,thickness,height}],
      openings: [{id,wallId,kind,offset,width}],
      furniture:[{id,type,x,y,rotationDeg,roomId?}],
      rooms:    [{id,wallIds,name,type,areaCm2}],   # DERIVED, sent by the client
    }

v1 handles LOCAL edits (furniture, openings, room name/type) that never touch
the wall graph. STRUCTURAL edits (resize/add/remove/swap a room) re-flow the
partition and live in restructure.py (v2); they come back as one `replaceFloor`
op. apply_edits routes a turn to one path or the other — a full re-flow can't
compose with id-level local ops in the same patch, so structural edits are
exclusive per turn (any local ops in the same turn are skipped with a note).
"""

from __future__ import annotations

import copy

from catalog import lookup
from llm import ROOM_TYPES
from restructure import (
    STRUCTURAL_OPS,
    apply_structural_command,
    build_program,
    restructure,
)
from solver import (
    FurnitureSpec,
    Room,
    SolveRequest,
    Wall,
    Window,
    aabb,
    effective_dims,
    solve,
)

WALL_THICKNESS = 10  # cm; mirrors layout.WALL_THICKNESS (room rect edges are centerlines)

# Structural intents the model may still emit that v2 doesn't implement: "move"
# is ambiguous for a space-filling partition (steer to swap), and "unsupported"
# is the model's own escape hatch. Both warn rather than re-flow.
_DEFERRED_STRUCTURAL = {"move_room", "unsupported"}


# --------------------------------------------------------------------------- #
# Floor helpers                                                               #
# --------------------------------------------------------------------------- #

def _point_map(floor: dict) -> dict:
    return {p["id"]: p for p in floor.get("points", [])}


def _wall_map(floor: dict) -> dict:
    return {w["id"]: w for w in floor.get("walls", [])}


def _room_bbox(floor: dict, room: dict):
    """Axis-aligned bounding box (x0,y0,x1,y1) of a room's wall vertices.

    Exact for rectangular rooms; for L-shaped rooms it's the enclosing box,
    which is a fine envelope for v1 furniture placement.
    """
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


def _wall_len(floor: dict, wall: dict) -> float:
    pts = _point_map(floor)
    a, b = pts.get(wall["a"]), pts.get(wall["b"])
    if not a or not b:
        return 0.0
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])  # axis-aligned


def _resolve_room(floor: dict, handle) -> dict | None:
    """Match a loose room handle (name or type) to a room the client sent."""
    h = str(handle or "").strip().lower()
    if not h:
        return None
    rooms = floor.get("rooms", [])
    for r in rooms:  # exact name
        if str(r.get("name", "")).strip().lower() == h:
            return r
    for r in rooms:  # exact type
        if str(r.get("type", "")).strip().lower() == h:
            return r
    for r in rooms:  # fuzzy contains, e.g. "living" ~ "Living Room"
        name = str(r.get("name", "")).lower()
        typ = str(r.get("type", "")).lower()
        if h in name or name in h or (typ and typ in h):
            return r
    return None


def _inside(bbox, x: float, y: float) -> bool:
    x0, y0, x1, y1 = bbox
    return x0 <= x <= x1 and y0 <= y <= y1


def _room_furniture(floor: dict, room: dict) -> list[dict]:
    """Furniture belonging to a room: by roomId, or (if untagged) inside its box."""
    bbox = _room_bbox(floor, room)
    out: list[dict] = []
    for f in floor.get("furniture", []):
        if f.get("roomId") == room["id"]:
            out.append(f)
        elif f.get("roomId") in (None, "") and bbox and _inside(bbox, f["x"], f["y"]):
            out.append(f)
    return out


def _obstacle_boxes(floor: dict, room: dict, items: list[dict]) -> list[tuple]:
    """Existing furniture as room-local AABBs, so new items don't overlap them."""
    bbox = _room_bbox(floor, room)
    if not bbox:
        return []
    x0, y0, _, _ = bbox
    boxes: list[tuple] = []
    for f in items:
        dims = lookup(f["type"])
        spec = FurnitureSpec(f["id"], f["type"], dims.width_cm, dims.depth_cm)
        ew, eh = effective_dims(spec, int(f.get("rotationDeg", 0)) % 360)
        boxes.append(aabb(f["x"] - x0, f["y"] - y0, ew, eh))
    return boxes


def _room_windows(floor: dict, room: dict) -> list[Window]:
    """Window openings on the room's walls, mapped to solver room-local sides.

    Lets the `near_window` rule work during edits. Each window's wall is
    classified to the nearest box side (TOP/BOTTOM/LEFT/RIGHT) and its centre
    expressed in room-local cm.
    """
    bbox = _room_bbox(floor, room)
    if not bbox:
        return []
    x0, y0, x1, y1 = bbox
    pts, wmap = _point_map(floor), _wall_map(floor)
    room_walls = set(room.get("wallIds", []))
    out: list[Window] = []
    for o in floor.get("openings", []):
        if o.get("kind") != "window" or o.get("wallId") not in room_walls:
            continue
        w = wmap.get(o["wallId"])
        if not w:
            continue
        a, b = pts.get(w["a"]), pts.get(w["b"])
        if not a or not b:
            continue
        length = abs(b["x"] - a["x"]) + abs(b["y"] - a["y"])
        if length == 0:
            continue
        t = (o["offset"] + o["width"] / 2) / length
        mx = a["x"] + (b["x"] - a["x"]) * t
        my = a["y"] + (b["y"] - a["y"]) * t
        if a["x"] == b["x"]:  # vertical wall → LEFT or RIGHT
            wall = Wall.LEFT if abs(a["x"] - x0) <= abs(a["x"] - x1) else Wall.RIGHT
            pos = my - y0
        else:  # horizontal wall → TOP or BOTTOM
            wall = Wall.TOP if abs(a["y"] - y0) <= abs(a["y"] - y1) else Wall.BOTTOM
            pos = mx - x0
        out.append(Window(wall=wall, position_cm=pos, width_cm=o["width"]))
    return out


def _wall_room_count(floor: dict) -> dict:
    """How many rooms reference each wall — 1 = exterior, >=2 = interior."""
    cnt: dict[str, int] = {}
    for r in floor.get("rooms", []):
        for wid in r.get("wallIds", []):
            cnt[wid] = cnt.get(wid, 0) + 1
    return cnt


def summarize_floor(floor: dict) -> str:
    """A compact, LLM-readable description of the floor: rooms, their size,
    furniture, wall make-up, and openings. This is what lets the model reference
    rooms by name/type and reason about what to change — never coordinates."""
    cnt = _wall_room_count(floor)
    lines: list[str] = []
    for r in floor.get("rooms", []):
        bbox = _room_bbox(floor, r)
        size = f"{round(bbox[2] - bbox[0])}x{round(bbox[3] - bbox[1])}cm" if bbox else "?"
        ftypes: dict[str, int] = {}
        for f in _room_furniture(floor, r):
            ftypes[f["type"]] = ftypes.get(f["type"], 0) + 1
        flist = ", ".join(f"{n}x {t}" if n > 1 else t for t, n in ftypes.items()) or "empty"
        ext = sum(1 for wid in r.get("wallIds", []) if cnt.get(wid, 0) == 1)
        intr = sum(1 for wid in r.get("wallIds", []) if cnt.get(wid, 0) >= 2)
        rw = set(r.get("wallIds", []))
        opens = sorted({o["kind"] for o in floor.get("openings", []) if o.get("wallId") in rw})
        odesc = ", ".join(opens) if opens else "none"
        lines.append(
            f"- {r.get('name')} (type: {r.get('type')}, {size}; furniture: {flist}; "
            f"{ext} exterior + {intr} interior walls; openings: {odesc})"
        )
    return "\n".join(lines) if lines else "(no rooms yet)"


# --------------------------------------------------------------------------- #
# Operations                                                                  #
# --------------------------------------------------------------------------- #

def _op_add_furniture(floor, cmd, patch, warnings, summary) -> None:
    room = _resolve_room(floor, cmd.get("room"))
    if room is None:
        warnings.append(f"Couldn't find a room matching '{cmd.get('room')}' to add furniture to.")
        return
    bbox = _room_bbox(floor, room)
    if not bbox:
        warnings.append(f"'{room.get('name')}' has no usable boundary yet.")
        return
    x0, y0, x1, y1 = bbox

    specs: list[FurnitureSpec] = []
    for k, it in enumerate(cmd.get("items", []) or []):
        t = str(it.get("type", "")).strip()
        if not t:
            continue
        dims = lookup(t)
        specs.append(
            FurnitureSpec(
                id=f"add_{t}_{k}",
                type=t,
                width_cm=dims.width_cm,
                depth_cm=dims.depth_cm,
                rule=str(it.get("rule") or "anywhere"),
            )
        )
    if not specs:
        return

    existing = _room_furniture(floor, room)
    res = solve(
        SolveRequest(
            room=Room(width_cm=x1 - x0, length_cm=y1 - y0),
            furniture=specs,
            windows=_room_windows(floor, room),
            obstacles=_obstacle_boxes(floor, room, existing),
            clearance_cm=WALL_THICKNESS / 2,
        )
    )
    items = [
        {
            "type": p.type,
            "x": round(x0 + p.x_cm),
            "y": round(y0 + p.y_cm),
            "rotationDeg": p.rotation_deg,
            "roomId": room["id"],
        }
        for p in res.placements
    ]
    if items:
        patch.append({"op": "addFurniture", "items": items})
        summary.append(f"added {len(items)} item(s) to {room.get('name')}")
        # Reflect into the working floor so a later command in this batch sees
        # (and avoids) what we just placed.
        for it in items:
            floor["furniture"].append({"id": f"_new{len(floor['furniture'])}", **it})
    if res.unplaced:
        warnings.append(f"{len(res.unplaced)} item(s) didn't fit in {room.get('name')}.")


def _op_remove_furniture(floor, cmd, patch, warnings, summary) -> None:
    handle = cmd.get("room")
    scope: list[dict]
    label = "the plan"
    if handle:
        room = _resolve_room(floor, handle)
        if room is None:
            warnings.append(f"Couldn't find a room matching '{handle}'.")
            return
        scope = _room_furniture(floor, room)
        label = str(room.get("name"))
    else:
        scope = list(floor.get("furniture", []))

    match = str(cmd.get("match", "")).strip().lower()
    if match in ("all", "*", "everything", ""):
        ids = [f["id"] for f in scope]
    else:
        ids = [f["id"] for f in scope if f["type"].lower() == match or match in f["type"].lower()]
    if ids:
        patch.append({"op": "removeFurniture", "ids": ids})
        summary.append(f"removed {len(ids)} item(s) from {label}")
        idset = set(ids)
        floor["furniture"] = [f for f in floor.get("furniture", []) if f["id"] not in idset]
    else:
        warnings.append(f"No furniture matching '{cmd.get('match')}' in {label}.")


def _op_add_opening(floor, cmd, patch, warnings, summary) -> None:
    room = _resolve_room(floor, cmd.get("room"))
    if room is None:
        warnings.append(f"Couldn't find a room matching '{cmd.get('room')}'.")
        return
    kind = "window" if "window" in str(cmd.get("kind", "")).lower() else "door"
    hint = str(cmd.get("wall", "")).strip().lower()
    wmap = _wall_map(floor)
    cnt = _wall_room_count(floor)

    # Build the candidate wall set from the hint.
    neighbor = _resolve_room(floor, hint) if hint not in ("", "exterior", "interior") else None
    if neighbor is not None and neighbor["id"] != room["id"]:
        shared = set(room.get("wallIds", [])) & set(neighbor.get("wallIds", []))
        candidates = [wmap[w] for w in shared if w in wmap]
    else:
        candidates = []
        for wid in room.get("wallIds", []):
            w = wmap.get(wid)
            if not w:
                continue
            interior = cnt.get(wid, 0) >= 2
            if hint == "interior" and not interior:
                continue
            if hint == "exterior" and interior:
                continue
            candidates.append(w)

    if not candidates:
        warnings.append(f"No {hint or 'suitable'} wall on {room.get('name')} to add a {kind}.")
        return

    used = {o["wallId"] for o in floor.get("openings", [])}
    pool = [w for w in candidates if w["id"] not in used] or candidates
    wall = max(pool, key=lambda w: _wall_len(floor, w))
    length = _wall_len(floor, wall)
    margin = WALL_THICKNESS / 2
    width = 120 if kind == "window" else 90
    if length - 2 * margin < 40:
        warnings.append(f"The wall is too short for a {kind}.")
        return
    width = min(width, length - 2 * margin)
    offset = round((length - width) / 2)
    opening = {"wallId": wall["id"], "kind": kind, "offset": offset, "width": round(width)}
    patch.append({"op": "addOpening", "openings": [opening]})
    summary.append(f"added a {kind} to {room.get('name')}")
    floor.setdefault("openings", []).append({"id": f"_newo{len(floor.get('openings', []))}", **opening})


def _op_remove_opening(floor, cmd, patch, warnings, summary) -> None:
    room = _resolve_room(floor, cmd.get("room"))
    if room is None:
        warnings.append(f"Couldn't find a room matching '{cmd.get('room')}'.")
        return
    room_walls = set(room.get("wallIds", []))
    kind = cmd.get("kind")
    kind = str(kind).lower() if kind else None
    ids = [
        o["id"]
        for o in floor.get("openings", [])
        if o.get("wallId") in room_walls and (kind is None or o.get("kind") == kind)
    ]
    if ids:
        patch.append({"op": "removeOpening", "ids": ids})
        summary.append(f"removed {len(ids)} {kind or 'opening'}(s) from {room.get('name')}")
        idset = set(ids)
        floor["openings"] = [o for o in floor.get("openings", []) if o["id"] not in idset]
    else:
        warnings.append(f"No {kind or 'opening'} found on {room.get('name')}.")


def _op_rename_room(floor, cmd, patch, warnings, summary) -> None:
    room = _resolve_room(floor, cmd.get("room"))
    if room is None:
        warnings.append(f"Couldn't find a room matching '{cmd.get('room')}'.")
        return
    name = str(cmd.get("name", "")).strip()
    if not name:
        return
    patch.append({"op": "setRoomName", "roomId": room["id"], "name": name})
    summary.append(f"renamed {room.get('name')} to {name}")


def _op_set_room_type(floor, cmd, patch, warnings, summary) -> None:
    room = _resolve_room(floor, cmd.get("room"))
    if room is None:
        warnings.append(f"Couldn't find a room matching '{cmd.get('room')}'.")
        return
    t = str(cmd.get("type", "")).strip().lower()
    if t not in ROOM_TYPES:
        warnings.append(f"'{t}' isn't a known room type.")
        return
    patch.append({"op": "setRoomType", "roomId": room["id"], "type": t})
    summary.append(f"set {room.get('name')} to a {t}")


_HANDLERS = {
    "add_furniture": _op_add_furniture,
    "remove_furniture": _op_remove_furniture,
    "add_opening": _op_add_opening,
    "remove_opening": _op_remove_opening,
    "rename_room": _op_rename_room,
    "set_room_type": _op_set_room_type,
}


# --------------------------------------------------------------------------- #
# Top-level                                                                   #
# --------------------------------------------------------------------------- #

def _summary_text(summary: list[str], warnings: list[str]) -> str:
    if summary:
        text = "; ".join(summary)
        return text[0].upper() + text[1:] + "."
    if warnings:
        return "I couldn't apply that edit."
    return "No changes."


def _apply_structural_edits(floor: dict, cmds: list[dict]) -> dict:
    """Re-flow the partition for a structural turn → one `replaceFloor` op.

    Structural edits are exclusive: a full re-flow replaces the whole floor, so
    it can't compose with id-level local ops (their roomIds wouldn't exist after
    the replace). All structural commands fold into one program edit + one
    re-flow; any local ops in the same turn are skipped with a note.
    """
    program = build_program(floor)
    summary: list[str] = []
    warnings: list[str] = []
    changed = 0

    for cmd in cmds:
        op = str(cmd.get("op", "")).strip()
        if op in STRUCTURAL_OPS:
            if apply_structural_command(program, cmd, summary, warnings):
                changed += 1
        elif op in _DEFERRED_STRUCTURAL:
            warnings.append(
                "Moving rooms isn't supported yet — try swapping two rooms, or "
                "resizing / adding / removing one."
            )
        else:
            warnings.append(f"Skipped '{op}' — structural edits are applied on their own.")

    patch: list[dict] = []
    if changed:
        op = restructure(floor, program)
        if op is not None:
            patch.append(op)
        else:
            warnings.append("Couldn't re-flow the plan for that change.")

    return {"patch": patch, "summary": _summary_text(summary, warnings), "warnings": warnings}


def apply_edits(floor: dict, commands: list[dict]) -> dict:
    """Resolve loose edit commands into a concrete, id-level patch.

    Returns {patch, summary, warnings}. The frontend applies `patch` op-by-op
    through planEdits and commits once (one undo step). A turn with any
    structural command takes the re-flow path (restructure.py); otherwise it's
    the local-edit path below.
    """
    floor = copy.deepcopy(floor)
    cmds = [c for c in (commands or []) if isinstance(c, dict)]

    if any(str(c.get("op", "")).strip() in STRUCTURAL_OPS for c in cmds):
        return _apply_structural_edits(floor, cmds)

    patch: list[dict] = []
    warnings: list[str] = []
    summary: list[str] = []

    # Local path: handlers mutate the floor as they go (so commands compose —
    # e.g. "clear the room and add a sofa" doesn't treat the cleared furniture as
    # an obstacle for the new one), but the caller's input stays untouched.
    for cmd in cmds:
        op = str(cmd.get("op", "")).strip()
        if op in _DEFERRED_STRUCTURAL:
            warnings.append(
                "Moving rooms isn't supported yet — try swapping two rooms, or "
                "resizing / adding / removing one."
            )
            continue
        handler = _HANDLERS.get(op)
        if handler is None:
            warnings.append(f"Ignored an unrecognised edit ('{op}').")
            continue
        handler(floor, cmd, patch, warnings, summary)

    summary_text = _summary_text(summary, warnings)

    return {"patch": patch, "summary": summary_text, "warnings": warnings}
