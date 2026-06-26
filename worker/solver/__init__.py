"""Spatial solver package (Phase 4 · Step 2). Pure stdlib, deterministic."""

from .models import (
    Door,
    FurnitureSpec,
    Placement,
    Room,
    SolveRequest,
    SolveResult,
    Wall,
    Window,
)
from .solver import (
    aabb,
    boxes_overlap,
    door_swing_box,
    effective_dims,
    solve,
)

__all__ = [
    "Door",
    "FurnitureSpec",
    "Placement",
    "Room",
    "SolveRequest",
    "SolveResult",
    "Wall",
    "Window",
    "aabb",
    "boxes_overlap",
    "door_swing_box",
    "effective_dims",
    "solve",
]
