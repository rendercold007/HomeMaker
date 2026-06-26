"""
Tests for the auto-furnish pipeline (Phase 4 · Step 3) — offline.

A fake LLM injects a fixed shopping list, so these exercise the full
request → solver → wire-response path with no network or API key. We assert the
wire shape, metre units, in-bounds placement, and end-to-end non-overlap.
"""

import unittest

from contract import parse_request
from llm import ShoppingItem
from pipeline import auto_furnish
from catalog import lookup
from solver import aabb, boxes_overlap, effective_dims, FurnitureSpec


def _fake_llm(items):
    return lambda prompt, room: items


def _request(extra_room=None):
    room = {"dimensions": {"width": 4, "length": 5, "height": 2.7}}
    if extra_room:
        room.update(extra_room)
    return parse_request({"prompt": "cozy modern bedroom", "room": room})


def _box_for(gen_item):
    """Reconstruct an AABB (cm) from a wire item, via the catalog dims + yaw."""
    dims = lookup(gen_item["type"])
    spec = FurnitureSpec(gen_item["type"], gen_item["type"], dims.width_cm, dims.depth_cm)
    ew, eh = effective_dims(spec, gen_item["rotation"][1])
    x_cm, z_cm = gen_item["position"][0] * 100, gen_item["position"][2] * 100
    return aabb(x_cm, z_cm, ew, eh)


class TestPipeline(unittest.TestCase):
    def test_end_to_end_shape_units_and_no_overlap(self):
        items = [
            ShoppingItem("double_bed", "modern", "against_wall"),
            ShoppingItem("wardrobe", "modern", "against_solid_wall"),
            ShoppingItem("side_table", "modern", "next_to:double_bed"),
            ShoppingItem("floor_lamp", "warm", "anywhere"),  # unknown type -> default dims
        ]
        req = _request({"windows": [{"position": [4, 2.5], "width": 1.2}]})

        res = auto_furnish(req, _fake_llm(items))
        gen = res["generated_furniture"]

        self.assertEqual(len(gen), 4, "all items should fit in a 4x5 m room")
        for g in gen:
            self.assertEqual(g["asset_id"], g["type"])
            self.assertEqual(g["rotation"][0], 0)
            self.assertEqual(g["rotation"][2], 0)
            # position is metres, inside the room envelope
            self.assertGreaterEqual(g["position"][0], 0)
            self.assertLessEqual(g["position"][0], 4)
            self.assertGreaterEqual(g["position"][2], 0)
            self.assertLessEqual(g["position"][2], 5)

        boxes = [_box_for(g) for g in gen]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                self.assertFalse(boxes_overlap(boxes[i], boxes[j]), f"item {i} overlaps item {j}")

    def test_empty_shopping_list(self):
        res = auto_furnish(_request(), _fake_llm([]))
        self.assertEqual(res["generated_furniture"], [])

    def test_next_to_missing_referent_degrades(self):
        # references a type that was never listed → should still place, not crash
        items = [ShoppingItem("chair", "", "next_to:nonexistent")]
        res = auto_furnish(_request(), _fake_llm(items))
        self.assertEqual(len(res["generated_furniture"]), 1)


if __name__ == "__main__":
    unittest.main()
