---
name: scope-and-tooling
description: HomeMaker scope-creep and missing-tooling facts to flag — byelaws dead code, no ESLint, stale AI references
metadata:
  type: project
---

Scope / tooling state as of 2026-06-24 (re-verify before acting):

- **`src/model/byelaws.ts` + `byelaws.test.ts` — DELETED 2026-06-24.** Was ~450 lines of dead BBMP region-specific code; removed for scope discipline. Re-verify it hasn't crept back if region/compliance work appears.
- **ESLint — ADDED 2026-06-24.** `eslint.config.js` (flat config, ESLint 9 + typescript-eslint + react-hooks + react-refresh), `lint` script in package.json. `npm run lint` passes clean. The inert CanvasStage `eslint-disable` is gone; the masked missing-dep was fixed by memoizing `pointerWorld` with `useCallback([viewport])` and adding it to both handler dep arrays. Gap: test files have no vitest-globals config, but they import describe/it/expect explicitly so it doesn't matter yet.
- **Stale AI references** in comments: `stageRef.ts` says captureStagePng is "for AI rendering"; `types.ts` header says "Everything (editor, AI, exporter)". `captureStagePng` is itself unused (only `getStageRef` is used, by export.ts). AI was dropped in v1 — these comments mislead.
- **Typecheck + tests are green** (84 tests pass, tsc clean) — the bugs are logic/architecture, not type errors.
- `@vercel/node` is in devDependencies despite "no backend" — vestigial.
