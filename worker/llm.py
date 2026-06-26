"""
LLM intent extraction (Phase 4 · Step 3) — via OpenRouter.

The LLM reasons about STYLE and INTENT only: it returns a "shopping list" of
furniture (type + style + spatial rule), never coordinates. The deterministic
solver (step 2) computes all positions.

OpenRouter is OpenAI-compatible, so we use the `openai` SDK pointed at
https://openrouter.ai/api/v1 — there is no Anthropic dependency. The model is
chosen via the LLM_MODEL env var (any OpenRouter slug); the key via
OPENROUTER_API_KEY.

The `openai` import is lazy (inside make_client/extract_shopping_list) so the
pure helpers below — build_system_prompt / build_user_prompt / parse_shopping_list
— import and test with zero third-party dependencies.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from catalog import allowed_types
from contract import RoomSpec

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o-mini"  # generate / furnish; override with LLM_MODEL
# Editing — especially detecting STRUCTURAL intent ("make the kitchen bigger" →
# resize_room) and not re-issuing already-applied edits — needs stronger
# instruction-following than gpt-4o-mini reliably gives, so editing defaults to
# gpt-4o. Override with EDIT_LLM_MODEL (or LLM_MODEL for everything).
DEFAULT_EDIT_MODEL = "openai/gpt-4o"

# The rules the solver understands (see solver/models.py). `next_to:<type>`
# references an earlier item's type; the pipeline resolves it to that item's id.
ALLOWED_RULES = (
    "against_wall",
    "against_solid_wall",
    "near_window",
    "next_to:<type>",
    "center",
    "anywhere",
)


@dataclass(frozen=True)
class ShoppingItem:
    type: str
    style: str = ""
    rule: str = "anywhere"


def build_system_prompt(types: list[str] | None = None) -> str:
    types = types or allowed_types()
    return (
        "You are an interior layout planner. Given a room and a request, produce a "
        '"shopping list" of furniture to place. Reason about style and intent only — '
        "do NOT output any coordinates, sizes, or positions.\n\n"
        "Respond with JSON ONLY, in exactly this shape:\n"
        '{"items": [{"type": "<type>", "style": "<short style word>", "rule": "<rule>"}]}\n\n'
        f"Choose each \"type\" ONLY from this list: {', '.join(types)}.\n"
        f"Choose each \"rule\" from: {', '.join(ALLOWED_RULES)}.\n\n"
        "Guidelines:\n"
        "- Pick furniture that suits the room implied by the request, and that fits the space.\n"
        '- Use "near_window" for seating/desks; "against_wall"/"against_solid_wall" for beds, '
        "wardrobes, sofas, shelves.\n"
        '- For "next_to:<type>", the referenced type MUST appear earlier in the list.\n'
        "- Keep it to a realistic number of items. Output nothing but the JSON object."
    )


def build_user_prompt(prompt: str, room: RoomSpec) -> str:
    d = room.dimensions
    return (
        f"Room: {d.width:.1f}m wide x {d.length:.1f}m deep (ceiling {d.height:.1f}m), "
        f"with {len(room.doors)} door(s) and {len(room.windows)} window(s).\n"
        f"Request: {prompt}"
    )


def _extract_json(content: str):
    """Best-effort JSON out of an LLM reply — tolerates code fences and prose."""
    s = content.strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        i, j = s.find(open_c), s.rfind(close_c)
        if i != -1 and j > i:
            try:
                return json.loads(s[i : j + 1])
            except Exception:
                continue
    return {}


def parse_shopping_list(content: str) -> list[ShoppingItem]:
    data = _extract_json(content)
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out: list[ShoppingItem] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        t = it.get("type")
        if not isinstance(t, str) or not t.strip():
            continue
        out.append(
            ShoppingItem(
                type=t.strip(),
                style=str(it.get("style", "")),
                rule=str(it.get("rule") or "anywhere"),
            )
        )
    return out


def make_client(api_key: str | None = None):
    """Build an OpenRouter-backed OpenAI client. Raises if no key is configured."""
    from openai import OpenAI  # lazy: keeps the pure helpers dependency-free

    key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=key,
        default_headers={"X-Title": "HomeMaker"},  # optional OpenRouter attribution
    )


def extract_shopping_list(prompt: str, room: RoomSpec, *, client, model: str) -> list[ShoppingItem]:
    """Call the LLM and parse its shopping list. `client` is an OpenRouter client."""
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": build_system_prompt()},
            {"role": "user", "content": build_user_prompt(prompt, room)},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    content = response.choices[0].message.content or ""
    return parse_shopping_list(content)


# --------------------------------------------------------------------------- #
# Multi-room: extract a ROOM PROGRAM (which rooms + relative sizes)            #
# --------------------------------------------------------------------------- #

ROOM_TYPES = (
    "living", "bedroom", "kitchen", "bathroom", "dining",
    "study", "utility", "pooja", "parking", "other",
)


@dataclass(frozen=True)
class RoomProgramItem:
    name: str
    type: str
    weight: float = 1.0


def build_room_program_prompt() -> str:
    return (
        "You are an architect. Given a request, list the rooms a home should have. "
        "Decide which rooms and their RELATIVE sizes only — no coordinates, no walls.\n\n"
        "Respond with JSON ONLY:\n"
        '{"rooms": [{"name": "<label>", "type": "<type>", "weight": <number>}]}\n\n'
        f"Each \"type\" MUST be one of: {', '.join(ROOM_TYPES)}.\n"
        '"weight" is relative floor area (e.g. living ~3, bedroom ~2, kitchen ~1.5, bathroom ~1).\n'
        "Include every room the request implies — e.g. a \"2BHK\" has a living room, a "
        "kitchen, 2 bedrooms, and 1-2 bathrooms. Output nothing but the JSON object."
    )


def parse_room_program(content: str) -> list[RoomProgramItem]:
    data = _extract_json(content)
    rooms = data.get("rooms") if isinstance(data, dict) else data
    if not isinstance(rooms, list):
        return []
    out: list[RoomProgramItem] = []
    for it in rooms:
        if not isinstance(it, dict):
            continue
        t = str(it.get("type", "other")).strip().lower()
        if t not in ROOM_TYPES:
            t = "other"
        try:
            w = float(it.get("weight", 1) or 1)
        except (TypeError, ValueError):
            w = 1.0
        if w <= 0:
            w = 1.0
        name = str(it.get("name") or t.title())
        out.append(RoomProgramItem(name=name, type=t, weight=w))
    return out


def extract_room_program(prompt: str, *, client, model: str) -> list[RoomProgramItem]:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": build_room_program_prompt()},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    return parse_room_program(response.choices[0].message.content or "")


# --------------------------------------------------------------------------- #
# Iterative editing: extract EDIT COMMANDS against an existing floor           #
# --------------------------------------------------------------------------- #
#
# The LLM edits an existing plan by naming WHAT to change (which room, what to
# add/remove), referencing rooms by their name/type from the floor summary —
# never coordinates. edits.apply_edits resolves these to a concrete patch.

# The edit command vocabulary. Local ops (edits.py) change furniture / openings /
# room labels; structural ops (restructure.py, v2) re-flow the wall partition.
ALLOWED_EDIT_OPS = (
    # Local edits
    "add_furniture",    # {room, items: [{type, style?, rule?}]}
    "remove_furniture", # {room?, match: <type|"all">}
    "add_opening",      # {room, kind: door|window, wall: exterior|interior|<room>}
    "remove_opening",   # {room, kind?: door|window}
    "rename_room",      # {room, name}
    "set_room_type",    # {room, type}
    # Structural edits (re-flow the partition within the same footprint)
    "resize_room",      # {room, change: bigger|smaller} or {room, factor: <number>}
    "add_room",         # {name, type}
    "remove_room",      # {room}
    "swap_rooms",       # {room, with}
)


def build_edit_prompt(floor_summary: str, types: list[str] | None = None) -> str:
    types = types or allowed_types()
    return (
        "You are editing an EXISTING floor plan. The user asks for a change in "
        "natural language; you translate it into a list of edit commands. Reason "
        "about intent only — NEVER output coordinates, sizes, or positions.\n\n"
        "The current floor:\n"
        f"{floor_summary}\n\n"
        "Respond with JSON ONLY:\n"
        '{"commands": [ { "op": "<op>", ... } ]}\n\n'
        "LOCAL ops (change what's inside rooms):\n"
        '- add_furniture    {"room": "<room name or type>", "items": [{"type": "<type>", "style": "<word>", "rule": "<rule>"}]}\n'
        '- remove_furniture {"room": "<room>", "match": "<type or \\"all\\">"}  (room optional)\n'
        '- add_opening      {"room": "<room>", "kind": "door"|"window", "wall": "exterior"|"interior"|"<neighbor room>"}\n'
        '- remove_opening   {"room": "<room>", "kind": "door"|"window"}  (kind optional)\n'
        '- rename_room      {"room": "<room>", "name": "<new name>"}\n'
        '- set_room_type    {"room": "<room>", "type": "<type>"}\n'
        "STRUCTURAL ops (resize the walls / change which rooms exist):\n"
        '- resize_room      {"room": "<room>", "change": "bigger"|"smaller"}\n'
        '- add_room         {"name": "<label>", "type": "<type>"}\n'
        '- remove_room      {"room": "<room>"}\n'
        '- swap_rooms       {"room": "<room>", "with": "<other room>"}\n\n'
        f'Reference rooms by a name or type shown above. "type" for furniture MUST be one of: {", ".join(types)}.\n'
        f'Furniture "rule" MUST be one of: {", ".join(ALLOWED_RULES)}.\n'
        f'Room "type" MUST be one of: {", ".join(ROOM_TYPES)}.\n'
        "You may return several commands (e.g. to re-style a room: remove_furniture "
        'with match "all", then add_furniture with the new items).\n'
        "Use a STRUCTURAL op when the request changes the rooms themselves: "
        '"make the kitchen bigger" → resize_room; "add a study" → add_room; '
        '"delete the balcony" → remove_room; "swap the kitchen and dining" → '
        "swap_rooms. Use a LOCAL op when it only changes furniture, doors, "
        "windows, or a room's name/type.\n"
        "Produce commands ONLY for the latest request. Any earlier messages are "
        'context for resolving references like "it" or "the other room" — do NOT '
        "re-issue edits that were already applied in previous turns.\n"
        'If you truly can\'t express the request with the ops above, return '
        'exactly {"commands": [{"op": "unsupported"}]} — never an empty list.\n'
        "Output nothing but the JSON object."
    )


def parse_edit_commands(content: str) -> list[dict]:
    """Parse the LLM reply into a list of command dicts (each with an 'op')."""
    data = _extract_json(content)
    cmds = data.get("commands") if isinstance(data, dict) else data
    if not isinstance(cmds, list):
        return []
    return [c for c in cmds if isinstance(c, dict) and str(c.get("op", "")).strip()]


# How many prior turns to feed back as conversation context. Enough for "make it
# bigger" / "the other one" to resolve, bounded so the prompt stays small.
MAX_EDIT_HISTORY = 8


def build_edit_messages(
    prompt: str, floor_summary: str, history: list[dict] | None = None
) -> list[dict]:
    """Chat messages for an edit turn, with recent turns replayed as context.

    Each history entry is {"prompt": <what the user asked>, "summary": <what we
    did>}; we replay them as user/assistant turns so the model can resolve
    references like "it" or "the other bedroom" against the conversation, not
    just the current floor. The floor summary in the system prompt is always the
    LATEST floor, so stale history never overrides current geometry.
    """
    messages: list[dict] = [{"role": "system", "content": build_edit_prompt(floor_summary)}]
    for turn in (history or [])[-MAX_EDIT_HISTORY:]:
        if not isinstance(turn, dict):
            continue
        past_prompt = str(turn.get("prompt", "")).strip()
        past_summary = str(turn.get("summary", "")).strip()
        if not past_prompt:
            continue
        messages.append({"role": "user", "content": past_prompt})
        if past_summary:
            messages.append({"role": "assistant", "content": past_summary})
    messages.append({"role": "user", "content": prompt})
    return messages


def extract_edit_commands(
    prompt: str,
    floor_summary: str,
    *,
    client,
    model: str,
    history: list[dict] | None = None,
) -> list[dict]:
    response = client.chat.completions.create(
        model=model,
        messages=build_edit_messages(prompt, floor_summary, history),
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    return parse_edit_commands(response.choices[0].message.content or "")
