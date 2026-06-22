import { useState } from 'react';
import { usePlan } from '../../state/PlanContext';
import { generatePlan } from '../../ai/generate';
import type { Plot } from '../../model/types';

type Entrance = Plot['entrance'];
const ENTRANCES: Entrance[] = ['N', 'S', 'E', 'W'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={0}
      onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) onChange(v); }}
      className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-right text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
    />
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
    setLoading(true); setError(null); setSuccess(false);
    try {
      const result = await generatePlan({ prompt: prompt.trim(), plot, vastu: plan.vastu });
      reset(result);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600/30 text-indigo-400">
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5 4a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H5zm-.25 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5H4.75zM4 11.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75z"/>
              <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm15 0a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2z"/>
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-slate-200">AI Generate</h2>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Describe your dream home and let AI create a Vastu-compliant layout.</p>
      </div>

      {/* Plot dimensions */}
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Plot Size</p>
        <Field label="Width (cm)"><NumInput value={plot.widthCm} onChange={(v) => setPlotField('widthCm', v)} /></Field>
        <Field label="Depth (cm)"><NumInput value={plot.depthCm} onChange={(v) => setPlotField('depthCm', v)} /></Field>
      </section>

      {/* Entrance */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Entrance Direction</p>
        <div className="grid grid-cols-4 gap-1">
          {ENTRANCES.map((dir) => (
            <button
              key={dir}
              onClick={() => setPlotField('entrance', dir)}
              className={`rounded-lg py-1.5 text-xs font-bold transition-all ${
                plot.entrance === dir
                  ? 'bg-indigo-600 text-white shadow shadow-indigo-500/30'
                  : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
              }`}
            >
              {dir}
            </button>
          ))}
        </div>
      </section>

      {/* Setbacks */}
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Setbacks (cm)</p>
        <Field label="Front"><NumInput value={plot.setbacks.front} onChange={(v) => setSetback('front', v)} /></Field>
        <Field label="Rear" ><NumInput value={plot.setbacks.rear}  onChange={(v) => setSetback('rear',  v)} /></Field>
        <Field label="Left" ><NumInput value={plot.setbacks.left}  onChange={(v) => setSetback('left',  v)} /></Field>
        <Field label="Right"><NumInput value={plot.setbacks.right} onChange={(v) => setSetback('right', v)} /></Field>
      </section>

      <div className="border-t border-white/5" />

      {/* Vastu info */}
      <p className="text-[11px] text-slate-500">
        Vastu: <span className="font-medium text-amber-400">{plan.vastu.mode}</span>
        <span className="text-slate-600"> · change in right panel</span>
      </p>

      {/* Requirements */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Requirements</p>
        <textarea
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setSuccess(false); }}
          placeholder={'3BHK, pooja room NE,\nkitchen SE, 2 bathrooms,\nparking for 1 car'}
          rows={5}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
        />
      </section>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={loading || !prompt.trim()}
        className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
          <>
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Generating plan…
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
            </svg>
            Generate Plan
          </>
        )}
      </button>

      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 flex-none">
            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/>
          </svg>
          Plan loaded — refine by drawing walls!
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
      )}
    </div>
  );
}
