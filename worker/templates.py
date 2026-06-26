"""
Per-room furniture templates (Phase 4 — multi-room generation).

Deterministic, so multi-room generation needs only ONE LLM call (for the room
program) instead of one per room. Each entry is (furniture_type, rule); the
generator solves each room's template within that room's rectangle.

Types must exist in catalog.py; rules are the solver's (solver/models.py).
"""

# room type -> [(furniture_type, rule), ...]
TEMPLATES: dict[str, list[tuple[str, str]]] = {
    "living": [
        ("sofa", "against_wall"),
        ("tv_unit", "against_wall"),
        ("coffee_table", "center"),
        ("bookshelf", "against_solid_wall"),
    ],
    "bedroom": [
        ("double_bed", "against_wall"),
        ("wardrobe", "against_solid_wall"),
        ("side_table", "anywhere"),
    ],
    "kitchen": [
        ("kitchen_counter", "against_wall"),
        ("stove", "against_wall"),
        ("fridge", "against_wall"),
        ("kitchen_sink", "against_wall"),
    ],
    "bathroom": [
        ("toilet", "against_wall"),
        ("wash_basin", "against_wall"),
        ("shower", "against_wall"),
    ],
    "dining": [
        ("dining_table", "center"),
        ("chair", "anywhere"),
        ("chair", "anywhere"),
    ],
    "study": [
        ("desk", "against_wall"),
        ("bookshelf", "against_solid_wall"),
        ("chair", "anywhere"),
    ],
    "utility": [("washing_machine", "against_wall")],
    "pooja": [("pooja_unit", "against_wall")],
    "parking": [],
    "other": [],
}


def template_for(room_type: str) -> list[tuple[str, str]]:
    return TEMPLATES.get(room_type, [])
