"""
The auto-furnish pipeline (Phase 4 · Step 3) — ties the LLM to the solver.

Flow (docs/BackenAndAI.md): request (metres) → LLM shopping list (types + rules)
→ catalog dimensions → SolveRequest (cm) → deterministic solver → wire response
(metres). The LLM is injected as `llm_fn`, so this whole module is pure and
testable offline with a fake LLM — no network, no API key.
"""

from __future__ import annotations

from typing import Callable

from catalog import lookup
from contract import AutoFurnishRequest, Opening, RoomSpec
from llm import ShoppingItem
from solver import Door, FurnitureSpec, Room, SolveRequest, Wall, Window, solve

# (prompt, room) -> shopping list. The real one calls OpenRouter; tests inject a fake.
LLMFn = Callable[[str, RoomSpec], "list[ShoppingItem]"]

_M = 100  # metres -> centimetres


def auto_furnish(request: AutoFurnishRequest, llm_fn: LLMFn) -> dict:
    dims = request.room.dimensions
    room = Room(width_cm=dims.width * _M, length_cm=dims.length * _M, height_cm=dims.height * _M)
    # Openings that can't physically fit on their wall are dropped (see _to_door/_to_window).
    doors = [d for o in request.room.doors if (d := _to_door(o, room)) is not None]
    windows = [w for o in request.room.windows if (w := _to_window(o, room)) is not None]

    items = llm_fn(request.prompt, request.room)
    specs: list[FurnitureSpec] = []
    for i, item in enumerate(items):
        d = lookup(item.type)
        specs.append(
            FurnitureSpec(
                id=f"{item.type}_{i}",
                type=item.type,
                width_cm=d.width_cm,
                depth_cm=d.depth_cm,
                rule=_resolve_rule(item.rule, items, i),
            )
        )

    result = solve(SolveRequest(room=room, furniture=specs, doors=doors, windows=windows))

    generated = [
        {
            "asset_id": p.type,  # until the vector DB (step 4) supplies real .glb ids
            "type": p.type,
            "position": [round(p.x_cm / _M, 3), 0, round(p.y_cm / _M, 3)],  # cm->m, 2D y -> 3D z
            "rotation": [0, p.rotation_deg, 0],
        }
        for p in result.placements
    ]
    return {"generated_furniture": generated}


def _resolve_rule(rule: str, items: list[ShoppingItem], index: int) -> str:
    """Turn `next_to:<type>` into `next_to:<id>` by finding an earlier item of that type."""
    rule = (rule or "anywhere").strip()
    if rule.startswith("next_to:"):
        ref_type = rule.split(":", 1)[1].strip()
        for j in range(index):
            if items[j].type == ref_type:
                return f"next_to:{ref_type}_{j}"
        return "anywhere"  # referent not placed earlier — degrade gracefully
    return rule


def _wall_and_offset(opening: Opening, room: Room) -> tuple[Wall, float, float]:
    """Snap an opening to its nearest wall and return (wall, offset_cm, width_cm).

    The offset is NOT yet clamped to the wall — callers clamp it once the width is
    known (see _clamp_to_wall).
    """
    x, z = opening.position[0] * _M, opening.position[1] * _M
    dist = {
        Wall.TOP: z,
        Wall.BOTTOM: room.length_cm - z,
        Wall.LEFT: x,
        Wall.RIGHT: room.width_cm - x,
    }
    wall = min(dist, key=lambda w: dist[w])
    offset = x if wall in (Wall.TOP, Wall.BOTTOM) else z
    return wall, offset, opening.width * _M


def _clamp_to_wall(wall: Wall, offset: float, width: float, room: Room) -> float | None:
    """Clamp the opening centre into [width/2, wall_len - width/2].

    Returns None if the opening is wider than its wall (can't fit). Mirrors the
    discipline in layout._add_opening and the model's planEdits.addOpening — keeps
    a corner door from producing a negative-coordinate swing box.
    """
    wall_len = room.width_cm if wall in (Wall.TOP, Wall.BOTTOM) else room.length_cm
    if width > wall_len:
        return None
    return max(width / 2, min(offset, wall_len - width / 2))


def _to_door(opening: Opening, room: Room) -> Door | None:
    wall, offset, width = _wall_and_offset(opening, room)
    offset = _clamp_to_wall(wall, offset, width, room)
    if offset is None:
        return None
    return Door(wall=wall, position_cm=offset, width_cm=width)


def _to_window(opening: Opening, room: Room) -> Window | None:
    wall, offset, width = _wall_and_offset(opening, room)
    offset = _clamp_to_wall(wall, offset, width, room)
    if offset is None:
        return None
    return Window(wall=wall, position_cm=offset, width_cm=width)
