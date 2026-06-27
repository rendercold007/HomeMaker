# Iterative Editing — chat-driven edits to an existing plan

> Status: **v1 + v2 + v3 built**. v1 = local edits (furniture, openings, room
> labels). v2/v3 = structural edits (resize / add / remove / swap a room) — they
> come back as one `replaceFloor` op over the same wire. v3 (`surgical.py`) is the
> default: it edits only the affected rooms and preserves untouched walls, doors,
> and furniture exactly; v2 (`restructure.py`) is the always-works fallback that
> re-flows the whole partition. The moat: turn the AI from a one-shot generator
> into a design *conversation* — "add a window to the kitchen", "make the living
> room bigger", "add a study", "swap the kitchen and dining", "clear the living
> room and add a sofa and TV".

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

## Two classes of edit

| Class | Examples | Touches the wall partition? | Phase |
|---|---|---|---|
| **Local** | add/remove/move furniture, refurnish a room in a new style, add/remove a door or window, rename a room, change room type | No | **v1** |
| **Structural** | resize a room, add a room, remove a room, swap two rooms | Yes — surgically (v3), or a full re-flow (v2 fallback) | **v2/v3** |

Local edits map 1:1 onto primitives that **already exist** in `planEdits.ts`, so
v1 is mostly wiring + an LLM prompt + a resolver (`worker/edits.py`).

Structural edits come back as one `replaceFloor` op, but `apply_edits` produces it
two ways — it tries the surgical path first and falls back to the re-flow:

**v3 — surgical (`worker/surgical.py`), the default.** A structural change should
touch only what it must — "make the kitchen bigger" shouldn't move the living room
or wipe a door you placed. `bsp_layout` lays rooms out as a clean **tiling of
rectangles**, so v3 works in that rectangle domain:

- **resize** moves the shared edge with a clean full-edge neighbour (only those
  two rooms change);
- **remove** lets a neighbour absorb the room's rectangle;
- **add** splits a donor room into two;
- **swap** exchanges two rooms' identity + furniture in place (no walls move).

It then rebuilds the walls from the new rectangles and **re-maps the existing
openings onto them by world coordinate** — captured *relative to each room edge*
before the edit, so a door follows a wall that moves under a resize, stays put
under a swap, and only the interior wall between two merged rooms is dropped.
Untouched rooms keep their **exact** walls, openings, and furniture; the footprint
never changes. A brand-new room gets a door on its split wall so it stays
reachable.

**v2 — full re-flow (`worker/restructure.py`), the fallback.** When the floor
isn't a clean rectangle tiling (e.g. a hand-drawn L-shaped room) or an op has no
clean target, `apply_surgical` returns `None` and the turn re-flows instead:
derive the room **program** (name/type + area as weight), apply the change as a
pure list edit, then re-flow inside the **same footprint** with `bsp_layout`.
Footprint preserved, but untouched rooms move and openings regenerate. Always
works — so v3 is a fidelity upgrade on the common case, never a correctness risk.

Because either path replaces the entire floor, structural edits are **exclusive
per turn** — they can't compose with id-level local ops (whose roomIds wouldn't
survive the replace), so a turn is routed to one path or the other. `move_room`
is intentionally not implemented (ambiguous for a space-filling partition); the
model is steered toward `swap_rooms` instead, and a stray `move`/`unsupported`
still degrades into a warning.

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
  // v2/v3 (structural edits): a whole-floor replacement (surgical or re-flow).
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
| `replaceFloor` (v2/v3) | same path as `applyGeneratedPlan` |

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
- **Ambiguity** (e.g. two bedrooms and the user says "the bedroom"): the worker
  **clarifies back** instead of guessing — `_pending_clarification` detects a room
  handle that matches more than one room (or a `clarify` op the model emits for a
  vague request) and returns an empty patch with a question as the `summary`. The
  user's next message answers it; the replayed history gives the model the
  original intent, so "Bedroom 2" completes the pending resize. An empty patch
  means no commit, so a question never costs an undo step.

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
- `restructure.py` *(v2)* — structural re-flow (the fallback): program → `bsp_layout`.
- `surgical.py` *(v3)* — surgical structural edits (the default): rectangle-domain
  ops + box-relative opening re-map; falls back to v2 when the tiling isn't clean.
- `worker/tests/test_edits.py` *(new)* — fake-LLM/offline; `test_restructure.py`
  (v2) and `test_surgical.py` (v3) cover the structural geometry directly.

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
- `src/components/Panels/AssistantPanel.tsx` — the **chat shell**: one
  conversation that auto-routes (first message generates a plan, every message
  after edits it live), shows each reply's `summary`/`warnings` as assistant
  bubbles, and replays recent turns to the worker for reference resolution.

---

## How structural edits (v2/v3) reuse the v1 wire

- The patch is a **list of typed ops**, so the structural ops `resize_room` /
  `add_room` / `remove_room` / `swap_rooms` resolve (in `worker/surgical.py`, or
  `worker/restructure.py` as fallback) to a single `replaceFloor` op — without
  changing the wire envelope or `applyEditPatch`'s contract. v3 emits the **same**
  `replaceFloor` shape as v2; the only difference is that the geometry that comes
  back is locally stable, so the frontend never had to change for it.
- `replaceFloor` reuses the frontend's `applyGeneratedPlan` path, so all of
  v2 **and** v3 was **purely worker-side** work — no frontend change beyond the op
  that was already reserved.
- Because the floor is sent every call and the result is one undo step, a
  structural edit is still a single, undoable commit — no architectural change.

---

## What stays exactly the same

- LLM = intent, Python = geometry, store = one undo step.
- OpenRouter via the `openai` SDK (`llm.py`); no Anthropic SDK, no
  `ANTHROPIC_API_KEY`.
- Units: cm on this wire (like `/generate-plan`), since we're editing geometry.
- The backend never becomes the source of truth; it returns a patch the frontend
  commits, identical in spirit to a hand edit.
