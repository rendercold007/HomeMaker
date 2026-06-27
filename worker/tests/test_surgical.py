"""
Tests for surgical structural edits (surgical.py, v3).

The contract that matters: a structural edit touches ONLY what it must. Untouched
rooms keep their exact walls and furniture; openings on walls that didn't move
are preserved (and ones on walls that DID move follow them); the footprint never
changes. When the floor isn't a clean rectangle tiling, apply_surgical returns
None so the caller falls back to the v2 full re-flow.
"""

import unittest

import surgical
from surgical import apply_surgical, build_boxes, is_clean_tiling


def _floor():
    """600x300cm: Living | Kitchen | Bedroom, each 200 wide, in a row.
    Living: window on its top (exterior) + door into the kitchen + a sofa.
    Kitchen: door into the bedroom. Bedroom: a double bed."""
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
        {"id": "dkb", "wallId": "D2", "kind": "door", "offset": 100, "width": 90},
    ]
    furniture = [
        {"id": "f_sofa", "type": "sofa", "x": 100, "y": 60, "rotationDeg": 0, "roomId": "rL"},
        {"id": "f_bed", "type": "double_bed", "x": 500, "y": 150, "rotationDeg": 0, "roomId": "rB"},
    ]
    return {"points": points, "walls": walls, "openings": openings, "rooms": rooms, "furniture": furniture}


def _footprint(op):
    xs = [p["x"] for p in op["points"]]
    ys = [p["y"] for p in op["points"]]
    return (min(xs), min(ys), max(xs), max(ys))


def _kinds(op):
    return sorted(o["kind"] for o in op["openings"])


class TestRectModel(unittest.TestCase):
    def test_build_boxes_recovers_rectangles_in_order(self):
        boxes = build_boxes(_floor())
        self.assertEqual([b.name for b in boxes], ["Living", "Kitchen", "Bedroom"])
        self.assertEqual(boxes[0].rect, (0, 0, 200, 300))
        self.assertEqual(boxes[1].rect, (200, 0, 400, 300))

    def test_clean_tiling_detected(self):
        self.assertTrue(is_clean_tiling(build_boxes(_floor())))

    def test_overlapping_rooms_are_not_clean(self):
        boxes = build_boxes(_floor())
        boxes[1].rect = (150, 0, 400, 300)  # kitchen now overlaps living
        self.assertFalse(is_clean_tiling(boxes))


class TestResize(unittest.TestCase):
    def test_enlarge_keeps_footprint_and_untouched_room(self):
        op = apply_surgical(_floor(), [{"op": "resize_room", "room": "kitchen", "direction": "bigger"}])["patch"][0]
        self.assertEqual(_footprint(op), (0, 0, 600, 300))
        # All three rooms still present; both openings preserved.
        self.assertEqual({r["name"] for r in op["rooms"]}, {"Living", "Kitchen", "Bedroom"})
        self.assertEqual(_kinds(op), ["door", "door", "window"])

    def test_living_stays_put_when_kitchen_grows_into_bedroom(self):
        op = apply_surgical(_floor(), [{"op": "resize_room", "room": "kitchen", "direction": "bigger"}])["patch"][0]
        living = next(r for r in op["rooms"] if r["name"] == "Living")
        # Living's centre is unchanged — it did not move.
        self.assertEqual((living["cx"], living["cy"]), (100, 150))
        # And its sofa stayed exactly where it was.
        sofa = next(f for f in op["furniture"] if f["type"] == "sofa")
        self.assertEqual((sofa["x"], sofa["y"]), (100, 60))

    def test_shrink_keeps_the_door_on_the_moved_wall(self):
        # Shrinking the living room moves the living|kitchen wall; the door on it
        # must follow, not vanish.
        op = apply_surgical(_floor(), [{"op": "resize_room", "room": "living", "factor": 0.6}])["patch"][0]
        self.assertEqual(_kinds(op), ["door", "door", "window"])


class TestRemove(unittest.TestCase):
    def test_remove_keeps_footprint_and_drops_only_the_merged_wall(self):
        op = apply_surgical(_floor(), [{"op": "remove_room", "room": "kitchen"}])["patch"][0]
        self.assertEqual(_footprint(op), (0, 0, 600, 300))
        self.assertEqual({r["name"] for r in op["rooms"]}, {"Living", "Bedroom"})
        # The living|kitchen door is interior to the merged room → gone; the
        # kitchen|bedroom door survives (re-homed to the absorber) + window.
        self.assertEqual(_kinds(op), ["door", "window"])

    def test_remove_drops_removed_rooms_furniture_but_keeps_others(self):
        floor = _floor()
        floor["furniture"].append({"id": "f_counter", "type": "counter", "x": 300, "y": 60, "rotationDeg": 0, "roomId": "rK"})
        op = apply_surgical(floor, [{"op": "remove_room", "room": "kitchen"}])["patch"][0]
        types = [f["type"] for f in op["furniture"]]
        self.assertIn("sofa", types)
        self.assertIn("double_bed", types)
        self.assertNotIn("counter", types)


class TestAdd(unittest.TestCase):
    def test_add_splits_a_donor_and_furnishes_the_new_room(self):
        res = apply_surgical(_floor(), [{"op": "add_room", "type": "study", "name": "Study"}])
        op = res["patch"][0]
        self.assertEqual(_footprint(op), (0, 0, 600, 300))
        self.assertIn("Study", [r["name"] for r in op["rooms"]])
        self.assertEqual(len(op["rooms"]), 4)

    def test_new_room_gets_a_door(self):
        op = apply_surgical(_floor(), [{"op": "add_room", "type": "study"}])["patch"][0]
        # 3 original openings + a door for the new room.
        self.assertEqual(op["openings"].__len__(), 4)


class TestSwap(unittest.TestCase):
    def test_swap_exchanges_identity_without_moving_walls(self):
        op = apply_surgical(_floor(), [{"op": "swap_rooms", "room": "kitchen", "with": "bedroom"}])["patch"][0]
        self.assertEqual(_footprint(op), (0, 0, 600, 300))
        # Kitchen now sits where the bedroom was (cx 500) and vice versa.
        kitchen = next(r for r in op["rooms"] if r["name"] == "Kitchen")
        bedroom = next(r for r in op["rooms"] if r["name"] == "Bedroom")
        self.assertEqual(kitchen["cx"], 500)
        self.assertEqual(bedroom["cx"], 300)

    def test_swap_leaves_openings_untouched(self):
        op = apply_surgical(_floor(), [{"op": "swap_rooms", "room": "kitchen", "with": "bedroom"}])["patch"][0]
        self.assertEqual(_kinds(op), ["door", "door", "window"])


class TestFallback(unittest.TestCase):
    def test_non_rectangular_tiling_returns_none(self):
        floor = _floor()
        # Punch a hole in the tiling so it's no longer clean → caller falls back.
        floor["rooms"][1]["wallIds"] = ["t1"]  # kitchen loses its box
        floor["points"].append({"id": "px", "x": 250, "y": 150})
        self.assertIsNone(apply_surgical(floor, [{"op": "resize_room", "room": "living", "direction": "bigger"}]))

    def test_unresolved_room_returns_none(self):
        self.assertIsNone(apply_surgical(_floor(), [{"op": "resize_room", "room": "garage", "direction": "bigger"}]))

    def test_no_structural_change_returns_none(self):
        self.assertIsNone(apply_surgical(_floor(), []))


if __name__ == "__main__":
    unittest.main()
