"""
FastAPI worker (Phase 4 · Step 3) — the AI generation service.

POST /auto-furnish takes an AutoFurnishRequest (the same wire shape the frontend
sends) and returns generated furniture, running the full pipeline:
LLM intent (OpenRouter) -> catalog dims -> spatial solver -> wire response.

Run it:
    cd worker
    pip install -r requirements.txt
    export OPENROUTER_API_KEY=sk-or-...        # your OpenRouter key
    export LLM_MODEL=openai/gpt-4o-mini        # optional; generate/furnish model
    export EDIT_LLM_MODEL=openai/gpt-4o        # optional; editing model (defaults to gpt-4o)
    uvicorn app:app --reload --port 8000

The Node gateway (vite.config.ts dev middleware / api/design/auto-furnish.ts)
forwards /api/design/auto-furnish here when WORKER_URL points at it; otherwise it
falls back to the step-1 mock, so the app keeps working with the worker offline.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request

from contract import parse_request
from edits import apply_edits, summarize_floor
from layout import RoomRequest, generate_plan
from llm import (
    DEFAULT_EDIT_MODEL,
    DEFAULT_MODEL,
    extract_edit_commands,
    extract_room_program,
    extract_shopping_list,
    make_client,
)
from pipeline import auto_furnish

app = FastAPI(title="HomeMaker AI worker")

# Generate / furnish use the cheaper model; editing defaults to a stronger one
# for structural-intent detection. Precedence for editing: EDIT_LLM_MODEL wins,
# then a global LLM_MODEL override, then the gpt-4o default.
MODEL = os.environ.get("LLM_MODEL", DEFAULT_MODEL)
EDIT_MODEL = os.environ.get("EDIT_LLM_MODEL") or os.environ.get("LLM_MODEL") or DEFAULT_EDIT_MODEL

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = make_client()  # raises clearly if OPENROUTER_API_KEY is unset
    return _client


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL, "editModel": EDIT_MODEL}


@app.post("/auto-furnish")
async def auto_furnish_route(request: Request) -> dict:
    """Furnish an existing room (furniture only)."""
    data = await request.json()
    req = parse_request(data)
    client = _get_client()

    def llm_fn(prompt, room):
        return extract_shopping_list(prompt, room, client=client, model=MODEL)

    return auto_furnish(req, llm_fn)


@app.post("/generate-plan")
async def generate_plan_route(request: Request) -> dict:
    """Generate a whole multi-room floor plan (walls + doors + windows + furniture).

    v1 only uses the plot's width/depth — it lays the rooms out in a single
    axis-aligned rectangle and ignores Plot.shape and the entrance side (see
    layout.generate_plan). That's intentional scope, not a missing feature.
    """
    data = await request.json()
    prompt = str(data.get("prompt", ""))
    plot = data.get("plot") or {}
    width = int(plot.get("widthCm", 914))
    depth = int(plot.get("depthCm", 1219))

    client = _get_client()
    program = extract_room_program(prompt, client=client, model=MODEL)
    rooms = [RoomRequest(it.name, it.type, it.weight) for it in program] or [
        RoomRequest("Room", "living", 1)
    ]
    return generate_plan((0, 0, width, depth), rooms)


@app.post("/edit-plan")
async def edit_plan_route(request: Request) -> dict:
    """Apply a chat-driven edit to an existing floor (v1 — local edits).

    Takes { prompt, floor, history? } where `floor` is the current active floor
    in cm (points/walls/openings/furniture/rooms) and `history` is the recent
    (prompt, summary) turns for conversational reference resolution ("make it
    bigger"). The LLM produces edit COMMANDS against a summary of that floor;
    edits.apply_edits resolves them to a concrete id-level patch the frontend
    commits as one undo step. Structural requests (resize/add/remove room) are
    reported in `warnings` — see docs/IterativeEditing.md.
    """
    data = await request.json()
    prompt = str(data.get("prompt", ""))
    floor = data.get("floor") or {}
    history = data.get("history") or []

    client = _get_client()
    commands = extract_edit_commands(
        prompt, summarize_floor(floor), client=client, model=EDIT_MODEL, history=history
    )
    return apply_edits(floor, commands)
