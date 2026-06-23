# CLAUDE.md

> Project context for Claude Code. Read this before making changes.

## What we're building

A web-based **manual home design tool**: users draw a 2D floor plan on a grid — drawing, dragging, and snapping walls directly on a canvas — and instantly visualize and navigate it in 3D. The 2D editor and the 3D view are two windows onto **one shared model**; editing the plan in 2D immediately updates the 3D scene.

There is **no AI** in v1. The product is the hands-on editor and the live 2D→3D round-trip. (An earlier direction explored AI layout generation and Vastu/region-specific compliance; both were dropped — see git history.)

When in doubt about a feature, ask: "does this serve the hands-on editing experience, or the 2D→3D round-trip?" If neither, it's probably out of scope for v1.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict: true` in tsconfig. No implicit `any`. |
| Build/dev | Vite | `npm run dev` / `build` / `preview`. |
| UI | React 18 + Tailwind CSS | Function components + hooks only. |
| 2D canvas | react-konva (Konva) | The editor surface; per-shape event handling. |
| 3D view | react-three-fiber + three.js + drei | Extrudes the 2D wall graph; OrbitControls to navigate. |
| State | **Zustand** | One unified store is the source of truth. See the state rules below. |
| Persistence | localStorage | Local-only for v1. No backend. |
| Export | jsPDF | PNG / PDF of the canvas. |
| Testing | Vitest | For the pure geometry/rules logic in `src/model/`. |
| Package manager | npm | |

No backend: plans are saved to the browser. There is no server-side piece.

## Architecture

Data flows: **2D canvas (Konva) ⇄ Zustand store ⇄ 3D view (three.js)**.

The most important architectural rule: **Konva and three.js never talk to each other directly.** They both subscribe to the shared Zustand store. Drag a wall in 2D → Konva commits to the store → the 3D view re-renders from the new state. Build order: model + 2D editor first (they work with zero 3D), then the 3D viewer as a pure function of the model.

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
    byelaws.ts      # generic setback / FAR checks (configurable per jurisdiction)
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
- **Phase 4 — Wall joins & mitering.** Clean up corners where walls meet so they don't overlap awkwardly.
- **Phase 5 — Persistence + export polish.** localStorage save/load; PNG/PDF, then DXF.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # production build (tsc -b && vite build)
npm run preview    # preview the build
npm run test       # Vitest (model/ logic)
npm run typecheck  # tsc on app + node projects
```
