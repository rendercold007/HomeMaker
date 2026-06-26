# worker — AI pipeline backend (Phase 4)

The Python side of the auto-furnish pipeline from [`../docs/BackenAndAI.md`](../docs/BackenAndAI.md).

```
solver/          # Step 2 — deterministic spatial solver (stdlib only)
  models.py      #   Room, Door, Window, FurnitureSpec, Placement, SolveRequest/Result (cm)
  solver.py      #   grid + bounding-box collision engine
catalog.py       # Step 3 — furniture dimensions (mirrors src/model/furniture.ts); LLM vocabulary
contract.py      # Step 3 — wire types (metres) + parsing
llm.py           # Step 3 — LLM intent extraction via OpenRouter (OpenAI-compatible)
pipeline.py      # Step 3 — request → LLM list → catalog dims → solver → wire response
app.py           # Step 3 — FastAPI: POST /auto-furnish
cli.py           # Step 2 — JSON in / JSON out, the solver acceptance harness
tests/           # all offline — no network, no API key
```

## Step 2 — the spatial solver (done)

Deterministic, **stdlib-only** constraint solver: a room + furniture-with-rules →
collision-free placements. No AI, no network.

- **Centimetres everywhere**, origin at a room corner, `x` = width, `y` = depth.
  Furniture `(x, y)` is the **centre**; `rotation_deg` ∈ `{0, 90, 180, 270}`.
- Rules: `against_wall`, `against_solid_wall`, `near_window`, `next_to:<id>`,
  `center`, `anywhere`.
- Deterministic; grid-collision-free implies continuous AABB non-overlap.

```bash
cd worker
python3 cli.py --demo            # built-in bedroom example, no deps
```

## Step 3 — FastAPI worker + LLM (done)

The LLM reasons about **style and intent only**, returning a "shopping list"
(`{type, style, rule}` per item) — never coordinates. The pipeline resolves each
type to a footprint via `catalog.py`, runs the step-2 solver, and converts the
placements back to the wire shape (cm → metres, `rotation_deg` → `[0, deg, 0]`).

### LLM provider — OpenRouter (not Anthropic directly)

`llm.py` uses the **`openai`** SDK pointed at `https://openrouter.ai/api/v1`.
OpenRouter is OpenAI-compatible, so any model slug works — pick one with
`LLM_MODEL`. There is no `anthropic` dependency and no `ANTHROPIC_API_KEY`.

### Run it

```bash
cd worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # then put your key in .env
export OPENROUTER_API_KEY=sk-or-...
export LLM_MODEL=openai/gpt-4o-mini      # optional; e.g. anthropic/claude-3.5-sonnet

uvicorn app:app --reload --port 8000
# POST http://localhost:8000/auto-furnish   GET /health
```

The frontend talks to `/api/design/auto-furnish`. The Node gateway forwards that
to `WORKER_URL` (default `http://localhost:8000/auto-furnish`) when reachable, and
falls back to the step-1 mock when the worker is offline — so the app works either
way. To use the worker locally, just have it running before you click
**Auto-furnish** in the app.

## Run the tests (offline — no key needed)

```bash
cd worker
python3 -m unittest discover -s tests -t .       # add -v for per-test output
```

`test_solver.py` covers the math; `test_llm.py` covers prompt building + parsing;
`test_pipeline.py` runs the full request → solver → wire path with a **fake LLM**.

## Next steps

- **Step 4** — vector DB lookup for real `.glb` assets + their bounding boxes,
  replacing the local `catalog.py` dimension source.
