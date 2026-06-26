"""
Furniture catalog (Phase 4 · Step 3) — the Python mirror of the frontend's
src/model/furniture.ts.

It serves two roles until the vector DB lands (step 4):
  1. **Dimension source** — maps a furniture `type` to its footprint (cm) so the
     solver knows how big each item is.
  2. **Allowed vocabulary** — the set of types the LLM may choose from, so every
     generated item maps to a real 3D mesh (FurnitureMesh.tsx) and real size.

Footprints are (width_cm, depth_cm) at rotation 0, matching the TS catalog's
(widthCm, heightCm).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dims:
    width_cm: float
    depth_cm: float


# Keep in sync with src/model/furniture.ts FURNITURE_CATALOG.
CATALOG: dict[str, Dims] = {
    # Bedroom
    "double_bed": Dims(150, 195),
    "single_bed": Dims(90, 195),
    "wardrobe": Dims(120, 60),
    "side_table": Dims(45, 45),
    # Living
    "sofa": Dims(210, 90),
    "coffee_table": Dims(110, 60),
    "tv_unit": Dims(150, 40),
    "bookshelf": Dims(90, 30),
    # Dining
    "dining_table": Dims(120, 75),
    "chair": Dims(45, 45),
    # Kitchen
    "kitchen_counter": Dims(180, 60),
    "kitchen_island": Dims(120, 80),
    "kitchen_sink": Dims(80, 55),
    "stove": Dims(60, 60),
    "fridge": Dims(70, 70),
    "chimney": Dims(60, 40),
    # Bathroom
    "toilet": Dims(40, 60),
    "wash_basin": Dims(50, 40),
    "vanity": Dims(90, 50),
    "shower": Dims(90, 90),
    "bathtub": Dims(170, 75),
    "mirror": Dims(60, 10),
    "towel_rail": Dims(60, 10),
    "geyser": Dims(45, 30),
    "washing_machine": Dims(60, 60),
    # Study & misc
    "desk": Dims(120, 60),
    "staircase": Dims(100, 250),
    "pooja_unit": Dims(90, 45),
}

# Fallback for a type the LLM invents that isn't in the catalog. The item still
# gets placed (and renders as a generic box in 3D).
DEFAULT_DIMS = Dims(60, 60)


def lookup(furniture_type: str) -> Dims:
    return CATALOG.get(furniture_type, DEFAULT_DIMS)


def allowed_types() -> list[str]:
    return list(CATALOG.keys())
