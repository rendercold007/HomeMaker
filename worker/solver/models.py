"""
Data models for the spatial solver (Phase 4 · Step 2).

Everything is in CENTIMETRES, integer-friendly — matching the app's core model
and the doc's "10 cm grid". The solver is the deterministic half of the pipeline:
it never talks to an LLM. It receives a room, a list of furniture (each with a
bounding box + a placement *rule*), and the openings (doors/windows), and returns
collision-free centre coordinates + an orthogonal rotation.

Coordinate frame (room-local):
  - origin (0, 0) at a corner; x spans the room WIDTH, y spans the LENGTH (depth).
  - furniture (x, y) is the item CENTRE, like the app's Furniture.
  - rotation_deg is orthogonal {0, 90, 180, 270}, clockwise.

Wire/units note: the gateway converts cm -> metres (÷100) and y -> z when it maps
a Placement onto the AutoFurnish contract (see src/lib/aiPipeline/contract.ts).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Wall(str, Enum):
    """Which side of the (rectangular) room an opening sits on."""

    TOP = "top"        # y = 0
    BOTTOM = "bottom"  # y = length
    LEFT = "left"      # x = 0
    RIGHT = "right"    # x = width


@dataclass(frozen=True)
class Room:
    """An axis-aligned rectangular room envelope, in cm."""

    width_cm: float   # x extent
    length_cm: float  # y extent (depth)
    height_cm: float = 270.0


@dataclass(frozen=True)
class Door:
    """A door on a wall. Its swing path is treated as impassable."""

    wall: Wall
    position_cm: float       # centre offset along the wall
    width_cm: float
    swing_cm: float | None = None  # reach into the room; defaults to width_cm


@dataclass(frozen=True)
class Window:
    """A window on a wall — the anchor for the `near_window` rule."""

    wall: Wall
    position_cm: float
    width_cm: float


@dataclass(frozen=True)
class FurnitureSpec:
    """One item to place: a bounding box (cm) plus a placement rule.

    Supported rules:
      - "against_wall"        back to any wall (solid walls preferred)
      - "against_solid_wall"  back to a wall with no door/window
      - "near_window"         beside a window
      - "next_to:<id>"        adjacent to an already-placed item
      - "center"              room centre, spiralling out if blocked
      - "anywhere" (default)  first free spot, row-major

    width_cm/depth_cm are the footprint at rotation 0 (width along x, depth y).
    """

    id: str
    type: str
    width_cm: float
    depth_cm: float
    rule: str = "anywhere"


@dataclass(frozen=True)
class Placement:
    """A solved placement: item centre (cm) + orthogonal rotation."""

    id: str
    type: str
    x_cm: float
    y_cm: float
    rotation_deg: int


@dataclass
class SolveRequest:
    """Everything the solver needs for one room."""

    room: Room
    furniture: list[FurnitureSpec]
    doors: list[Door] = field(default_factory=list)
    windows: list[Window] = field(default_factory=list)
    cell_cm: float = 10.0
    clearance_cm: float = 0.0  # min gap from walls; 0 allows flush placement
    # Pre-occupied AABBs (room-local cm: min_x, min_y, max_x, max_y) that new
    # items must avoid — e.g. furniture already in the room during an edit. Same
    # mechanism as door swings; empty by default so generation is unaffected.
    obstacles: list[tuple[float, float, float, float]] = field(default_factory=list)


@dataclass
class SolveResult:
    placements: list[Placement]
    unplaced: list[str]  # ids that could not be fit
