"""
Tests for the multi-room layout generator (Phase 4) — deterministic, offline.

The load-bearing check is Euler's formula: for a connected planar wall graph,
the number of enclosed regions (rooms) equals  walls - points + 1. If that holds,
the wall graph is topologically a valid set of N rooms — exactly what the
frontend's cycle-detection room finder expects.
"""

import unittest

from layout import RoomRequest, bsp_layout, build_graph, generate_plan

PLOT = (0, 0, 914, 1219)  # the app's default plot (cm)

ROOMS = [
    RoomRequest("Living Room", "living", 3),
    RoomRequest("Bedroom", "bedroom", 2),
    RoomRequest("Kitchen", "kitchen", 1.5),
    RoomRequest("Bathroom", "bathroom", 1),
]


def _area(rect):
    x0, y0, x1, y1 = rect
    return (x1 - x0) * (y1 - y0)


def _overlap(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


class TestLayout(unittest.TestCase):
    def test_rooms_tile_the_plot_without_overlap(self):
        placed = bsp_layout(*PLOT, ROOMS)
        self.assertEqual(len(placed), len(ROOMS))
        rects = [p.rect for p in placed]
        # exact tiling: room areas sum to plot area
        self.assertEqual(sum(_area(r) for r in rects), _area(PLOT))
        # pairwise disjoint
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                self.assertFalse(_overlap(rects[i], rects[j]), f"room {i} overlaps room {j}")
        # all inside the plot
        for r in rects:
            self.assertGreaterEqual(r[0], PLOT[0])
            self.assertGreaterEqual(r[1], PLOT[1])
            self.assertLessEqual(r[2], PLOT[2])
            self.assertLessEqual(r[3], PLOT[3])

    def test_wall_graph_encloses_exactly_n_rooms(self):
        placed = bsp_layout(*PLOT, ROOMS)
        points, walls, _ = build_graph(placed)
        V, E = len(points), len(walls)
        # Euler: enclosed faces = E - V + 1 (connected planar graph)
        self.assertEqual(E - V + 1, len(ROOMS), "wall graph must enclose exactly N rooms")

    def test_walls_and_openings_reference_valid_ids(self):
        plan = generate_plan(PLOT, ROOMS)["plan"]
        point_ids = {p["id"] for p in plan["points"]}
        wall_ids = {w["id"] for w in plan["walls"]}
        self.assertTrue(point_ids)
        for w in plan["walls"]:
            self.assertIn(w["a"], point_ids)
            self.assertIn(w["b"], point_ids)
            self.assertNotEqual(w["a"], w["b"])
        for o in plan["openings"]:
            self.assertIn(o["wallId"], wall_ids)
            self.assertGreater(o["width"], 0)
            self.assertIn(o["kind"], ("door", "window"))

    def test_points_have_unique_coordinates(self):
        plan = generate_plan(PLOT, ROOMS)["plan"]
        coords = [(p["x"], p["y"]) for p in plan["points"]]
        self.assertEqual(len(coords), len(set(coords)), "no duplicate points")

    def test_has_doors_connecting_rooms_and_some_windows(self):
        plan = generate_plan(PLOT, ROOMS)["plan"]
        doors = [o for o in plan["openings"] if o["kind"] == "door"]
        windows = [o for o in plan["openings"] if o["kind"] == "window"]
        # n-1 interior doors (spanning tree) + 1 entrance = at least n-1
        self.assertGreaterEqual(len(doors), len(ROOMS) - 1)
        self.assertGreaterEqual(len(windows), 1)

    def test_furniture_inside_plot(self):
        plan = generate_plan(PLOT, ROOMS)["plan"]
        self.assertTrue(plan["furniture"])
        for f in plan["furniture"]:
            self.assertGreaterEqual(f["x"], PLOT[0])
            self.assertLessEqual(f["x"], PLOT[2])
            self.assertGreaterEqual(f["y"], PLOT[1])
            self.assertLessEqual(f["y"], PLOT[3])

    def test_deterministic(self):
        a = generate_plan(PLOT, ROOMS)
        b = generate_plan(PLOT, ROOMS)
        self.assertEqual(a, b)

    def test_single_room(self):
        placed = bsp_layout(*PLOT, [RoomRequest("Studio", "living", 1)])
        points, walls, _ = build_graph(placed)
        # one room = a rectangle: 4 corners, 4 walls
        self.assertEqual(len(points), 4)
        self.assertEqual(len(walls), 4)
        self.assertEqual(len(walls) - len(points) + 1, 1)


if __name__ == "__main__":
    unittest.main()
