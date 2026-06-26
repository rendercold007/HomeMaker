"""
Tests for structural edits (Phase 4 — v2) — offline, no LLM.

restructure.py reconstructs a room program from a floor, applies a structural
change (resize/add/remove/swap a room), and re-flows it inside the same footprint
into one `replaceFloor` op. We assert the program math, the footprint is
preserved, room identity drives furniture carry-over, and the op shape matches
what applyGeneratedPlan consumes (roomCx/roomCy on furniture, name/type/cx/cy on
rooms).
"""

import unittest

from restructure import (
    apply_structural_command,
    build_program,
    restructure,
)


def _floor():
    """A 600x300 cm home of three 200-wide rooms in a row: Living | Kitchen |
    Bedroom. Living has a sofa; Bedroom has a bed (both tagged to their room)."""
    points = [
        {"id": "p0", "x": 0, "y": 0}, {"id": "p1", "x": 200, "y": 0},
        {"id": "p2", "x": 400, "y": 0}, {"id": "p3", "x": 600, "y": 0},
        {"id": "p4", "x": 0, "y": 300}, {"id": "p5", "x": 200, "y": 300},
        {"id": "p6", "x": 400, "y": 300}, {"id": "p7", "x": 600, "y": 300},
    ]
    w = lambda i, a, b: {"id": i, "a": a, "b": b, "thickness": 10, "height": 270}
    walls = [
        w("t0", "p0", "p1"), w("t1", "p1", "p2"), w("t2", "p2", "p3"),
        w("b0", "p4", "p5"), w("b1", "p5", "p6"), w("b2", "p6", "p7"),
        w("L", "p0", "p4"), w("R", "p3", "p7"), w("D1", "p1", "p5"), w("D2", "p2", "p6"),
    ]
    rooms = [
        {"id": "rLiving", "wallIds": ["t0", "D1", "b0", "L"], "name": "Living", "type": "living", "areaCm2": 60000},
        {"id": "rKitchen", "wallIds": ["t1", "D2", "b1", "D1"], "name": "Kitchen", "type": "kitchen", "areaCm2": 60000},
        {"id": "rBedroom", "wallIds": ["t2", "R", "b2", "D2"], "name": "Bedroom", "type": "bedroom", "areaCm2": 60000},
    ]
    furniture = [
        {"id": "fSofa", "type": "sofa", "x": 60, "y": 60, "rotationDeg": 0, "roomId": "rLiving"},
        {"id": "fBed", "type": "double_bed", "x": 470, "y": 100, "rotationDeg": 0, "roomId": "rBedroom"},
    ]
    return {"points": points, "walls": walls, "openings": [], "furniture": furniture, "rooms": rooms}


def _plot(op):
    xs = [p["x"] for p in op["points"]]
    ys = [p["y"] for p in op["points"]]
    return (min(xs), min(ys), max(xs), max(ys))


class TestBuildProgram(unittest.TestCase):
    def test_program_ordered_left_to_right_with_area_weights(self):
        prog = build_program(_floor())
        self.assertEqual([e["name"] for e in prog], ["Living", "Kitchen", "Bedroom"])
        self.assertEqual([e["room_id"] for e in prog], ["rLiving", "rKitchen", "rBedroom"])
        self.assertTrue(all(e["weight"] == 60000.0 for e in prog))


class TestStructuralCommands(unittest.TestCase):
    def test_resize_bigger_increases_weight(self):
        prog = build_program(_floor())
        summary, warnings = [], []
        ok = apply_structural_command(prog, {"op": "resize_room", "room": "Living", "change": "bigger"}, summary, warnings)
        self.assertTrue(ok)
        living = next(e for e in prog if e["name"] == "Living")
        self.assertGreater(living["weight"], 60000.0)
        self.assertEqual(warnings, [])

    def test_resize_smaller_and_explicit_factor(self):
        prog = build_program(_floor())
        apply_structural_command(prog, {"op": "resize_room", "room": "Kitchen", "change": "smaller"}, [], [])
        self.assertLess(next(e for e in prog if e["name"] == "Kitchen")["weight"], 60000.0)
        prog2 = build_program(_floor())
        apply_structural_command(prog2, {"op": "resize_room", "room": "Kitchen", "factor": 2}, [], [])
        self.assertEqual(next(e for e in prog2 if e["name"] == "Kitchen")["weight"], 120000.0)

    def test_add_room_appends_new_entry(self):
        prog = build_program(_floor())
        ok = apply_structural_command(prog, {"op": "add_room", "name": "Study", "type": "study"}, [], [])
        self.assertTrue(ok)
        self.assertEqual(prog[-1]["name"], "Study")
        self.assertIsNone(prog[-1]["room_id"])

    def test_remove_room_drops_entry(self):
        prog = build_program(_floor())
        ok = apply_structural_command(prog, {"op": "remove_room", "room": "Kitchen"}, [], [])
        self.assertTrue(ok)
        self.assertEqual([e["name"] for e in prog], ["Living", "Bedroom"])

    def test_cant_remove_last_room(self):
        prog = [{"name": "Only", "type": "living", "weight": 1.0, "room_id": "r", "bbox": (0, 0, 1, 1)}]
        warnings = []
        ok = apply_structural_command(prog, {"op": "remove_room", "room": "Only"}, [], warnings)
        self.assertFalse(ok)
        self.assertTrue(warnings)

    def test_swap_swaps_positions(self):
        prog = build_program(_floor())
        ok = apply_structural_command(prog, {"op": "swap_rooms", "room": "Living", "with": "Bedroom"}, [], [])
        self.assertTrue(ok)
        self.assertEqual([e["name"] for e in prog], ["Bedroom", "Kitchen", "Living"])

    def test_unresolved_handle_warns(self):
        warnings = []
        ok = apply_structural_command(build_program(_floor()), {"op": "resize_room", "room": "Garage"}, [], warnings)
        self.assertFalse(ok)
        self.assertTrue(warnings)


class TestRestructure(unittest.TestCase):
    def test_footprint_preserved_and_op_shape(self):
        floor = _floor()
        prog = build_program(floor)
        apply_structural_command(prog, {"op": "resize_room", "room": "Living", "change": "bigger"}, [], [])
        op = restructure(floor, prog)
        self.assertEqual(op["op"], "replaceFloor")
        self.assertEqual(_plot(op), (0, 0, 600, 300))  # outer size unchanged
        # rooms meta carries name/type/centroid; furniture carries roomCx/roomCy.
        self.assertEqual({r["name"] for r in op["rooms"]}, {"Living", "Kitchen", "Bedroom"})
        for f in op["furniture"]:
            self.assertIn("roomCx", f)
            self.assertIn("roomCy", f)

    def test_unchanged_room_keeps_furniture(self):
        # Swap Living<->Bedroom: both rooms keep their 200-wide box, so their
        # furniture is carried (translated), not dropped or re-furnished.
        floor = _floor()
        prog = build_program(floor)
        apply_structural_command(prog, {"op": "swap_rooms", "room": "Living", "with": "Bedroom"}, [], [])
        op = restructure(floor, prog)
        ftypes = sorted(f["type"] for f in op["furniture"])
        self.assertIn("sofa", ftypes)
        self.assertIn("double_bed", ftypes)

    def test_added_room_is_furnished_from_template(self):
        floor = _floor()
        prog = build_program(floor)
        apply_structural_command(prog, {"op": "add_room", "name": "Study", "type": "study"}, [], [])
        op = restructure(floor, prog)
        # The new study lands a desk (its template) — identified by its centroid.
        study = next(r for r in op["rooms"] if r["name"] == "Study")
        near = [f for f in op["furniture"] if f["roomCx"] == study["cx"] and f["roomCy"] == study["cy"]]
        self.assertTrue(any(f["type"] == "desk" for f in near))

    def test_removed_room_furniture_is_dropped(self):
        floor = _floor()
        prog = build_program(floor)
        apply_structural_command(prog, {"op": "remove_room", "room": "Bedroom"}, [], [])
        op = restructure(floor, prog)
        self.assertNotIn("double_bed", [f["type"] for f in op["furniture"]])
        self.assertNotIn("Bedroom", [r["name"] for r in op["rooms"]])


if __name__ == "__main__":
    unittest.main()
