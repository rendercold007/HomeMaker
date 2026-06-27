"""
Tests for the iterative-editing resolver (Phase 4 — v1) — offline, no LLM.

apply_edits takes a floor + a list of edit COMMANDS (what a fake LLM would emit)
and returns a concrete id-level patch. We assert the patch targets the right ids,
furniture lands in the right room without overlapping what's there, and that
unsupported/structural requests degrade into warnings rather than changes.
"""

import unittest

from edits import apply_edits, summarize_floor
from catalog import lookup
from solver import FurnitureSpec, aabb, boxes_overlap, effective_dims


def _floor():
    """A 400x300 cm floor split into two rooms sharing one interior wall.

    Room A "Living" = (0,0)-(200,300); Room B "Bedroom" = (200,0)-(400,300).
    Living has a coffee_table at its centre and a window on its left wall.
    """
    points = [
        {"id": "p0", "x": 0, "y": 0},
        {"id": "p1", "x": 200, "y": 0},
        {"id": "p2", "x": 400, "y": 0},
        {"id": "p3", "x": 0, "y": 300},
        {"id": "p4", "x": 200, "y": 300},
        {"id": "p5", "x": 400, "y": 300},
    ]
    walls = [
        {"id": "wTL", "a": "p0", "b": "p1", "thickness": 10, "height": 270},  # A top
        {"id": "wTR", "a": "p1", "b": "p2", "thickness": 10, "height": 270},  # B top
        {"id": "wL", "a": "p0", "b": "p3", "thickness": 10, "height": 270},   # A left (ext)
        {"id": "wMID", "a": "p1", "b": "p4", "thickness": 10, "height": 270}, # shared (int)
        {"id": "wR", "a": "p2", "b": "p5", "thickness": 10, "height": 270},   # B right (ext)
        {"id": "wBL", "a": "p3", "b": "p4", "thickness": 10, "height": 270},  # A bottom
        {"id": "wBR", "a": "p4", "b": "p5", "thickness": 10, "height": 270},  # B bottom
    ]
    openings = [
        {"id": "oWin", "wallId": "wL", "kind": "window", "offset": 90, "width": 120},
    ]
    furniture = [
        {"id": "fTable", "type": "coffee_table", "x": 100, "y": 150, "rotationDeg": 0, "roomId": "roomA"},
    ]
    rooms = [
        {"id": "roomA", "wallIds": ["wTL", "wL", "wMID", "wBL"], "name": "Living", "type": "living", "areaCm2": 60000},
        {"id": "roomB", "wallIds": ["wTR", "wMID", "wR", "wBR"], "name": "Bedroom", "type": "bedroom", "areaCm2": 60000},
    ]
    return {"points": points, "walls": walls, "openings": openings, "furniture": furniture, "rooms": rooms}


def _box(item: dict):
    dims = lookup(item["type"])
    spec = FurnitureSpec(item.get("id", "x"), item["type"], dims.width_cm, dims.depth_cm)
    ew, eh = effective_dims(spec, int(item["rotationDeg"]) % 360)
    return aabb(item["x"], item["y"], ew, eh)


class TestApplyEdits(unittest.TestCase):
    def test_add_furniture_places_in_room_without_overlap(self):
        res = apply_edits(_floor(), [
            {"op": "add_furniture", "room": "Living", "items": [{"type": "chair", "rule": "anywhere"}]},
        ])
        adds = [op for op in res["patch"] if op["op"] == "addFurniture"]
        self.assertEqual(len(adds), 1)
        items = adds[0]["items"]
        self.assertEqual(len(items), 1)
        chair = items[0]
        self.assertEqual(chair["roomId"], "roomA")
        # in Living's box and not overlapping the existing coffee_table
        self.assertTrue(0 <= chair["x"] <= 200 and 0 <= chair["y"] <= 300)
        existing = {"id": "fTable", "type": "coffee_table", "x": 100, "y": 150, "rotationDeg": 0}
        self.assertFalse(boxes_overlap(_box({**chair, "id": "c"}), _box(existing)))

    def test_add_furniture_resolves_room_by_type(self):
        res = apply_edits(_floor(), [
            {"op": "add_furniture", "room": "bedroom", "items": [{"type": "double_bed", "rule": "against_wall"}]},
        ])
        items = res["patch"][0]["items"]
        self.assertEqual(items[0]["roomId"], "roomB")

    def test_remove_furniture_by_match(self):
        res = apply_edits(_floor(), [
            {"op": "remove_furniture", "room": "Living", "match": "coffee_table"},
        ])
        self.assertEqual(res["patch"], [{"op": "removeFurniture", "ids": ["fTable"]}])

    def test_remove_furniture_no_match_warns(self):
        res = apply_edits(_floor(), [
            {"op": "remove_furniture", "room": "Living", "match": "sofa"},
        ])
        self.assertEqual(res["patch"], [])
        self.assertTrue(res["warnings"])

    def test_add_window_uses_an_exterior_wall(self):
        res = apply_edits(_floor(), [
            {"op": "add_opening", "room": "Bedroom", "kind": "window", "wall": "exterior"},
        ])
        adds = [op for op in res["patch"] if op["op"] == "addOpening"]
        self.assertEqual(len(adds), 1)
        opening = adds[0]["openings"][0]
        self.assertEqual(opening["kind"], "window")
        # exterior walls of Bedroom are wR/wBR/wTR — never the shared wMID
        self.assertIn(opening["wallId"], {"wR", "wBR", "wTR"})

    def test_add_interior_door_uses_shared_wall(self):
        res = apply_edits(_floor(), [
            {"op": "add_opening", "room": "Living", "kind": "door", "wall": "interior"},
        ])
        opening = res["patch"][0]["openings"][0]
        self.assertEqual(opening["wallId"], "wMID")
        self.assertEqual(opening["kind"], "door")

    def test_remove_opening_from_room(self):
        res = apply_edits(_floor(), [
            {"op": "remove_opening", "room": "Living", "kind": "window"},
        ])
        self.assertEqual(res["patch"], [{"op": "removeOpening", "ids": ["oWin"]}])

    def test_rename_and_set_type(self):
        res = apply_edits(_floor(), [
            {"op": "rename_room", "room": "Bedroom", "name": "Study"},
            {"op": "set_room_type", "room": "Bedroom", "type": "study"},
        ])
        self.assertEqual(res["patch"], [
            {"op": "setRoomName", "roomId": "roomB", "name": "Study"},
            {"op": "setRoomType", "roomId": "roomB", "type": "study"},
        ])

    def test_structural_resize_comes_back_as_replace_floor(self):
        # A resize comes back as one replaceFloor op (a whole new floor), not a
        # warning. v3 (surgical) handles this clean tiling: the footprint is fixed
        # and the existing window is preserved rather than regenerated.
        res = apply_edits(_floor(), [{"op": "resize_room", "room": "Living", "change": "bigger"}])
        self.assertEqual([op["op"] for op in res["patch"]], ["replaceFloor"])
        floor = res["patch"][0]
        self.assertEqual({r["name"] for r in floor["rooms"]}, {"Living", "Bedroom"})
        xs = [p["x"] for p in floor["points"]]
        ys = [p["y"] for p in floor["points"]]
        self.assertEqual((min(xs), min(ys), max(xs), max(ys)), (0, 0, 400, 300))
        self.assertIn("window", [o["kind"] for o in floor["openings"]])
        self.assertTrue(res["summary"].lower().startswith("enlarged"))
        self.assertFalse(res["warnings"])

    def test_move_room_still_warns(self):
        # move_room is the one structural intent v2 doesn't implement.
        res = apply_edits(_floor(), [{"op": "move_room", "room": "Living"}])
        self.assertEqual(res["patch"], [])
        self.assertTrue(res["warnings"])

    def test_unknown_op_ignored(self):
        res = apply_edits(_floor(), [{"op": "frobnicate", "room": "Living"}])
        self.assertEqual(res["patch"], [])
        self.assertTrue(res["warnings"])

    def test_unresolved_room_warns(self):
        res = apply_edits(_floor(), [
            {"op": "add_furniture", "room": "Garage", "items": [{"type": "chair"}]},
        ])
        self.assertEqual(res["patch"], [])
        self.assertTrue(res["warnings"])

    def test_compose_refurnish_as_remove_then_add(self):
        res = apply_edits(_floor(), [
            {"op": "remove_furniture", "room": "Living", "match": "all"},
            {"op": "add_furniture", "room": "Living", "items": [{"type": "tv_unit", "rule": "against_wall"}]},
        ])
        ops = [op["op"] for op in res["patch"]]
        self.assertEqual(ops, ["removeFurniture", "addFurniture"])

    def test_input_floor_not_mutated(self):
        floor = _floor()
        apply_edits(floor, [
            {"op": "remove_furniture", "room": "Living", "match": "all"},
            {"op": "add_furniture", "room": "Living", "items": [{"type": "tv_unit"}]},
            {"op": "add_opening", "room": "Bedroom", "kind": "window", "wall": "exterior"},
        ])
        self.assertEqual(len(floor["furniture"]), 1)  # original coffee_table untouched
        self.assertEqual(len(floor["openings"]), 1)   # original window untouched

    def test_summary_is_human_readable(self):
        res = apply_edits(_floor(), [
            {"op": "rename_room", "room": "Living", "name": "Lounge"},
        ])
        self.assertTrue(res["summary"].endswith("."))
        self.assertIn("Lounge", res["summary"])

    def test_summarize_floor_mentions_rooms(self):
        text = summarize_floor(_floor())
        self.assertIn("Living", text)
        self.assertIn("Bedroom", text)
        self.assertIn("coffee_table", text)


class TestClarifyBack(unittest.TestCase):
    def _two_bedroom_floor(self):
        floor = _floor()
        # Re-label both rooms as bedrooms so "the bedroom" is ambiguous.
        floor["rooms"][0].update(name="Bedroom 1", type="bedroom")
        floor["rooms"][1].update(name="Bedroom 2", type="bedroom")
        return floor

    def test_ambiguous_room_asks_instead_of_acting(self):
        res = apply_edits(self._two_bedroom_floor(), [
            {"op": "resize_room", "room": "bedroom", "change": "bigger"},
        ])
        self.assertEqual(res["patch"], [])  # nothing applied
        self.assertIn("Bedroom 1", res["summary"])
        self.assertIn("Bedroom 2", res["summary"])
        self.assertTrue(res["summary"].rstrip().endswith("?"))

    def test_specific_room_is_not_ambiguous(self):
        res = apply_edits(self._two_bedroom_floor(), [
            {"op": "rename_room", "room": "Bedroom 2", "name": "Study"},
        ])
        self.assertEqual([op["op"] for op in res["patch"]], ["setRoomName"])

    def test_model_clarify_op_passes_through(self):
        res = apply_edits(_floor(), [
            {"op": "clarify", "question": "What style are you going for?"},
        ])
        self.assertEqual(res["patch"], [])
        self.assertEqual(res["summary"], "What style are you going for?")

    def test_unique_handle_still_acts(self):
        # Sanity: with one Living, "living" resolves uniquely — no clarify.
        res = apply_edits(_floor(), [
            {"op": "rename_room", "room": "living", "name": "Lounge"},
        ])
        self.assertEqual([op["op"] for op in res["patch"]], ["setRoomName"])


if __name__ == "__main__":
    unittest.main()
