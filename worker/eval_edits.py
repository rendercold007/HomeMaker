"""
Assertion-based eval for the chat → edit pipeline (Tier 1 #3).

smoke_edit.py prints results for a human to eyeball; this file makes the same
real-LLM path PASS/FAIL, so we can catch regressions in command quality (the one
thing the offline unit tests can't: whether a REAL model picks the right room,
the right op, and the right route). It drives llm + edits in-process — no server.

    cd worker
    export OPENROUTER_API_KEY=sk-or-...
    export EDIT_LLM_MODEL=openai/gpt-4o      # optional; defaults to gpt-4o
    python eval_edits.py                     # exits non-zero if any case fails

Each case asserts, per prompt:
  - the model emitted the expected op (intent recognised),
  - the turn took the expected route (local patch / structural replaceFloor /
    clarify-back), and
  - the expected room was resolved (its name shows up in the human summary).

Assertions are deliberately about routing + room resolution, not exact furniture,
so they're stable across the model's non-determinism.
"""

from __future__ import annotations

import os
import sys

from edits import apply_edits, summarize_floor
from llm import DEFAULT_EDIT_MODEL, extract_edit_commands, make_client

MODEL = os.environ.get("EDIT_LLM_MODEL") or os.environ.get("LLM_MODEL") or DEFAULT_EDIT_MODEL

GREEN, RED, DIM, BOLD, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"


def _row_floor() -> dict:
    """600x300cm: Living | Kitchen | Bedroom, each 200 wide. One of each type, so
    every handle ("the kitchen") resolves uniquely."""
    points = [
        {"id": "p0", "x": 0, "y": 0}, {"id": "p1", "x": 200, "y": 0},
        {"id": "p2", "x": 400, "y": 0}, {"id": "p3", "x": 600, "y": 0},
        {"id": "p4", "x": 0, "y": 300}, {"id": "p5", "x": 200, "y": 300},
        {"id": "p6", "x": 400, "y": 300}, {"id": "p7", "x": 600, "y": 300},
    ]
    wall = lambda i, a, b: {"id": i, "a": a, "b": b, "thickness": 10, "height": 270}
    walls = [
        wall("t0", "p0", "p1"), wall("t1", "p1", "p2"), wall("t2", "p2", "p3"),
        wall("b0", "p4", "p5"), wall("b1", "p5", "p6"), wall("b2", "p6", "p7"),
        wall("L", "p0", "p4"), wall("R", "p3", "p7"),
        wall("D1", "p1", "p5"), wall("D2", "p2", "p6"),
    ]
    rooms = [
        {"id": "rL", "wallIds": ["t0", "D1", "b0", "L"], "name": "Living", "type": "living", "areaCm2": 60000},
        {"id": "rK", "wallIds": ["t1", "D2", "b1", "D1"], "name": "Kitchen", "type": "kitchen", "areaCm2": 60000},
        {"id": "rB", "wallIds": ["t2", "R", "b2", "D2"], "name": "Bedroom", "type": "bedroom", "areaCm2": 60000},
    ]
    openings = [
        {"id": "win", "wallId": "t0", "kind": "window", "offset": 40, "width": 120},
        {"id": "dlk", "wallId": "D1", "kind": "door", "offset": 100, "width": 90},
    ]
    furniture = [
        {"id": "f_sofa", "type": "sofa", "x": 100, "y": 60, "rotationDeg": 0, "roomId": "rL"},
        {"id": "f_table", "type": "coffee_table", "x": 100, "y": 160, "rotationDeg": 0, "roomId": "rL"},
        {"id": "f_bed", "type": "double_bed", "x": 500, "y": 150, "rotationDeg": 0, "roomId": "rB"},
    ]
    return {"points": points, "walls": walls, "openings": openings, "rooms": rooms, "furniture": furniture}


def _two_bedroom_floor() -> dict:
    floor = _row_floor()
    floor["rooms"][1].update(name="Bedroom 1", type="bedroom")
    floor["rooms"][2].update(name="Bedroom 2", type="bedroom")
    return floor


def _route(result: dict) -> str:
    if result.get("needsInput"):
        return "clarify"
    patch = result.get("patch", [])
    if any(op.get("op") == "replaceFloor" for op in patch):
        return "structural"
    if patch:
        return "local"
    return "noop"


class Case:
    def __init__(self, prompt, floor, *, op=None, route=None, room=None):
        self.prompt = prompt
        self.floor = floor
        self.op = op          # expected op in the model's commands
        self.route = route    # local | structural | clarify
        self.room = room      # expected room name, checked against the summary

    def check(self, commands, result):
        fails = []
        ops = [str(c.get("op", "")) for c in commands]
        if self.op and self.op not in ops:
            fails.append(f"expected op '{self.op}', got {ops}")
        route = _route(result)
        if self.route and route != self.route:
            fails.append(f"expected route '{self.route}', got '{route}'")
        if self.room and self.room.lower() not in result.get("summary", "").lower():
            fails.append(f"expected '{self.room}' in summary: {result.get('summary')!r}")
        return fails


CASES = [
    # Local edits — route to a local patch, right op, right room.
    Case("add a dining table and four chairs to the kitchen", _row_floor, op="add_furniture", route="local", room="Kitchen"),
    Case("remove the coffee table from the living room", _row_floor, op="remove_furniture", route="local", room="Living"),
    Case("add a window to the bedroom", _row_floor, op="add_opening", route="local", room="Bedroom"),
    Case("rename the bedroom to guest room", _row_floor, op="rename_room", route="local", room="Bedroom"),
    Case("turn the kitchen into a study", _row_floor, op="set_room_type", route="local", room="Kitchen"),
    # Structural edits — route to a replaceFloor, right op, right room.
    Case("make the living room bigger", _row_floor, op="resize_room", route="structural", room="Living"),
    Case("add a study", _row_floor, op="add_room", route="structural", room="Study"),
    Case("swap the kitchen and the bedroom", _row_floor, op="swap_rooms", route="structural"),
    Case("delete the kitchen", _row_floor, op="remove_room", route="structural", room="Kitchen"),
    # Clarify-back — ambiguous handle must ask, not guess.
    Case("make the bedroom bigger", _two_bedroom_floor, route="clarify"),
]


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("OPENROUTER_API_KEY is not set — export your key first. See the module docstring.")
        return 2
    client = make_client()
    print(f"{BOLD}Edit eval{RESET}  model={MODEL}  ({len(CASES)} cases)\n")

    passed = 0
    for case in CASES:
        floor = case.floor()
        commands = extract_edit_commands(case.prompt, summarize_floor(floor), client=client, model=MODEL)
        result = apply_edits(floor, commands)
        fails = case.check(commands, result)
        if fails:
            print(f"{RED}FAIL{RESET}  {case.prompt}")
            for f in fails:
                print(f"        {DIM}{f}{RESET}")
        else:
            passed += 1
            print(f"{GREEN}PASS{RESET}  {case.prompt}  {DIM}→ {_route(result)}{RESET}")

    total = len(CASES)
    color = GREEN if passed == total else RED
    print(f"\n{color}{passed}/{total} passed{RESET}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
