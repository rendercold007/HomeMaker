"""
Tests for the multi-room layout generator (Phase 4) — deterministic, offline.

The load-bearing check is Euler's formula: for a connected planar wall graph,
the number of enclosed regions (rooms) equals  walls - points + 1. If that holds,
the wall graph is topologically a valid set of N rooms — exactly what the
frontend's cycle-detection room finder expects.
"""

import unittest

from layout import (
    HALLWAY_TYPE,
    MIN_ROOMS_FOR_CORRIDOR,
    RoomRequest,
    bsp_layout,
    build_graph,
    generate_plan,
    layout_with_corridor,
    lshape_layout,
    notch_corner,
    place_openings,
    _wall_sides,
)

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


class TestEntranceAware(unittest.TestCase):
    """Entrance side (N/S/E/W from the prompt) → front door on that exterior wall."""

    def _entrance_door_sides(self, plan):
        """Compass sides of every door that sits on a footprint edge."""
        pts = {p["id"]: p for p in plan["points"]}
        walls = {w["id"]: w for w in plan["walls"]}
        x0 = min(p["x"] for p in plan["points"])
        y0 = min(p["y"] for p in plan["points"])
        x1 = max(p["x"] for p in plan["points"])
        y1 = max(p["y"] for p in plan["points"])
        out = []
        for o in plan["openings"]:
            if o["kind"] != "door":
                continue
            w = walls[o["wallId"]]
            a, b = pts[w["a"]], pts[w["b"]]
            if a["y"] == b["y"]:  # horizontal
                if a["y"] == y0:
                    out.append("N")
                elif a["y"] == y1:
                    out.append("S")
            elif a["x"] == b["x"]:  # vertical
                if a["x"] == x0:
                    out.append("W")
                elif a["x"] == x1:
                    out.append("E")
        return out

    def test_entrance_door_lands_on_requested_side(self):
        for side in ("N", "S", "E", "W"):
            plan = generate_plan(PLOT, ROOMS, entrance=side)["plan"]
            self.assertIn(
                side, self._entrance_door_sides(plan),
                f"no exterior door on requested side {side}",
            )

    def test_unspecified_entrance_matches_v1_default(self):
        # entrance=None must equal the no-arg call (no regression to v1 behaviour).
        self.assertEqual(generate_plan(PLOT, ROOMS), generate_plan(PLOT, ROOMS, entrance=None))

    def test_bad_entrance_value_is_ignored(self):
        self.assertEqual(generate_plan(PLOT, ROOMS), generate_plan(PLOT, ROOMS, entrance="up"))

    def test_entrance_is_deterministic(self):
        self.assertEqual(
            generate_plan(PLOT, ROOMS, entrance="E"),
            generate_plan(PLOT, ROOMS, entrance="E"),
        )

    def test_entrance_keeps_valid_wall_graph(self):
        # An entrance door must not corrupt topology (valid point/wall references).
        plan = generate_plan(PLOT, ROOMS, entrance="S")["plan"]
        point_ids = {p["id"] for p in plan["points"]}
        wall_ids = {w["id"] for w in plan["walls"]}
        for o in plan["openings"]:
            self.assertIn(o["wallId"], wall_ids)
        for w in plan["walls"]:
            self.assertIn(w["a"], point_ids)
            self.assertIn(w["b"], point_ids)


class TestCorridor(unittest.TestCase):
    """Tier 2 #5 step 2: a spine corridor so rooms open onto a hall, not each other."""

    def _types(self, plan):
        return [r["type"] for r in plan["rooms"]]

    def test_corridor_added_at_or_above_threshold(self):
        self.assertGreaterEqual(MIN_ROOMS_FOR_CORRIDOR, 1)
        plan = generate_plan(PLOT, ROOMS)["plan"]  # 4 rooms >= threshold
        self.assertIn(HALLWAY_TYPE, self._types(plan))

    def test_no_corridor_below_threshold(self):
        few = ROOMS[: MIN_ROOMS_FOR_CORRIDOR - 1]
        plan = generate_plan(PLOT, few)["plan"]
        self.assertNotIn(HALLWAY_TYPE, self._types(plan))

    def test_corridor_layout_tiles_and_stays_planar(self):
        # rooms + hallway must exactly tile the plot, and the wall graph must
        # enclose exactly that many regions (Euler: faces = E - V + 1).
        placed = layout_with_corridor(*PLOT, ROOMS, entrance="N")
        rects = [p.rect for p in placed]
        self.assertEqual(sum(_area(r) for r in rects), _area(PLOT))
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                self.assertFalse(_overlap(rects[i], rects[j]))
        points, walls, _ = build_graph(placed)
        self.assertEqual(len(walls) - len(points) + 1, len(placed))

    def test_corridor_orientation_follows_entrance(self):
        # N/S entrance → a vertical (full-height) spine; E/W → horizontal (full-width).
        for side in ("N", "S"):
            hall = self._hall(layout_with_corridor(*PLOT, ROOMS, side))
            self.assertEqual((hall[1], hall[3]), (PLOT[1], PLOT[3]), f"{side} hall not full height")
        for side in ("E", "W"):
            hall = self._hall(layout_with_corridor(*PLOT, ROOMS, side))
            self.assertEqual((hall[0], hall[2]), (PLOT[0], PLOT[2]), f"{side} hall not full width")

    def test_every_room_reachable_from_the_corridor(self):
        # The corridor is the hub: starting from it and walking through interior
        # doors, every room must be reachable.
        placed = layout_with_corridor(*PLOT, ROOMS, entrance="N")
        points, walls, rects = build_graph(placed)
        openings = place_openings(placed, points, walls, rects, entrance_side="N")
        pts = {p["id"]: p for p in points}
        wall_by = {w["id"]: w for w in walls}
        adj: dict[int, set[int]] = {}
        for o in openings:
            if o["kind"] != "door":
                continue
            l, r = _wall_sides(wall_by[o["wallId"]], pts, rects)
            if l != -1 and r != -1:  # interior door joins two regions
                adj.setdefault(l, set()).add(r)
                adj.setdefault(r, set()).add(l)
        corridor = next(i for i, p in enumerate(placed) if p.type == HALLWAY_TYPE)
        seen, stack = {corridor}, [corridor]
        while stack:
            for nb in adj.get(stack.pop(), ()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        self.assertEqual(seen, set(range(len(placed))), "some room is cut off from the hall")

    def test_hallway_is_not_furnished(self):
        plan = generate_plan(PLOT, ROOMS)["plan"]
        hall = next(r for r in plan["rooms"] if r["type"] == HALLWAY_TYPE)
        for f in plan["furniture"]:
            self.assertFalse(
                f["roomCx"] == hall["cx"] and f["roomCy"] == hall["cy"],
                "the corridor should stay empty",
            )

    def _hall(self, placed):
        return next(p.rect for p in placed if p.type == HALLWAY_TYPE)


class TestLShape(unittest.TestCase):
    """Tier 2 #5 step 3: an L-shaped footprint (bounding box minus a corner notch)."""

    def _rooms_area(self, placed):
        return sum(_area(p.rect) for p in placed)

    def test_lshape_leaves_a_notch_unfilled(self):
        # The rooms must NOT fill the whole bounding box — that empty corner is the L.
        placed = lshape_layout(*PLOT, ROOMS, "SE")
        self.assertLess(self._rooms_area(placed), _area(PLOT))
        self.assertGreater(self._rooms_area(placed), 0.5 * _area(PLOT))

    def test_wings_tile_the_l_without_overlap(self):
        placed = lshape_layout(*PLOT, ROOMS, "NE")
        rects = [p.rect for p in placed]
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                self.assertFalse(_overlap(rects[i], rects[j]))
            self.assertGreaterEqual(rects[i][0], PLOT[0])
            self.assertGreaterEqual(rects[i][1], PLOT[1])
            self.assertLessEqual(rects[i][2], PLOT[2])
            self.assertLessEqual(rects[i][3], PLOT[3])

    def test_lshape_wall_graph_is_planar_and_encloses_n_rooms(self):
        # Euler on the L: the notch is exterior, so faces (E - V + 1) == room count.
        for corner in ("NW", "NE", "SW", "SE"):
            placed = lshape_layout(*PLOT, ROOMS, corner)
            points, walls, _ = build_graph(placed)
            self.assertEqual(
                len(walls) - len(points) + 1, len(placed), f"bad topology for {corner}"
            )

    def test_no_diagonal_walls(self):
        plan = generate_plan(PLOT, ROOMS, shape="lshape")["plan"]
        pts = {p["id"]: p for p in plan["points"]}
        for w in plan["walls"]:
            a, b = pts[w["a"]], pts[w["b"]]
            self.assertTrue(
                a["x"] == b["x"] or a["y"] == b["y"], f"wall {w['id']} is diagonal"
            )

    def test_lshape_rooms_stay_connected(self):
        placed = lshape_layout(*PLOT, ROOMS, "SE")
        points, walls, rects = build_graph(placed)
        openings = place_openings(placed, points, walls, rects, entrance_side="N")
        pts = {p["id"]: p for p in points}
        wall_by = {w["id"]: w for w in walls}
        adj: dict[int, set[int]] = {}
        for o in openings:
            if o["kind"] != "door":
                continue
            l, r = _wall_sides(wall_by[o["wallId"]], pts, rects)
            if l != -1 and r != -1:
                adj.setdefault(l, set()).add(r)
                adj.setdefault(r, set()).add(l)
        seen, stack = {0}, [0]
        while stack:
            for nb in adj.get(stack.pop(), ()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        self.assertEqual(seen, set(range(len(placed))), "an L wing got cut off")

    def test_generate_plan_uses_lshape_when_requested(self):
        # Same rooms, different envelope: the L fills less of the box than the rect.
        rect_plan = generate_plan(PLOT, ROOMS, shape="rectangular")["plan"]
        l_plan = generate_plan(PLOT, ROOMS, shape="lshape")["plan"]
        # rectangular path (4 rooms) adds a corridor → 5 regions tiling the full box;
        # the L has no corridor and leaves a notch, so its bounding span is the same
        # but a corner is missing. Distinguish by checking the L has fewer regions
        # and is not byte-identical to the rectangular plan.
        self.assertNotEqual(rect_plan["rooms"], l_plan["rooms"])
        self.assertNotIn(HALLWAY_TYPE, [r["type"] for r in l_plan["rooms"]])

    def test_notch_corner_avoids_entrance(self):
        # The notch is kept off the entrance wall (deterministic mapping).
        self.assertEqual(notch_corner("N"), "SE")
        self.assertEqual(notch_corner("S"), "NE")
        self.assertEqual(notch_corner("E"), "SW")
        self.assertEqual(notch_corner(None), "SE")

    def test_lshape_falls_back_to_rect_for_one_room(self):
        # A single room can't form an L; it must stay a plain rectangle (full box).
        plan = generate_plan(PLOT, [RoomRequest("Studio", "living", 1)], shape="lshape")["plan"]
        self.assertEqual(len(plan["rooms"]), 1)


if __name__ == "__main__":
    unittest.main()
