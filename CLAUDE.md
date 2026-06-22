# CLAUDE.md

> Project context for Claude Code. Read this before making changes.
> Rename the project (`gharsaaz` is a placeholder) and adjust paths as the codebase grows.

## What we're building

A web-based home design tool: a **hands-on floor-plan editor** where users draw, drag, and snap walls directly on a canvas — not just prompt or pick from templates. AI assists *inside* the editor (generate a starter layout, edit by chat, auto-furnish) rather than replacing it.

The wedge — and the reason this isn't "another Planner 5D" — is the **Indian market that the global tools ignore**: Vastu compliance, pooja rooms, parking, joint-family layouts, and local building bye-laws (Bengaluru/BBMP setbacks and FAR) are first-class, built-in concepts. Vastu is treated as a **constraint system**, which is what makes AI layout generation tractable: instead of learning generic "livability," the AI satisfies explicit directional rules.

When in doubt about a feature, ask: "does this serve the hands-on editing experience, or the Indian-home differentiator?" If neither, it's probably out of scope for v1.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict: true` in tsconfig. No implicit `any`. |
| Build/dev | Vite | `npm run dev` / `build` / `preview`. |
| UI | React 18 + Tailwind CSS | Function components + hooks only. |
| 2D canvas | react-konva (Konva) | The editor surface; per-shape event handling. |
| 3D view | react-three-fiber + three.js | Phase 6 — a *view* of the 2D model, not a separate system. |
| State | React Context | See the state rules below — this needs discipline. |
| AI | Claude API (model: `claude-sonnet-4-6`) | Called via a dev proxy, never directly from the browser. |
| Validation | zod | Validate AI JSON output against the Plan schema before rendering. |
| Persistence | localStorage / IndexedDB | Local-only for v1. No backend yet. |
| Testing | Vitest | For the pure geometry/rules logic. |
| Package manager | npm | |

No backend in v1: plans are saved to the browser. The only server-side piece is a thin proxy for the Claude API key (a Vite dev-server proxy now, a serverless function later) — the key must NEVER ship in client code.

## Architecture

Data flows: **input → constraint engine (Vastu + bye-laws) → Claude generates a JSON spec → wall-graph model → 2D editor → (3D view / export)**, with an AI-assist loop on the editor.

But the **build order is different from the data flow**: build the model and editor first (they work with zero AI), then the rules engine, then bolt AI on top. AI generates *into* the editor, so the editor must exist first.

### The core data model (most important thing in the codebase)

Everything — editor, AI, exporter — reads and writes this one schema. Rooms are **not** stored; they are *derived* by finding closed cycles in the wall graph. Keep these types stable; changing them ripples everywhere.

```ts
// All coordinates in CENTIMETERS (integer-friendly world units).
// Origin top-left, y increases downward (screen convention).
// Convert to feet-inches / meters only for display.

type ID = string;

interface Point { id: ID; x: number; y: number }          // world cm
interface Wall  { id: ID; a: ID; b: ID; thickness: number } // endpoints = Point ids; thickness cm
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
interface VastuConfig { mode: 'strict' | 'loose' | 'off' }

interface Plan {
  id: ID; name: string; units: 'cm';
  plot: Plot; floors: Floor[]; vastu: VastuConfig;
}
```

### Directory layout

```
src/
  model/            # PURE logic — no React imports. Unit-tested with Vitest.
    types.ts        # the schema above
    geometry.ts     # distance, snapping, angle-lock, segment intersection
    roomDetect.ts   # cycle detection in the wall graph → Room[]
    vastu.ts        # Vastu rules engine → violations + score
    byelaws.ts      # BBMP setback / FAR checks
  state/            # React Context providers (see rules below)
    PlanContext.tsx       # the committed document (Plan)
    ToolContext.tsx       # active tool/mode, grid settings
    SelectionContext.tsx  # current selection
  components/
    Canvas/         # react-konva editor surface
    Toolbar/
    Panels/         # properties, dimensions, vastu report
    Viewer3D/       # react-three-fiber (Phase 6)
  ai/
    generate.ts     # prompt → Plan spec
    assist.ts       # chat edit → modified Plan
    schema.ts       # zod schema mirroring types.ts; validates AI output
  lib/
    storage.ts      # localStorage / IndexedDB
    export.ts       # PNG / PDF / DXF
  App.tsx
```

## Conventions

### State (React Context — read this carefully)

Context re-renders all consumers on every value change. In a canvas editor with continuous drag events, naive Context = jank. Follow this split:

- **Committed document state** (the `Plan`: points, walls, rooms) lives in `PlanContext`. It changes only on **discrete commits** — finishing a wall, ending a drag, completing an edit.
- **Transient / high-frequency state** (live mouse position, the wall being rubber-banded, the in-progress drag delta) lives in **local component state or refs** — NEVER in Context. Write to Context only on `mouseup` / commit.
- Keep `PlanContext`, `ToolContext`, and `SelectionContext` **separate** so a tool change doesn't re-render the whole canvas.
- Wrap context values in `useMemo` and callbacks in `useCallback`.

If a change makes the canvas stutter during drag, the cause is almost always transient state leaking into Context — fix that first.

### Units and geometry

- Internal world unit is **centimeters, kept integer-friendly** to avoid float drift in snapping. Convert to feet-inches and meters only at display time.
- Screen ↔ world conversion goes through a single pan/zoom transform. Never mix screen px and world cm in the same calculation.
- Snapping targets, in priority order: existing points → grid → 90°/45° angle lock (hold Shift). Live dimension readout while drawing is required, not optional.

### Pure logic stays pure

Everything in `src/model/` must have **zero React imports** and be covered by Vitest. Geometry, room detection, Vastu, and bye-law checks are all input→output functions — test them like algorithm problems (feed a plan, assert the result). This keeps the hard logic verifiable independent of the UI.

### AI integration

- Model string: `claude-sonnet-4-6`. The API key lives server-side (dev proxy / serverless function) — **never** in client bundles or committed to git.
- The system prompt instructs Claude to output **only** JSON matching the Plan schema, satisfying the active Vastu/bye-law constraints, with no preamble.
- **Always** validate AI output with the zod schema in `ai/schema.ts` before rendering. Reject and retry on invalid output; never render unvalidated JSON.

### Working style

- **Prefer targeted edits over rewrites.** When fixing a bug, change the specific lines responsible — don't regenerate whole files.
- Small, single-purpose components. Lift state only as far as needed.
- Add undo/redo early (state snapshots of `Plan`); don't defer it.

## Roadmap (build in this order)

- **Phase 0 — Data model + coordinate math.** `types.ts`, pan/zoom transform. *(foundation)*
- **Phase 1 — Hands-on 2D editor.** Grid, wall drawing + snapping + live dimensions, select/drag/delete, undo/redo, room detection. *← current focus; usable with zero AI*
- **Phase 2 — Openings + furniture.** Doors/windows as openings in walls; furniture palette with drag/rotate/snap.
- **Phase 3 — Vastu + bye-law engine.** Pure rules in `model/`, fully tested. Built before AI because AI uses these as constraints.
- **Phase 4 — AI generation.** Claude → validated Plan spec → renders in the editor. *(MVP = Phases 0–4)*
- **Phase 5 — In-editor AI assist.** Chat edits + auto-furnish.
- **Phase 6 — 3D view.** Extrude walls via react-three-fiber.
- **Phase 7 — Persistence + export.** localStorage/IndexedDB save-load; PNG/PDF, then DXF.

MVP and portfolio centerpiece = Phases 0–4. Phases 5–7 are upgrades once the core is proven.

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # production build
npm run preview   # preview the build
npm run test      # Vitest (model/ logic)
```
