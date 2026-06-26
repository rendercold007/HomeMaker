---
name: ai-pipeline-phase4
description: Phase 4 AI backend (worker/ + src/lib/aiPipeline/ + gateway) — module map, contracts, and the bugs/risks found in review
metadata:
  type: project
---

Phase 4 = "AI backend": auto-furnish (furniture only) + multi-room generate-plan (walls+doors+windows+furniture). LLM emits intent only; deterministic Python computes geometry. Provider is OpenRouter via `openai` SDK (intentional, not a mistake).

Module map (verify before relying — uncommitted as of 2026-06-25):
- `worker/solver/models.py` — dataclasses (Room/Door/Window/FurnitureSpec/Placement, Wall enum). Room-local cm, y=depth.
- `worker/solver/solver.py` — grid+AABB collision. `solve()`, candidate generators per rule. Grid-free⇒AABB-free claim VERIFIED sound (interior-eps sampling rounds occupancy OUT, so overlap is over-detected never under). Deterministic.
- `worker/layout.py` — THE risky file. bsp_layout → build_graph (wall-graph extraction, T-junction split, straight-run merge) → place_openings (union-find door spanning tree) → furnish. Wall-graph topology VERIFIED: Euler holds, no dup/zero-len walls, T-junctions split correctly at cross/T vertices.
- `worker/llm.py` — OpenRouter calls + pure prompt/parse helpers (lazy openai import). `_extract_json` is best-effort fence/prose-tolerant.
- `worker/pipeline.py` — auto_furnish: wire(m)→solver(cm)→wire(m). `_wall_and_offset` maps opening [x,z] to nearest wall (offset NOT validated against wall length).
- `worker/contract.py` / `catalog.py` / `templates.py` / `app.py` (FastAPI) / `cli.py`.
- `src/lib/aiPipeline/`: contract.ts (wire types — auto-furnish METRES, generate-plan CENTIMETRES), client.ts (fetch), applyGenerated.ts (furniture, tested), applyPlan.ts (full floor replace + centroid room-naming, NO TESTS).
- Gateway: `vite.config.ts` dev/preview middleware (mock fallback for auto-furnish, 503 for generate-plan); `api/design/*.ts` Vercel fns forward to WORKER_URL.

Key contracts: model `commit(next | producer)` skips no-op if `resolved === present` (so empty AI result = no undo step). `addFurniture` does NOT set roomId. Room id = `room:${sorted wallIds}`. newId = crypto.randomUUID; generator emits p0/w0/o0 — no collision because applyGeneratedPlan REPLACES the whole floor.

Findings (review 2026-06-25):
- `applyPlan.ts` has ZERO tests despite being the most complex adapter (full-floor replace + nearest-meta room naming). nameRooms matches nearest meta WITHOUT uniqueness → two rooms can grab the same meta. Highest-priority gap.
- Generated furniture ignores wall half-thickness (clearance_cm=0): items flush at room-rect edge overlap the inner ~5cm of the centered wall slab. Cosmetic clipping in 3D.
- `_wall_and_offset` / `_add_opening` offsets not validated vs wall length; corner doors yield negative swing-box mins (harmless—grid clamps).
- Gateway: Vercel fns + vite middleware forward arbitrary body to WORKER_URL with no auth/size-limit (acceptable for v1 single-tenant but note for prod). vite `readBody` never rejects on stream error.
- applyGeneratedFurniture sets no roomId → generated furniture unlinked from rooms.
- Both worker test suites are unittest (not pytest); pytest not installed in env. Run `python3 -m unittest discover -s tests -t . worker/`.
