# Iterative Editing — chat-driven edits to an existing plan

> Status: **v1 built** (local edits). v2 (structural: resize/add/remove room) is
> reserved behind the same wire and not yet built. The moat: turn the AI from a
> one-shot generator into a design *conversation* — "add a window to the kitchen",
> "rename bedroom 2 to a study", "clear the living room and add a sofa and TV".

This builds on the two existing AI endpoints (`/auto-furnish`, `/generate-plan`)
and reuses, unchanged, the same boundary rule they follow:

- **The LLM reasons about intent only — never coordinates.** It names *what* to
  change (which room, what to add/remove, what style), not *where*.
- **Deterministic Python computes all geometry.** The solver remains the single
  coordinate authority (see `BackenAndAI.md`, CLAUDE.md).
- **Everything re-enters through the Zustand store as one `commit` → one undo
  step.** The backend never holds the canonical `Plan`.

---

## The core decision: the worker returns a concrete *patch*, the frontend applies it

There are two places geometry could be computed for an edit. We pick the one
consistent with the rest of the system.

| | Where intent → geometry happens | Verdict |
|---|---|---|
| **A. Worker resolves a patch** | Worker LLM → loose commands → worker resolves to concrete, id-level ops with coordinates (using the solver + the rooms the frontend sends) | **Chosen** |
| B. Worker emits commands only | Frontend interprets commands and computes furniture coords itself | Rejected — needs a TS port of the solver; duplicates the single coordinate authority |

So the flow is the same three-layer shape as `/generate-plan`, just with the
**current floor** as an extra input and a **patch** (not a full plan) as output:

```
Frontend (AssistantPanel)
  │  POST /api/design/edit-plan
  │  { prompt, floor: <current floor, cm> }      ← the whole active floor
  ▼
Node gateway  (vite dev middleware / api/design/edit-plan.ts)
  │  forwards to WORKER_URL/edit-plan; 503 when the worker is offline
  ▼
Python worker  POST /edit-plan
  ① LLM        → edit COMMANDS (loose intent, references rooms/items by name/type)
  ② resolve    → map handles → ids; run the solver for new furniture; pick walls
  │              for new openings  — all deterministic, all in cm
  │  { patch: [ ...id-level ops... ], summary, warnings }
  ▼
Frontend  applyEditPatch(plan, floorId, response)
  │  fold each op through planEdits  → ONE new Plan
  ▼
commit(plan)   → one undo step → 2D + 3D re-render
```

Why send the **whole floor** and not just the plot? The worker needs the derived
rooms (to resolve "the kitchen" → a roomId and to get each room's rectangle for
the solver), the existing furniture (to resolve removals and avoid overlaps), and
the walls/openings (to choose a wall for a new opening, clear of existing ones).
The frontend already holds all of it.

**Stateless in v1.** The current floor *is* the conversation state — "make the
kitchen bigger" is fully interpretable from the floor we send, so there's no
server-side session. (We can optionally pass the last few user prompts for
pronoun resolution like "make *it* bigger"; nice-to-have, not required.)

---

## Two classes of edit — and why v1 stops at the first

| Class | Examples | Touches the wall partition? | Phase |
|---|---|---|---|
| **Local** | add/remove/move furniture, refurnish a room in a new style, add/remove a door or window, rename a room, change room type | No | **v1** |
| **Structural** | resize a room, add a room, remove a room, swap two rooms | Yes — must re-flow the BSP, preserving other rooms' doors + furniture | v2 |

Local edits map 1:1 onto primitives that **already exist** in `planEdits.ts`, so
v1 is mostly wiring + an LLM prompt + a resolver. Structural edits need the
layout engine to re-partition while preserving identity, doors, and furniture of
untouched rooms — a much harder problem, deferred to v2. The v1 command schema is
designed to extend to it (see "Forward-compatibility").

When a v1 request *is* structural ("make the living room bigger"), the worker
detects it can't satisfy it locally and returns it in `warnings` so the UI can
say "resizing rooms is coming soon" instead of silently doing nothing.

---

## The two vocabularies

The worker is a translator between a **loose command** the LLM emits and a
**strict patch op** the frontend applies. This mirrors how `/auto-furnish` turns a
loose "shopping list" into concrete placements.

### LLM command schema (intent — what the model produces)

References rooms and items by human handles (`name` or `type`), never ids,
never coordinates:

```jsonc
// add_furniture     — place new items in a room (solver computes positions)
{ "op": "add_furniture",    "room": "Living",  "items": [{ "type": "armchair", "style": "modern", "rule": "near_window" }] }
// remove_furniture  — delete matching items (optionally scoped to a room)
{ "op": "remove_furniture", "room": "Living",  "match": "coffee_table" }   // or "match": "all"
// add_opening       — add a door/window to one of a room's walls
{ "op": "add_opening",      "room": "Kitchen", "kind": "window", "wall": "exterior" }   // exterior | interior | "<neighbor room>"
// remove_opening    — remove a door/window from a room
{ "op": "remove_opening",   "room": "Kitchen", "kind": "window" }
// rename_room / set_room_type
{ "op": "rename_room",      "room": "Bedroom 2", "name": "Study" }
{ "op": "set_room_type",    "room": "Bedroom 2", "type": "study" }
```

Six ops, deliberately minimal. Higher-level intents **compose** rather than
getting their own op:

- *re-furnish* ("make the living room minimal") → `remove_furniture` with
  `match: "all"` then `add_furniture` with the new items.
- *move* ("put the sofa against the wall") → `remove_furniture` then
  `add_furniture` with a new `rule`.

The model may return several commands for one prompt, and the resolver applies
them **sequentially against an evolving working floor** — so a later command sees
what an earlier one changed (the cleared furniture isn't treated as an obstacle
for the new piece). `room`/`type` come from a closed list the prompt injects (the
rooms we sent + the catalog types), exactly like the existing prompts constrain
`type`/`rule`.

### Patch op schema (geometry — what the worker returns, cm)

Each op is concrete, validated, id-level, and maps to exactly one `planEdits`
function:

```ts
type EditPatchOp =
  | { op: 'addFurniture';  items: { type: string; x: number; y: number; rotationDeg: number; roomId: ID }[] }
  | { op: 'removeFurniture'; ids: ID[] }
  | { op: 'addOpening';    openings: { wallId: ID; kind: 'door' | 'window'; offset: number; width: number }[] }
  | { op: 'removeOpening'; ids: ID[] }
  | { op: 'setRoomName';   roomId: ID; name: string }
  | { op: 'setRoomType';   roomId: ID; type: RoomType }
  // v2 (reserved now, no v1 command emits it): a full re-flow of one floor.
  | { op: 'replaceFloor';  points: GenPoint[]; walls: GenWall[]; openings: GenOpening[];
                           furniture: GenFurniture[]; rooms: GenRoomMeta[] };

interface EditPlanResponse {
  patch: EditPatchOp[];
  summary: string;     // human-readable "what I did", shown in the panel
  warnings: string[];  // e.g. unsupported structural request, ambiguous handle
}
```

The `op` → `planEdits` mapping in `applyEditPatch`:

| Patch op | planEdits call |
|---|---|
| `addFurniture` | `addFurniture(plan, floorId, item)` per item |
| `removeFurniture` | `deleteFurniture(plan, floorId, id)` per id |
| `addOpening` | `addOpening(plan, floorId, { wallId, kind, offset, width })` per opening — its built-in clamp/overlap rejection is the final safety net |
| `removeOpening` | `deleteOpening(plan, floorId, id)` per id |
| `setRoomName` | `setRoomName(plan, floorId, roomId, name)` |
| `setRoomType` | `setRoomType(plan, floorId, roomId, type)` |
| `replaceFloor` (v2) | same path as `applyGeneratedPlan` |

`applyEditPatch` folds the ops left-to-right into a single draft `Plan` and
returns it; `AssistantPanel` wraps the whole thing in one `commit`.

---

## Resolution: handles → ids (the worker's job)

The worker resolves the LLM's loose handles against the floor the frontend sent:

- **Room**: match `room` against the sent rooms by exact `name`, then by `type`.
  Each room carries its `wallIds`; the worker derives the room's polygon/rectangle
  (the same ring the frontend's `roomRing` builds) to (a) scope furniture and
  (b) hand the solver a room rectangle for new placements.
- **Furniture**: match `match` (a catalog type or `"all"`) against the room's
  furniture → a set of ids to delete.
- **Opening wall**: classify the room's walls into exterior/interior (a wall is
  interior iff it borders two rooms), then pick one matching the requested
  `wall` hint and a sensible offset; the frontend's `addOpening` re-clamps.
- **Ambiguity** (e.g. two unnamed bedrooms): resolve to the best match and note
  it in `warnings`; the single undo step is the user's safety net.

New furniture coordinates come from the **existing step-2 solver**, run against
the resolved room's rectangle plus its existing furniture as fixed obstacles, so
additions don't overlap what's already there. No new geometry engine.

---

## Files added / touched (mirrors the existing two endpoints) — v1 built

**Worker (Python)**
- `solver/models.py` + `solver/solver.py` — added an optional `obstacles: list[AABB]`
  to `SolveRequest`, occupied up front exactly like door swings (empty by default,
  so generation is unaffected). Lets `add_furniture` place new items *around*
  what's already in the room instead of re-flowing it.
- `llm.py` — `ALLOWED_EDIT_OPS`, `build_edit_prompt(floor_summary)`,
  `parse_edit_commands(content)`, `extract_edit_commands(prompt, floor_summary, …)`.
  Geometry-free (the summary is passed in) to avoid an import cycle with `edits.py`.
- `edits.py` *(new)* — `apply_edits(floor, commands) -> {patch, summary, warnings}`
  (deterministic resolver: handle→id matching, the solver for furniture, wall
  classification for openings; commands applied sequentially on a deep-copied
  working floor) and `summarize_floor(floor)` for the prompt. No network.
- `app.py` — `POST /edit-plan`.
- `worker/tests/test_edits.py` *(new)* — 14 tests, fake-LLM/offline.

**Gateway (Node)**
- `vite.config.ts` — `/api/design/edit-plan` in `ROUTES`; 503 when offline (the
  existing non-furnish branch, since an edit can't be mocked).
- `api/design/edit-plan.ts` *(new)* — production handler, same shape as `generate-plan.ts`.

**Frontend (TS)**
- `src/lib/aiPipeline/contract.ts` — `EditPlanRequest`/`EditPatchOp`/`EditPlanResponse`,
  the serialized-floor types, and `serializeFloor(floor)`.
- `src/lib/aiPipeline/client.ts` — `EDIT_PLAN_ENDPOINT` + `requestEditPlan`.
- `src/lib/aiPipeline/applyEditPatch.ts` *(new)* — `applyEditPatch(plan, floorId, res): Plan`.
- `src/lib/aiPipeline/applyEditPatch.test.ts` *(new)* — 10 tests (each op, no input
  mutation, unknown ops ignored, rejected opening dropped).
- `src/components/Panels/AssistantPanel.tsx` — a third action, **"✏️ Edit plan"**,
  enabled once the active floor has rooms; shows `summary`/`warnings`.

---

## Forward-compatibility with structural edits (v2)

- The patch is a **list of typed ops**, so v2 adds `resizeRoom` / `addRoom` /
  `removeRoom` resolution that emits a `replaceFloor` op (or, later, finer-grained
  wall ops) without changing the wire envelope or `applyEditPatch`'s contract.
- The `replaceFloor` op is reserved now so the frontend adapter already knows how
  to apply a full re-flow (it reuses the `applyGeneratedPlan` path), and v2 is
  purely worker-side work.
- Because the floor is sent every call and the result is one undo step, a v2
  re-flow is still a single, undoable commit — no architectural change.

---

## What stays exactly the same

- LLM = intent, Python = geometry, store = one undo step.
- OpenRouter via the `openai` SDK (`llm.py`); no Anthropic SDK, no
  `ANTHROPIC_API_KEY`.
- Units: cm on this wire (like `/generate-plan`), since we're editing geometry.
- The backend never becomes the source of truth; it returns a patch the frontend
  commits, identical in spirit to a hand edit.
