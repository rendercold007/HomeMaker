"""
Tests for the spatial solver (Phase 4 · Step 2).

These ARE the step-2 acceptance criteria from docs/BackenAndAI.md: feed fake
furniture and assert the solver "spits out valid, non-overlapping coordinates".
We verify non-overlap with CONTINUOUS AABBs (independent of the solver's grid),
plus in-bounds, rule satisfaction, door-swing avoidance, and determinism.

Run from the worker/ directory:
    python3 -m unittest discover -s tests -t . -v
"""

import unittest

from solver import (
    Door,
    FurnitureSpec,
    Room,
    SolveRequest,
    Wall,
    Window,
    aabb,
    boxes_overlap,
    door_swing_box,
    effective_dims,
    solve,
)


def _specs_by_id(specs):
    return {s.id: s for s in specs}


def _boxes(result, specs_by_id):
    """AABB for every placement, recomputed from spec + solved rotation."""
    out = {}
    for p in result.placements:
        spec = specs_by_id[p.id]
        ew, eh = effective_dims(spec, p.rotation_deg)
        out[p.id] = aabb(p.x_cm, p.y_cm, ew, eh)
    return out


class TestSolver(unittest.TestCase):
    def test_no_overlap_and_in_bounds(self):
        room = Room(400, 500)
        specs = [
            FurnitureSpec("bed", "double_bed", 150, 200, "against_wall"),
            FurnitureSpec("wardrobe", "wardrobe", 120, 60, "against_wall"),
            FurnitureSpec("desk", "desk", 120, 60, "anywhere"),
            FurnitureSpec("side", "side_table", 45, 45, "anywhere"),
        ]
        res = solve(SolveRequest(room, specs))

        self.assertEqual(res.unplaced, [], "all items should fit in a 4x5 m room")
        boxes = _boxes(res, _specs_by_id(specs))

        for _id, b in boxes.items():
            self.assertGreaterEqual(b[0], -1e-6)
            self.assertGreaterEqual(b[1], -1e-6)
            self.assertLessEqual(b[2], room.width_cm + 1e-6)
            self.assertLessEqual(b[3], room.length_cm + 1e-6)

        ids = list(boxes)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                self.assertFalse(
                    boxes_overlap(boxes[ids[i]], boxes[ids[j]]),
                    f"{ids[i]} overlaps {ids[j]}",
                )

    def test_against_solid_wall_is_flush_and_avoids_opening(self):
        room = Room(400, 500)
        # Window on the TOP wall → solid walls are bottom/left/right.
        specs = [FurnitureSpec("shelf", "bookshelf", 90, 30, "against_solid_wall")]
        res = solve(SolveRequest(room, specs, windows=[Window(Wall.TOP, 200, 120)]))

        p = res.placements[0]
        b = _boxes(res, _specs_by_id(specs))["shelf"]
        gap_to_nearest_wall = min(b[0], b[1], room.width_cm - b[2], room.length_cm - b[3])
        self.assertLess(gap_to_nearest_wall, 1.0, "should be flush against a wall")
        self.assertGreater(b[1], 1.0, "should NOT pick the top wall (it has the window)")
        _ = p

    def test_near_window(self):
        room = Room(400, 500)
        win = Window(Wall.RIGHT, 250, 120)
        specs = [FurnitureSpec("chair", "lounge_chair", 70, 70, "near_window")]
        res = solve(SolveRequest(room, specs, windows=[win]))

        p = res.placements[0]
        self.assertGreater(p.x_cm, room.width_cm - 130, "should hug the window's (right) wall")
        self.assertLess(abs(p.y_cm - win.position_cm), 130, "should sit beside the window")

    def test_door_swing_is_kept_clear(self):
        room = Room(300, 300)
        door = Door(Wall.TOP, 150, 90)
        specs = [
            FurnitureSpec("bed", "double_bed", 150, 200, "anywhere"),
            FurnitureSpec("wardrobe", "wardrobe", 120, 60, "anywhere"),
        ]
        res = solve(SolveRequest(room, specs, doors=[door]))

        swing = door_swing_box(door, room)
        for _id, b in _boxes(res, _specs_by_id(specs)).items():
            self.assertFalse(boxes_overlap(b, swing), f"{_id} intrudes on the door swing")

    def test_next_to_is_adjacent_not_overlapping(self):
        room = Room(500, 500)
        specs = [
            FurnitureSpec("chair", "chair", 60, 60, "center"),
            FurnitureSpec("lamp", "floor_lamp", 40, 40, "next_to:chair"),
        ]
        res = solve(SolveRequest(room, specs))

        self.assertEqual(res.unplaced, [])
        boxes = _boxes(res, _specs_by_id(specs))
        chair, lamp = boxes["chair"], boxes["lamp"]
        self.assertFalse(boxes_overlap(chair, lamp))
        gap_x = max(lamp[0] - chair[2], chair[0] - lamp[2], 0.0)
        gap_y = max(lamp[1] - chair[3], chair[1] - lamp[3], 0.0)
        self.assertTrue(gap_x < 20 or gap_y < 20, "lamp should be adjacent to the chair")

    def test_unfittable_item_is_reported(self):
        room = Room(200, 200)
        specs = [FurnitureSpec("slab", "slab", 500, 500, "anywhere")]
        res = solve(SolveRequest(room, specs))

        self.assertEqual(res.placements, [])
        self.assertIn("slab", res.unplaced)

    def test_deterministic(self):
        room = Room(400, 500)
        specs = [
            FurnitureSpec("bed", "double_bed", 150, 200, "against_wall"),
            FurnitureSpec("wardrobe", "wardrobe", 120, 60, "against_wall"),
        ]
        a = solve(SolveRequest(room, specs))
        b = solve(SolveRequest(room, specs))
        key = lambda res: [(p.id, p.x_cm, p.y_cm, p.rotation_deg) for p in res.placements]
        self.assertEqual(key(a), key(b))


if __name__ == "__main__":
    unittest.main()
