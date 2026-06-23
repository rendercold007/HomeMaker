import { useState } from 'react';
import { usePlan } from '../../state/PlanContext';
import { generatePlan } from '../../ai/generate';
import { renderPlan, type ViewType, type Quality } from '../../ai/render';
import { captureStagePng } from '../../lib/stageRef';
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

  const [renderView, setRenderView]       = useState<ViewType>('interior');
  const [renderQuality, setRenderQuality] = useState<Quality>('quick');
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError]     = useState<string | null>(null);
  const [renderUrl, setRenderUrl]         = useState<string | null>(null);

  function setPlotField<K extends keyof Plot>(key: K, value: Plot[K]) {
    setPlot((p) => ({ ...p, [key]: value }));
  }
  function setSetback(side: keyof Plot['setbacks'], value: number) {
    setPlot((p) => ({ ...p, setbacks: { ...p.setbacks, [side]: value } }));
  }

  const hasRooms = (plan.floors[0]?.rooms.length ?? 0) > 0;

  async function handleRender() {
    if (renderLoading || !hasRooms) return;
    setRenderLoading(true);
    setRenderError(null);
    try {
      const floorPlanPng = captureStagePng();
      const result = await renderPlan(plan, renderView, renderQuality, floorPlanPng);
      setRenderUrl(result.url);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderLoading(false);
    }
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

      {/* ── Visualize ──────────────────────────────────────────────────── */}
      <>
          <div className="border-t border-white/5" />

          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-600/30 text-rose-400">
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                  <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.54L1 12.5v-9a.5.5 0 0 1 .5-.5h13z"/>
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-slate-200">Visualize</h2>
            </div>
            <p className="text-[11px] text-slate-500">Generate a photorealistic render of your layout using AI.</p>
          </div>

          {/* View toggle */}
          <div className="grid grid-cols-2 gap-1">
            {(['interior', 'exterior'] as const).map(v => (
              <button
                key={v}
                onClick={() => setRenderView(v)}
                className={`rounded-lg py-1.5 text-xs font-medium capitalize transition-all ${
                  renderView === v
                    ? 'bg-rose-600/80 text-white shadow shadow-rose-500/20'
                    : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Quality toggle */}
          <div className="grid grid-cols-2 gap-1">
            {([['quick', 'Quick (Flash)'], ['hd', 'HD (Pro)']] as const).map(([q, label]) => (
              <button
                key={q}
                onClick={() => setRenderQuality(q)}
                className={`rounded-lg py-1.5 text-xs font-medium transition-all ${
                  renderQuality === q
                    ? 'bg-rose-600/80 text-white shadow shadow-rose-500/20'
                    : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!hasRooms && (
            <p className="text-[11px] text-amber-400/80 bg-amber-400/10 rounded-lg px-3 py-2">
              Generate a plan or draw rooms first to enable rendering.
            </p>
          )}

          <button
            onClick={() => { void handleRender(); }}
            disabled={renderLoading || !hasRooms}
            className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {renderLoading ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Rendering… (10–30s)
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                  <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.54L1 12.5v-9a.5.5 0 0 1 .5-.5h13z"/>
                </svg>
                Generate Render
              </>
            )}
          </button>

          {renderError && (
            <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{renderError}</div>
          )}
      </>

      {/* ── Image modal ─────────────────────────────────────────────────── */}
      {renderUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setRenderUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <img src={renderUrl} alt="AI render" className="w-full h-auto block" />
            <div className="absolute top-3 right-3 flex gap-2">
              <a
                href={renderUrl}
                download="homemaker-render.png"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-black/80"
                onClick={e => e.stopPropagation()}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                  <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
                Save
              </a>
              <button
                onClick={() => setRenderUrl(null)}
                className="flex items-center justify-center rounded-lg bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
                </svg>
              </button>
            </div>
            <div className="bg-black/80 px-4 py-2.5 text-[10px] text-slate-400 leading-relaxed">
              {renderView === 'interior' ? 'Interior' : 'Exterior'} · {renderQuality === 'quick' ? 'Gemini Flash Image' : 'Gemini Pro Image'} · Click outside to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
