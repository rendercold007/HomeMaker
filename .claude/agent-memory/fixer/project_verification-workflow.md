---
name: verification-workflow
description: Exact verify commands for HomeMaker after applying fixes (worker + frontend)
metadata:
  type: project
---

After fixing code in HomeMaker, verify with both suites — the project has a Python worker AND a TS frontend.

**Fact:** Verification commands the user expects all-green:
- Worker: `cd worker && python3 -m unittest discover -s tests -t .` (tests are offline — no network/API key needed)
- Frontend: `npm run typecheck && npm run build && npm test` (Vitest, run from repo root)

**Why:** Phase 4 changes span both halves (Python layout/solver/pipeline + TS adapters/gateway), so a fix in one can break the other's contract (e.g. JSON key names shared between `worker/layout.py` and `src/lib/aiPipeline/contract.ts`).

**How to apply:** Run worker unittest and frontend typecheck in parallel first (fast fail), then build + Vitest. When a fix changes a wire payload, grep the shared key name across both `worker/` and `src/lib/aiPipeline/` to confirm it round-trips.

LLM provider is OpenRouter via the `openai` SDK — intentional, never "correct" it to Anthropic/OpenAI. See [[git-workflow-user-driven]] — user runs all git themselves.
