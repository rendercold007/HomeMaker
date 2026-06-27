"""
Manual smoke test for the chat → edit pipeline (the one thing the unit tests
can't cover: real LLM command quality).

Unlike the unittest suite (which feeds the resolver fake commands), this calls a
REAL model through OpenRouter, so it needs your key:

    cd worker
    pip install -r requirements.txt
    export OPENROUTER_API_KEY=sk-or-...
    export EDIT_LLM_MODEL=openai/gpt-4o      # optional; defaults to gpt-4o
    python smoke_edit.py

For each prompt it prints what the model produced (commands), what the resolver
turned that into (patch), the human recap (summary), and any warnings — so you
can judge whether the model picks the right room, emits valid ops, and detects
structural requests. Nothing here is automated; read the output and sanity-check
it. No server needed — it drives llm + edits in-process.
"""

from __future__ import annotations

import copy
import json
import os
import sys

from edits import apply_edits, summarize_floor
from llm import extract_edit_commands, make_client

# Model is chosen exactly like the worker does.
from llm import DEFAULT_EDIT_MODEL

# Mirror the worker's edit route: editing defaults to the stronger model, with
# LLM_MODEL as a global override.
MODEL = os.environ.get("EDIT_LLM_MODEL") or os.environ.get("LLM_MODEL") or DEFAULT_EDIT_MODEL


def sample_floor() -> dict:
    """A 900x300cm home of three 300-wide rooms in a row: Living | Kitchen |
    Bedroom. Living has a window (exterior) and a door into the kitchen, plus a
    sofa and a coffee table; the bedroom has a bed. Rooms are sized so a desk
    actually fits alongside the bed (a 200-wide room would not), keeping the
    multi-turn test about reference resolution rather than the solver running
    out of space."""
    points = [
        {"id": "p0", "x": 0, "y": 0}, {"id": "p1", "x": 300, "y": 0},
        {"id": "p2", "x": 600, "y": 0}, {"id": "p3", "x": 900, "y": 0},
        {"id": "p4", "x": 0, "y": 300}, {"id": "p5", "x": 300, "y": 300},
        {"id": "p6", "x": 600, "y": 300}, {"id": "p7", "x": 900, "y": 300},
    ]
    wall = lambda i, a, b: {"id": i, "a": a, "b": b, "thickness": 10, "height": 270}
    walls = [
        wall("t0", "p0", "p1"), wall("t1", "p1", "p2"), wall("t2", "p2", "p3"),
        wall("b0", "p4", "p5"), wall("b1", "p5", "p6"), wall("b2", "p6", "p7"),
        wall("L", "p0", "p4"), wall("R", "p3", "p7"),
        wall("D1", "p1", "p5"), wall("D2", "p2", "p6"),
    ]
    rooms = [
        {"id": "rLiving", "wallIds": ["t0", "D1", "b0", "L"], "name": "Living", "type": "living", "areaCm2": 60000},
        {"id": "rKitchen", "wallIds": ["t1", "D2", "b1", "D1"], "name": "Kitchen", "type": "kitchen", "areaCm2": 60000},
        {"id": "rBedroom", "wallIds": ["t2", "R", "b2", "D2"], "name": "Bedroom", "type": "bedroom", "areaCm2": 60000},
    ]
    openings = [
        {"id": "win1", "wallId": "t0", "kind": "window", "offset": 40, "width": 120},
        {"id": "door1", "wallId": "D1", "kind": "door", "offset": 100, "width": 90},
    ]
    furniture = [
        {"id": "f_sofa", "type": "sofa", "x": 150, "y": 60, "rotationDeg": 0, "roomId": "rLiving"},
        {"id": "f_table", "type": "coffee_table", "x": 150, "y": 160, "rotationDeg": 0, "roomId": "rLiving"},
        {"id": "f_bed", "type": "double_bed", "x": 700, "y": 150, "rotationDeg": 0, "roomId": "rBedroom"},
    ]
    return {"points": points, "walls": walls, "openings": openings, "rooms": rooms, "furniture": furniture}


def _apply_patch(floor: dict, patch: list[dict]) -> dict:
    """Fold a patch into the floor dict so the NEXT turn sees the new state.

    This mirrors the frontend's applyEditPatch + commit: in production each edit
    is committed and the updated floor is sent on the next turn, so the model
    sees what it already added. Replicating that here is what makes Part B a
    faithful multi-turn test (without it the model re-adds items it can't see)."""
    floor = copy.deepcopy(floor)
    for op in patch:
        kind = op.get("op")
        if kind == "addFurniture":
            for it in op.get("items", []):
                floor["furniture"].append({"id": f"f_{len(floor['furniture'])}", **it})
        elif kind == "removeFurniture":
            ids = set(op.get("ids", []))
            floor["furniture"] = [f for f in floor["furniture"] if f["id"] not in ids]
        elif kind == "addOpening":
            for o in op.get("openings", []):
                floor["openings"].append({"id": f"o_{len(floor['openings'])}", **o})
        elif kind == "removeOpening":
            ids = set(op.get("ids", []))
            floor["openings"] = [o for o in floor["openings"] if o["id"] not in ids]
        elif kind in ("setRoomName", "setRoomType"):
            key = "name" if kind == "setRoomName" else "type"
            for r in floor["rooms"]:
                if r["id"] == op.get("roomId"):
                    r[key] = op.get(key)
    return floor


def _short_patch(patch: list[dict]) -> list[str]:
    """One-line-per-op view of the patch for quick scanning."""
    out = []
    for op in patch:
        kind = op.get("op")
        if kind == "addFurniture":
            out.append(f"addFurniture x{len(op.get('items', []))}: " + ", ".join(i.get("type", "?") for i in op.get("items", [])))
        elif kind == "removeFurniture":
            out.append(f"removeFurniture ids={op.get('ids')}")
        elif kind == "addOpening":
            out.append("addOpening: " + ", ".join(f"{o.get('kind')}@{o.get('wallId')}" for o in op.get("openings", [])))
        elif kind == "removeOpening":
            out.append(f"removeOpening ids={op.get('ids')}")
        elif kind == "replaceFloor":
            rooms = ", ".join(r.get("name", "?") for r in op.get("rooms", []))
            out.append(f"replaceFloor: {len(op.get('rooms', []))} rooms [{rooms}], {len(op.get('furniture', []))} items")
        else:
            out.append(json.dumps(op))
    return out


def run_turn(client, floor: dict, prompt: str, history: list[dict]) -> dict:
    """Run one edit turn, print the result, and return it (for accumulating history)."""
    commands = extract_edit_commands(prompt, summarize_floor(floor), client=client, model=MODEL, history=history)
    result = apply_edits(floor, commands)
    print(f"\n\033[1m▶ {prompt}\033[0m")
    print("  commands:", json.dumps(commands))
    for line in _short_patch(result["patch"]):
        print("  patch   :", line)
    if not result["patch"]:
        print("  patch   : (none)")
    print("  summary :", result["summary"] or "(empty)")
    for w in result["warnings"]:
        print("  \033[33mwarning :\033[0m", w)
    return result


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("OPENROUTER_API_KEY is not set — export your key first. See the module docstring.")
        return 2
    client = make_client()
    print(f"Model: {MODEL}\nFloor: Living | Kitchen | Bedroom (600x300cm)")

    # --- Part A: single-shot edits, each against the original floor ---------- #
    print("\n\033[1m== Part A: one-shot edits (each op) ==\033[0m")
    single_shot = [
        "add a dining table and four chairs to the kitchen",   # add_furniture
        "remove the coffee table from the living room",        # remove_furniture by type
        "add a window to the bedroom",                          # add_opening (exterior)
        "remove the window from the living room",               # remove_opening
        "rename the bedroom to master bedroom",                 # rename_room
        "turn the kitchen into a study",                        # set_room_type
        "clear out the living room and put in a sofa and a tv", # compose: remove all + add
        "make the living room bigger",                          # structural → surgical resize_room
        "add a study",                                          # structural → surgical add_room
        "swap the kitchen and the bedroom",                     # structural → surgical swap_rooms
        "delete the kitchen",                                   # structural → surgical remove_room
    ]
    for prompt in single_shot:
        run_turn(client, sample_floor(), prompt, history=[])

    # --- Part B: a multi-turn conversation (reference resolution) ------------ #
    # History accumulates; the floor evolves turn to turn (so "it" has a referent
    # and the worker sees the latest geometry). This is the multi-turn path.
    print("\n\n\033[1m== Part B: multi-turn conversation (pronouns / follow-ups) ==\033[0m")
    floor = sample_floor()
    history: list[dict] = []
    conversation = [
        "add a desk to the bedroom",
        "actually put a chair next to it",        # "it" → the desk
        "and add a bookshelf against the wall",   # follow-on, same room implied
    ]
    for prompt in conversation:
        result = run_turn(client, floor, prompt, history)
        # Commit the patch into the floor before the next turn (like the app), so
        # the model sees what it already placed — the faithful multi-turn flow.
        floor = _apply_patch(floor, result["patch"])
        history.append({"prompt": prompt, "summary": result["summary"]})

    print("\nDone. Eyeball the commands/patches above — are rooms resolved correctly, "
          "ops valid, and structural asks handled surgically (replaceFloor with the right "
          "rooms, openings preserved)?")
    return 0


if __name__ == "__main__":
    sys.exit(main())
