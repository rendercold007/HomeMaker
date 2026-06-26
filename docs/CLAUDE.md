# CLAUDE.md

> Project context for Claude Code. Read this before making changes.

## What we're building

A web-based **home design tool**: at its core, users draw a 2D floor plan on a grid — drawing, dragging, and snapping walls directly on a canvas — and instantly visualize and navigate it in 3D. The 2D editor and the 3D view are two windows onto **one shared model**; editing the plan in 2D immediately updates the 3D scene.

On top of that hands-on editor we're building an **AI design assistant** (see `docs/BackenAndAI.md`): a user describes a room in natural language and the system auto-furnishes it with real 3D models placed at collision-free coordinates. Crucially, the **LLM reasons about style and intent only** — it returns a "shopping list" of items and spatial rules, never coordinates. All exact `[X, Y, Z]` placement comes from a deterministic spatial solver, because LLMs are unreliable at 3D math. (An earlier direction explored Vastu / region-specific compliance; that was dropped — see git history. AI *layout/furnishing* is now the core moat, not generic AI image generation.)

When in doubt about a feature, ask: "does this serve the hands-on editing experience, the 2D→3D round-trip, or the chat→layout assistant?" If none of those, it's probably out of scope.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict: true` in tsconfig. No implicit `any`. |
| Build/dev | Vite | `npm run dev` / `build` / `preview`. |
| UI | React 18 + Tailwind CSS | Function components + hooks only. |
| 2D canvas | react-konva (Konva) | The editor surface; per-shape event handling. |
| 3D view | react-three-fiber + three.js + drei | Extrudes the 2D wall graph; OrbitControls to navigate. |
| State | **Zustand** | One unified store is the source of truth. See the state rules below. |
| Persistence | localStorage + PostgreSQL | Local cache for the working plan; projects save/load via the backend. |
| Export | jsPDF | PNG / PDF of the canvas. |
| Testing | Vitest | For the pure geometry/rules logic in `src/model/`. |
| Package manager | npm | |
| **Backend (AI pipeline)** | | |
| API gateway | Node.js + Express, PostgreSQL | Front door for the frontend: auth, project save/load, routes heavy AI jobs to the worker so Node doesn't block. |
| AI worker | Python + FastAPI | Runs the generation pipeline: LLM intent → semantic search → spatial solver. |
| LLM | OpenRouter (OpenAI-compatible) | Style/intent reasoning only — produces a "shopping list," never coordinates. Any model slug via `LLM_MODEL`. |
| Vector DB | pgvector / Pinecone | Maps generic items (e.g. "lounge chair") to real `.glb` assets + bounding boxes. |
| 3D assets | glTF `.glb` via three.js `GLTFLoader` | Furniture models rendered at solver-computed coordinates. |

The frontend stays client-side, but **generation runs on a backend**: a Node gateway fronts a Python FastAPI worker (the AI pipeline). LLMs handle reasoning/style; a deterministic Python spatial solver computes all collision-free coordinates. See `docs/BackenAndAI.md` for the full pipeline and request flow.

## Architecture

Data flows: **2D canvas (Konva) ⇄ Zustand store ⇄ 3D view (three.js)**.

The most important architectural rule: **Konva and three.js never talk to each other directly.** They both subscribe to the shared Zustand store. Drag a wall in 2D → Konva commits to the store → the 3D view re-renders from the new state. Build order: model + 2D editor first (they work with zero 3D), then the 3D viewer as a pure function of the model.

### The AI backend (Phase 4)

The client-side trio above is unchanged and **remains the source of truth.** The backend is a separate, asynchronous **generator** the frontend calls on demand — it does *not* hold the canonical `Plan`. It takes a room + a prompt and returns furniture placements, which the frontend commits to the Zustand store exactly like any manual edit.

```
React/Zustand frontend
   │  POST /api/design/auto-furnish   (prompt + room dimensions + doors/windows)
   ▼
Node.js API gateway        — auth, project save/load (PostgreSQL), routes the job
   │                          (keeps the Node main thread unblocked)
   ▼
Python FastAPI worker
   ① LLM            → "shopping list": items + spatial rules (NO coordinates)
   ② Vector DB      → match each item to a real .glb + its bounding box
   ③ Spatial solver → deterministic, collision-free [X,Y,Z] + rotation
   │  generated_furniture: [{ asset_id, position, rotation }]
   ▼
Node gateway → React → Zustand store commit → three.js GLTFLoader renders the .glb
```

The crucial boundary rule: **the backend response re-enters through the store, never around it.** Generated furniture is committed as one undo step, so 2D, 3D, and undo/redo keep working unchanged — the same way a hand-placed item would. The backend never writes 3D-only state, and three.js still renders purely from the `Plan`. Because generation is asynchronous (LLM + solver take seconds), the UI must not block on it; show progress and commit when the response lands. Full pipeline and payloads: `docs/BackenAndAI.md`.

### The core data model (most important thing in the codebase)

Everything — 2D editor, 3D view, exporter — reads and writes this one schema. Rooms are **not** stored; they are *derived* by finding closed cycles in the wall graph (`src/model/roomDetect.ts`). Walls reference shared `Point` ids, so dragging a corner moves every wall attached to it. Keep these types stable; changing them ripples everywhere.

```ts
// All coordinates in CENTIMETERS (integer-friendly world units).
// Origin top-left, y increases downward (screen convention).
// Convert to feet-inches / meters only for display.

type ID = string;

interface Point { id: ID; x: number; y: number }          // world cm
interface Wall  { id: ID; a: ID; b: ID; thickness: number; height: number } // endpoints = Point ids; cm
interface Opening {
  id: ID; wallId: ID; kind: 'door' | 'window';
  offset: number;  // distance along wall from endpoint a, cm
  width: number;   // cm
}
interface Room {                 // DERIVED, not authored directly
  id: ID; wallIds: ID[]; name: string; areaCm2: number;
}
interface Furniture {
  id: ID; type: string; x: number; y: number; rotationDeg: number; roomId?: ID;
}
interface Floor {
  id: ID; level: number;
  points: Point[]; walls: Wall[]; openings: Opening[];
  rooms: Room[]; furniture: Furniture[];
}
interface Plot {
  widthCm: number; depthCm: number;
  shape: 'rectangular' | 'square' | 'lshape' | 'irregular';
  entrance: 'N' | 'S' | 'E' | 'W';
  setbacks: { front: number; rear: number; left: number; right: number }; // cm
}

interface Plan {
  id: ID; name: string; units: 'cm';
  plot: Plot; floors: Floor[];
}
```

### Directory layout

```
src/
  model/            # PURE logic — no React imports. Unit-tested with Vitest.
    types.ts        # the schema above
    geometry.ts     # distance, snapping, angle-lock, segment intersection
    roomDetect.ts   # cycle detection in the wall graph → Room[]
    planEdits.ts    # pure, immutable edits to a Plan (add/move/delete walls, etc.)
    furniture.ts    # furniture catalog + lookup
  state/
    store.ts        # the unified Zustand store + usePlan / useTool / useSelection hooks
  components/
    Canvas/         # react-konva editor surface (CanvasStage + layers)
    Toolbar/
    Panels/         # info / dimensions, furniture palette, saved plans
    Viewer3D/       # react-three-fiber — extrudes the wall graph
  lib/
    storage.ts      # localStorage save/load
    export.ts       # PNG / PDF
    units.ts        # cm → ft-in / m formatting
  App.tsx
```

## Conventions

### State (Zustand — read this carefully)

The store in `src/state/store.ts` holds three concerns: the committed `Plan` (with undo/redo history), the active tool + grid settings, and the current selection. Consumers use the `usePlan` / `useTool` / `useSelection` hooks, each of which selects a narrow slice via `useShallow` so unrelated changes don't re-render.

- **Committed document state** (the `Plan`: points, walls, rooms) changes only on **discrete commits** — finishing a wall, ending a drag, completing an edit. Each commit is one undo step.
- **Transient / high-frequency state** (live mouse position, the wall being rubber-banded, the in-progress drag delta) lives in **local component state or refs** — NEVER in the store. Write to the store only on `mouseup` / commit. Committing every drag frame would push a snapshot per frame onto the undo stack.
- Select narrow slices. Don't subscribe a component to the whole store.

If a change makes the canvas stutter during drag, the cause is almost always transient state leaking into the store — fix that first.

### Units and geometry

- Internal world unit is **centimeters, kept integer-friendly** to avoid float drift in snapping. Convert to feet-inches and meters only at display time.
- Screen ↔ world conversion goes through a single pan/zoom transform. Never mix screen px and world cm in the same calculation.
- Snapping targets, in priority order: existing points → grid → 90°/45° angle lock (hold Shift). Live dimension readout while drawing is required, not optional.

### Pure logic stays pure

Everything in `src/model/` must have **zero React imports** and be covered by Vitest. Geometry, room detection, and bye-law checks are all input→output functions — test them like algorithm problems (feed a plan, assert the result).

### 3D view

The 3D view is a pure function of the `Plan`. Each wall extrudes to a box of its `thickness` × `height`, split into segments around door/window openings. Room floors are filled `THREE.Shape`s; furniture maps to simple meshes by type. Coordinate mapping: cm ÷ 100 → metres, and 2D `y` → 3D `z` (depth). Never store 3D-only state back into the model.

### Working style

- **Prefer targeted edits over rewrites.** When fixing a bug, change the specific lines responsible — don't regenerate whole files.
- Small, single-purpose components. Lift state only as far as needed.
- Keep undo/redo working (state snapshots of `Plan`); don't defer it.

## Roadmap (build in this order)

- **Phase 1 — Grid + state + drawing.** React-Konva stage, dot grid, wall drawing with snapping + live dimensions, select/drag/delete, undo/redo, room detection. *(done)*
- **Phase 2 — Openings + furniture.** Doors/windows as openings in walls; furniture palette with drag/rotate/snap. *(done)*
- **Phase 3 — 3D viewer.** Extrude the wall graph via react-three-fiber; OrbitControls; render furniture. *(done)*
- **Phase 4 — AI Brain framework & engine integration.** Stand up the backend that turns a prompt + room into collision-free 3D furniture. Build **inside-out** (see `docs/BackenAndAI.md`): (1) mock the pipeline with a hardcoded Node endpoint and render it in three.js; (2) build the Python spatial solver (grid + bounding-box collision); (3) wire the LLM for dynamic "shopping lists"; (4) add the vector DB for real `.glb` assets.
- **Phase 5 — Wall joins & mitering.** Clean up corners where walls meet so they don't overlap awkwardly.
- **Phase 6 — Persistence + export polish.** Project save/load (localStorage + backend); PNG/PDF, then DXF.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # production build (tsc -b && vite build)
npm run preview    # preview the build
npm run test       # Vitest (model/ logic)
npm run typecheck  # tsc on app + node projects
```
