"""
Tests for the pure LLM helpers (Phase 4 · Step 3) — no network, no API key.

We test prompt construction and the JSON parser (the parts that must be robust to
real model output: code fences, surrounding prose, bare arrays, junk).
"""

import unittest

from llm import build_system_prompt, build_user_prompt, parse_shopping_list
from contract import RoomDimensions, RoomSpec


class TestPrompts(unittest.TestCase):
    def test_system_prompt_lists_types_and_rules(self):
        p = build_system_prompt()
        self.assertIn("double_bed", p)
        self.assertIn("against_wall", p)
        self.assertIn("JSON", p)
        self.assertNotIn("coordinate", p.lower().replace("do not output any coordinates", ""))

    def test_user_prompt_includes_dims_and_request(self):
        room = RoomSpec(RoomDimensions(4, 5, 2.7))
        p = build_user_prompt("cozy bedroom", room)
        self.assertIn("4.0m", p)
        self.assertIn("5.0m", p)
        self.assertIn("cozy bedroom", p)


class TestParse(unittest.TestCase):
    def test_plain_object(self):
        items = parse_shopping_list('{"items":[{"type":"sofa","style":"modern","rule":"against_wall"}]}')
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].type, "sofa")
        self.assertEqual(items[0].rule, "against_wall")

    def test_code_fenced(self):
        raw = '```json\n{"items":[{"type":"chair","rule":"near_window"}]}\n```'
        items = parse_shopping_list(raw)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].type, "chair")

    def test_prose_wrapped(self):
        raw = 'Sure! Here is the layout: {"items":[{"type":"desk"}]} — enjoy.'
        items = parse_shopping_list(raw)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].rule, "anywhere")  # default

    def test_bare_array(self):
        items = parse_shopping_list('[{"type":"bookshelf","rule":"against_solid_wall"}]')
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].type, "bookshelf")

    def test_skips_invalid_entries(self):
        raw = '{"items":[{"style":"no type"},{"type":"  "},{"type":"chair"}]}'
        items = parse_shopping_list(raw)
        self.assertEqual([i.type for i in items], ["chair"])

    def test_garbage_returns_empty(self):
        self.assertEqual(parse_shopping_list("I cannot help with that."), [])


if __name__ == "__main__":
    unittest.main()
