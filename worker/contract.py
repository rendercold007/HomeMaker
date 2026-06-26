"""
Wire contract for the worker (Phase 4 · Step 3).

Mirrors src/lib/aiPipeline/contract.ts. Units on the wire are METRES; the solver
works in centimetres, so the pipeline converts. Doors/windows arrive as points
[x, z] (m); the solver wants a wall + offset, derived in pipeline.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class RoomDimensions:
    width: float   # metres, along x
    length: float  # metres, along z (depth)
    height: float = 2.7


@dataclass(frozen=True)
class Opening:
    position: tuple[float, float]  # [x, z] in metres
    width: float                   # metres


@dataclass
class RoomSpec:
    dimensions: RoomDimensions
    doors: list[Opening] = field(default_factory=list)
    windows: list[Opening] = field(default_factory=list)


@dataclass
class AutoFurnishRequest:
    prompt: str
    room: RoomSpec


def _openings(raw: list) -> list[Opening]:
    out: list[Opening] = []
    for o in raw or []:
        pos = o["position"]
        out.append(Opening(position=(float(pos[0]), float(pos[1])), width=float(o["width"])))
    return out


def parse_request(data: dict) -> AutoFurnishRequest:
    room = data.get("room", {})
    dims = room.get("dimensions", {})
    dimensions = RoomDimensions(
        width=float(dims["width"]),
        length=float(dims["length"]),
        height=float(dims.get("height", 2.7)),
    )
    return AutoFurnishRequest(
        prompt=str(data.get("prompt", "")),
        room=RoomSpec(
            dimensions=dimensions,
            doors=_openings(room.get("doors", [])),
            windows=_openings(room.get("windows", [])),
        ),
    )
