import { useMemo } from 'react';
import { usePlan } from '../../state/PlanContext';
import { checkVastu } from '../../model/vastu';
import { checkByelaws } from '../../model/byelaws';
import type { VastuConfig } from '../../model/types';

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171';
  const r = 18, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s ease' }} />
      </svg>
      <span className="text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

const MODES: VastuConfig['mode'][] = ['strict', 'loose', 'off'];

export function VastuPanel() {
  const { plan, commit } = usePlan();
  const vastuReport  = useMemo(() => checkVastu(plan),    [plan]);
  const byelawReport = useMemo(() => checkByelaws(plan),  [plan]);

  function setMode(mode: VastuConfig['mode']) {
    commit((p) => ({ ...p, vastu: { mode } }));
  }

  const mode = plan.vastu.mode;
  const violations = [...vastuReport.violations, ...byelawReport.violations];

  return (
    <aside className="flex-none border-t border-white/5 p-3 space-y-3">
      {/* Vastu header */}
      <div className="flex items-center gap-3">
        {mode !== 'off' && <ScoreRing score={vastuReport.score} />}
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Vastu</p>
          {mode !== 'off' && (
            <p className="text-xs text-slate-400 mt-0.5">
              {vastuReport.violations.length === 0 ? '✓ All rooms comply' : `${vastuReport.violations.length} violation${vastuReport.violations.length > 1 ? 's' : ''}`}
            </p>
          )}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-white/5 bg-white/3 p-0.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1 text-[10px] font-semibold uppercase tracking-wide transition-all ${
              mode === m
                ? 'bg-amber-500 text-slate-900 shadow'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Violations */}
      {violations.length > 0 && (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {violations.map((v, i) => (
            <li key={i} className={`flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[10px] leading-snug ${
              v.severity === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
            }`}>
              <span className="flex-none font-bold">{v.severity === 'error' ? '✗' : '!'}</span>
              <span>{v.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* BBMP summary */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">BBMP Bye-laws</p>
        <div className="space-y-1">
          {[
            { label: 'Coverage', value: `${byelawReport.groundCoveragePercent.toFixed(1)}%`, ok: byelawReport.violations.every(v => !v.message.includes('coverage')) },
            { label: 'FAR',      value: byelawReport.far.toFixed(2),                              ok: byelawReport.violations.every(v => !v.message.includes('FAR')) },
            { label: 'Setbacks', value: byelawReport.setbackViolatingPoints.length === 0 ? 'OK' : 'Fail', ok: byelawReport.setbackViolatingPoints.length === 0 },
          ].map(({ label, value, ok }) => (
            <div key={label} className="flex items-center justify-between rounded-lg px-2.5 py-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <span className="text-xs text-slate-500">{label}</span>
              <span className={`text-xs font-semibold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
