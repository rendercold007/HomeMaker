/**
 * GeneratePanel — AI floor plan generation side panel.
 *
 * Lets the user describe room requirements in plain text, configure plot
 * dimensions, and call the DeepSeek-powered /api/generate endpoint. On success
 * the result replaces the current plan via PlanContext.reset().
 */
import { useState } from 'react';
import { usePlan } from '../../state/PlanContext';
import { generatePlan } from '../../ai/generate';
import type { Plot } from '../../model/types';

type Entrance = Plot['entrance'];
const ENTRANCES: Entrance[] = ['N', 'S', 'E', 'W'];

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-1">
      <span className="text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= 0) onChange(v);
        }}
        className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right text-xs focus:border-blue-400 focus:outline-none"
      />
    </label>
  );
}

export function GeneratePanel() {
  const { plan, reset } = usePlan();

  const [plot, setPlot] = useState<Plot>({ ...plan.plot });
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function setPlotField<K extends keyof Plot>(key: K, value: Plot[K]) {
    setPlot((p) => ({ ...p, [key]: value }));
  }

  function setSetback(side: keyof Plot['setbacks'], value: number) {
    setPlot((p) => ({ ...p, setbacks: { ...p.setbacks, [side]: value } }));
  }

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await generatePlan({ prompt: prompt.trim(), plot, vastu: plan.vastu });
      reset(result);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="flex w-52 flex-none flex-col gap-3 overflow-y-auto bg-slate-50 p-3 text-sm">
      <h2 className="font-semibold text-slate-700">AI Generate</h2>

      {/* Plot dimensions */}
      <section className="space-y-1.5">
        <p className="text-xs font-medium text-slate-500">Plot size</p>
        <NumInput label="Width (cm)" value={plot.widthCm} onChange={(v) => setPlotField('widthCm', v)} />
        <NumInput label="Depth (cm)" value={plot.depthCm} onChange={(v) => setPlotField('depthCm', v)} />
      </section>

      {/* Entrance direction */}
      <section>
        <p className="mb-1 text-xs font-medium text-slate-500">Entrance</p>
        <div className="flex gap-1">
          {ENTRANCES.map((dir) => (
            <button
              key={dir}
              onClick={() => setPlotField('entrance', dir)}
              className={`flex-1 rounded border py-0.5 text-xs transition-colors ${
                plot.entrance === dir
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {dir}
            </button>
          ))}
        </div>
      </section>

      {/* Setbacks */}
      <section className="space-y-1.5">
        <p className="text-xs font-medium text-slate-500">Setbacks (cm)</p>
        <NumInput label="Front" value={plot.setbacks.front} onChange={(v) => setSetback('front', v)} />
        <NumInput label="Rear"  value={plot.setbacks.rear}  onChange={(v) => setSetback('rear', v)} />
        <NumInput label="Left"  value={plot.setbacks.left}  onChange={(v) => setSetback('left', v)} />
        <NumInput label="Right" value={plot.setbacks.right} onChange={(v) => setSetback('right', v)} />
      </section>

      <div className="border-t border-slate-200" />

      {/* Vastu mode (read-only display — change via VastuPanel) */}
      <p className="text-xs text-slate-400">
        Vastu: <span className="font-medium text-slate-600">{plan.vastu.mode}</span>
        {' '}· change in the Vastu panel →
      </p>

      {/* Requirements */}
      <section className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-slate-500">Requirements</p>
        <textarea
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setSuccess(false); }}
          placeholder={'3BHK, pooja room NE,\nkitchen SE, parking for 2 cars,\nVastu compliant'}
          rows={5}
          className="w-full resize-none rounded border border-slate-300 p-1.5 text-xs leading-relaxed focus:border-blue-400 focus:outline-none"
        />
      </section>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={loading || !prompt.trim()}
        className="flex items-center justify-center gap-2 rounded bg-blue-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Generating…
          </>
        ) : (
          'Generate Plan'
        )}
      </button>

      {/* Success */}
      {success && !error && (
        <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-700">
          Plan loaded — draw more walls to refine.
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </aside>
  );
}
