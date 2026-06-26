"""
CLI for the spatial solver — JSON in, JSON out.

This is the step-2 acceptance harness from docs/BackenAndAI.md ("feed it fake
furniture dimensions and ensure it spits out valid, non-overlapping coordinates")
and the seam the step-3 FastAPI worker will call.

Usage:
    python3 cli.py < request.json          # read a SolveRequest from stdin
    python3 cli.py request.json            # ...or from a file
    python3 cli.py --demo                  # run a built-in bedroom example

Request JSON:
    {
      "room": {"width_cm": 400, "length_cm": 500, "height_cm": 270},
      "furniture": [
        {"id": "bed", "type": "double_bed", "width_cm": 150, "depth_cm": 200, "rule": "against_wall"}
      ],
      "doors":   [{"wall": "top", "position_cm": 100, "width_cm": 90}],
      "windows": [{"wall": "right", "position_cm": 250, "width_cm": 120}],
      "cell_cm": 10, "clearance_cm": 0
    }
"""

from __future__ import annotations

import json
import sys

from solver import (
    Door,
    FurnitureSpec,
    Room,
    SolveRequest,
    SolveResult,
    Wall,
    Window,
    solve,
)


def parse_request(data: dict) -> SolveRequest:
    r = data["room"]
    room = Room(r["width_cm"], r["length_cm"], r.get("height_cm", 270.0))
    furniture = [
        FurnitureSpec(f["id"], f["type"], f["width_cm"], f["depth_cm"], f.get("rule", "anywhere"))
        for f in data.get("furniture", [])
    ]
    doors = [Door(Wall(d["wall"]), d["position_cm"], d["width_cm"], d.get("swing_cm")) for d in data.get("doors", [])]
    windows = [Window(Wall(w["wall"]), w["position_cm"], w["width_cm"]) for w in data.get("windows", [])]
    return SolveRequest(
        room=room,
        furniture=furniture,
        doors=doors,
        windows=windows,
        cell_cm=data.get("cell_cm", 10.0),
        clearance_cm=data.get("clearance_cm", 0.0),
    )


def result_to_dict(res: SolveResult) -> dict:
    return {
        "placements": [
            {"id": p.id, "type": p.type, "x_cm": p.x_cm, "y_cm": p.y_cm, "rotation_deg": p.rotation_deg}
            for p in res.placements
        ],
        "unplaced": res.unplaced,
    }


_DEMO = {
    "room": {"width_cm": 400, "length_cm": 500, "height_cm": 270},
    "furniture": [
        {"id": "bed", "type": "double_bed", "width_cm": 150, "depth_cm": 200, "rule": "against_wall"},
        {"id": "wardrobe", "type": "wardrobe", "width_cm": 120, "depth_cm": 60, "rule": "against_solid_wall"},
        {"id": "chair", "type": "lounge_chair", "width_cm": 70, "depth_cm": 70, "rule": "near_window"},
        {"id": "lamp", "type": "floor_lamp", "width_cm": 40, "depth_cm": 40, "rule": "next_to:chair"},
    ],
    "doors": [{"wall": "bottom", "position_cm": 200, "width_cm": 90}],
    "windows": [{"wall": "right", "position_cm": 250, "width_cm": 120}],
}


def main(argv: list[str]) -> int:
    if "--demo" in argv:
        data = _DEMO
    elif len(argv) > 1:
        with open(argv[1], encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = json.load(sys.stdin)

    result = solve(parse_request(data))
    json.dump(result_to_dict(result), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
