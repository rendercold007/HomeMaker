"""
Tests for the pure LLM helpers (Phase 4 · Step 3) — no network, no API key.

We test prompt construction and the JSON parser (the parts that must be robust to
real model output: code fences, surrounding prose, bare arrays, junk).
"""

import unittest

from llm import (
    MAX_EDIT_HISTORY,
    build_edit_messages,
    build_edit_prompt,
    build_system_prompt,
    build_user_prompt,
    extract_edit_commands,
    parse_shopping_list,
)
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


class TestEditPrompt(unittest.TestCase):
    def test_warns_against_reissuing_prior_edits(self):
        # Guards the multi-turn accumulation bug: with history present, the model
        # must not repeat already-applied edits.
        p = build_edit_prompt("FLOOR")
        self.assertIn("latest request", p.lower())
        self.assertIn("already applied", p.lower())

    def test_teaches_structural_ops(self):
        # v2: structural asks are first-class ops (resize/add/remove/swap a room),
        # not deflected to "unsupported".
        p = build_edit_prompt("FLOOR")
        for op in ("resize_room", "add_room", "remove_room", "swap_rooms"):
            self.assertIn(op, p)

    def test_keeps_unsupported_escape_hatch(self):
        # The model still has a way to bail (and must never bail with an empty
        # list, which reads as "No changes").
        p = build_edit_prompt("FLOOR").lower()
        self.assertIn("unsupported", p)
        self.assertIn("never an empty list", p)


class TestEditMessages(unittest.TestCase):
    def test_no_history_is_system_then_user(self):
        msgs = build_edit_messages("add a sofa", "FLOOR", history=None)
        self.assertEqual([m["role"] for m in msgs], ["system", "user"])
        self.assertIn("FLOOR", msgs[0]["content"])
        self.assertEqual(msgs[-1], {"role": "user", "content": "add a sofa"})

    def test_history_replayed_as_user_assistant_turns(self):
        history = [
            {"prompt": "add a sofa to the living room", "summary": "Added a sofa."},
            {"prompt": "make it blue", "summary": "Restyled the sofa."},
        ]
        msgs = build_edit_messages("now add a rug too", "FLOOR", history)
        self.assertEqual(
            [m["role"] for m in msgs],
            ["system", "user", "assistant", "user", "assistant", "user"],
        )
        # The latest prompt is last so the model acts on it.
        self.assertEqual(msgs[-1]["content"], "now add a rug too")
        # Prior turns appear verbatim for reference resolution.
        self.assertIn("add a sofa to the living room", msgs[1]["content"])
        self.assertIn("Restyled the sofa.", msgs[4]["content"])

    def test_history_is_capped(self):
        history = [{"prompt": f"edit {i}", "summary": f"did {i}"} for i in range(50)]
        msgs = build_edit_messages("final", "FLOOR", history)
        # system + (<=MAX turns) * 2 + final user
        self.assertLessEqual(len(msgs), 1 + MAX_EDIT_HISTORY * 2 + 1)
        self.assertEqual(msgs[-1]["content"], "final")
        # Newest kept turn (user prompt then its assistant recap precede "final").
        self.assertEqual(msgs[-3]["content"], "edit 49")
        self.assertEqual(msgs[-2]["content"], "did 49")
        # Oldest turns are dropped entirely.
        self.assertNotIn("edit 0", [m["content"] for m in msgs])

    def test_skips_malformed_and_empty_turns(self):
        history = [
            "not a dict",
            {"summary": "no prompt"},
            {"prompt": "  "},
            {"prompt": "valid one", "summary": ""},  # empty summary → no assistant turn
        ]
        msgs = build_edit_messages("go", "FLOOR", history)
        self.assertEqual([m["role"] for m in msgs], ["system", "user", "user"])
        self.assertEqual(msgs[1]["content"], "valid one")


class _FakeCompletions:
    """Records the messages it was called with; returns a canned command reply."""

    def __init__(self):
        self.seen_messages = None

    def create(self, *, model, messages, **kwargs):
        self.seen_messages = messages

        class _Msg:
            content = '{"commands": [{"op": "add_furniture", "room": "Living", "items": [{"type": "sofa"}]}]}'

        class _Choice:
            message = _Msg()

        class _Resp:
            choices = [_Choice()]

        return _Resp()


class _FakeClient:
    def __init__(self):
        self.chat = type("Chat", (), {"completions": _FakeCompletions()})()


class TestExtractEditCommands(unittest.TestCase):
    def test_threads_history_into_the_request(self):
        client = _FakeClient()
        cmds = extract_edit_commands(
            "add a sofa",
            "FLOOR SUMMARY",
            client=client,
            model="test/model",
            history=[{"prompt": "earlier ask", "summary": "earlier recap"}],
        )
        self.assertEqual(cmds, [{"op": "add_furniture", "room": "Living", "items": [{"type": "sofa"}]}])
        sent = client.chat.completions.seen_messages
        roles = [m["role"] for m in sent]
        self.assertEqual(roles, ["system", "user", "assistant", "user"])
        self.assertIn("earlier ask", sent[1]["content"])


if __name__ == "__main__":
    unittest.main()
