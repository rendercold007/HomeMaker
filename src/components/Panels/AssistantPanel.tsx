/**
 * AssistantPanel — Phase 4 entry point (chat → furnished plan).
 *
 * A prompt box with two actions: "Generate plan" (whole multi-room floor plan)
 * and "Auto-furnish" (furniture for the current room). Both POST the prompt to
 * the worker, which the LLM consumes to drive the layout/shopping list. Each
 * result is committed to the store as ONE undo step, so 2D and 3D update from the
 * same Plan. With the worker offline, auto-furnish falls back to the step-1 mock;
 * plan generation requires the worker. See src/lib/aiPipeline/client.ts.
 */
import { useState } from 'react';
import { usePlan, useActiveFloor } from '../../state/store';
import { requestAutoFurnish, requestGeneratePlan } from '../../lib/aiPipeline/client';
import { applyGeneratedFurniture } from '../../lib/aiPipeline/applyGenerated';
import { applyGeneratedPlan } from '../../lib/aiPipeline/applyPlan';
import type { AutoFurnishRequest, GeneratePlanRequest } from '../../lib/aiPipeline/contract';
import { DEFAULT_WALL_HEIGHT } from '../../model/planEdits';

const CM_PER_M = 100;

export function AssistantPanel() {
  const { plan, commit } = usePlan();
  const { activeFloorId } = useActiveFloor();
  const [prompt, setPrompt] = useState('A 2BHK apartment');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Wrap an async action with shared loading/error state.
  async function run(action: () => Promise<void>) {
    setStatus('loading');
    setError(null);
    try {
      await action();
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setStatus('error');
    }
  }

  // Generate a whole multi-room floor plan: walls + doors + windows + furniture.
  function handleGeneratePlan() {
    const req: GeneratePlanRequest = {
      prompt,
      plot: { widthCm: plan.plot.widthCm, depthCm: plan.plot.depthCm },
    };
    return run(async () => {
      const res = await requestGeneratePlan(req);
      // One commit → one undo step; re-enters through the store, not around it.
      commit((current) => applyGeneratedPlan(current, activeFloorId, res));
    });
  }

  // Furnish the current room (furniture only — leaves the walls alone).
  function handleFurnish() {
    const req: AutoFurnishRequest = {
      prompt,
      room: {
        dimensions: {
          width: plan.plot.widthCm / CM_PER_M,
          length: plan.plot.depthCm / CM_PER_M,
          height: DEFAULT_WALL_HEIGHT / CM_PER_M,
        },
      },
    };
    return run(async () => {
      const res = await requestAutoFurnish(req);
      commit((current) => applyGeneratedFurniture(current, activeFloorId, res));
    });
  }

  const loading = status === 'loading';

  return (
    <aside className="flex h-full w-full flex-col gap-3 p-3 text-sm text-slate-200">
      <div>
        <h2 className="font-semibold text-slate-100">AI Assistant</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
          Describe a home or room — HomeMaker draws the walls and furnishes it.
          <br />
          <span className="text-slate-500">e.g. &ldquo;a 2BHK apartment&rdquo; or &ldquo;a cozy modern bedroom&rdquo;.</span>
        </p>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="e.g. A 2BHK apartment with a big living room"
        className="w-full resize-none rounded-md border border-white/10 bg-white/5 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
      />

      <button
        type="button"
        onClick={handleGeneratePlan}
        disabled={loading || prompt.trim().length === 0}
        className="flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'Working…' : '🏠 Generate floor plan'}
      </button>
      <button
        type="button"
        onClick={handleFurnish}
        disabled={loading || prompt.trim().length === 0}
        className="flex items-center justify-center gap-2 rounded-md border border-indigo-400/40 bg-white/5 px-3 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-white/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ✨ Furnish current room
      </button>

      {status === 'error' && error && (
        <p className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-300">{error}</p>
      )}

      <p className="mt-auto text-[10px] leading-snug text-slate-500">
        Generate replaces this floor; Furnish adds to it. Both are one undo step — switch to 3D to walk it.
      </p>
    </aside>
  );
}
