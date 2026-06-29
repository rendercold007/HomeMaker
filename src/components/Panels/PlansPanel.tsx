import { useState, useEffect } from 'react';
import { usePlan } from '../../state/store';
import { listPlans, loadPlan, deletePlan, type PlanMeta } from '../../lib/storage';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function PlansPanel() {
  const { plan, reset } = usePlan();
  const [plans, setPlans] = useState<PlanMeta[]>([]);

  function refresh() { setPlans(listPlans()); }
  useEffect(refresh, []);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600/30 text-emerald-400">
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-slate-200">My Plans</h2>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Your saved floor plans are stored locally in this browser.</p>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-xl border border-white/5 px-4 py-6 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="mx-auto mb-2 h-8 w-8 text-slate-700">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          <p className="text-xs text-slate-600">No saved plans yet.</p>
          <p className="mt-1 text-[10px] text-slate-700">Click Save in the header to save your work.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {plans.map((meta) => {
            const isActive = meta.id === plan.id;
            return (
              <li key={meta.id}>
                <button
                  onClick={() => { const p = loadPlan(meta.id); if (p) reset(p); }}
                  className={`group w-full rounded-xl border px-3 py-2.5 text-left transition-all ${
                    isActive
                      ? 'border-zinc-500/50 bg-zinc-700/30'
                      : 'border-white/5 bg-white/3 hover:border-white/10 hover:bg-white/5'
                  }`}
                  style={!isActive ? { background: 'rgba(255,255,255,0.03)' } : {}}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-xs font-semibold ${isActive ? 'text-zinc-400' : 'text-slate-300'}`}>
                        {meta.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-600">{formatDate(meta.savedAt)}</p>
                    </div>
                    {isActive ? (
                      <span className="flex-none rounded-full bg-zinc-700/40 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300">Active</span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePlan(meta.id); refresh(); }}
                        className="flex-none opacity-0 text-slate-600 transition hover:text-red-400 group-hover:opacity-100"
                        title="Delete"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                          <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0H11z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
