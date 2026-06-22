/**
 * VastuPanel — Vastu compliance report and BBMP bye-law summary.
 *
 * Runs the pure rules engines on the current plan and displays violations.
 * Also lets the user toggle the Vastu mode (strict / loose / off).
 */
import { useMemo } from 'react';
import { usePlan } from '../../state/PlanContext';
import { checkVastu, type VastuViolation } from '../../model/vastu';
import { checkByelaws, type ByelawViolation } from '../../model/byelaws';
import type { VastuConfig } from '../../model/types';

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-green-100 text-green-700' :
    score >= 50 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {score}
    </span>
  );
}

function ViolationRow({ v }: { v: VastuViolation | ByelawViolation }) {
  const isError = v.severity === 'error';
  return (
    <li className="flex items-start gap-1.5 rounded bg-white px-2 py-1.5">
      <span className={`mt-px shrink-0 text-xs ${isError ? 'text-red-500' : 'text-amber-500'}`}>
        {isError ? '✗' : '⚠'}
      </span>
      <span className="text-slate-600">{v.message}</span>
    </li>
  );
}

const MODES: VastuConfig['mode'][] = ['strict', 'loose', 'off'];
const MODE_LABELS: Record<VastuConfig['mode'], string> = {
  strict: 'Strict',
  loose: 'Loose',
  off: 'Off',
};

export function VastuPanel() {
  const { plan, commit } = usePlan();

  const vastuReport = useMemo(() => checkVastu(plan), [plan]);
  const byelawReport = useMemo(() => checkByelaws(plan), [plan]);

  function setMode(mode: VastuConfig['mode']) {
    commit((p) => ({ ...p, vastu: { mode } }));
  }

  const currentMode = plan.vastu.mode;

  return (
    <aside className="flex w-56 flex-none flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-white p-3 text-sm">
      {/* Header + mode toggle */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Vastu</h2>
          {currentMode !== 'off' && <ScoreBadge score={vastuReport.score} />}
        </div>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded border px-1 py-0.5 text-xs transition-colors ${
                currentMode === m
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </section>

      {/* Vastu violations */}
      <section>
        {currentMode === 'off' ? (
          <p className="text-xs text-slate-400">Vastu checks disabled.</p>
        ) : vastuReport.violations.length === 0 ? (
          <p className="text-xs text-slate-400">
            {vastuReport.checkedRooms === 0
              ? 'Name rooms to check Vastu placement.'
              : 'All rooms comply.'}
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {vastuReport.violations.map((v) => (
              <ViolationRow key={v.id} v={v} />
            ))}
          </ul>
        )}
      </section>

      <div className="border-t border-slate-200" />

      {/* BBMP bye-laws */}
      <section>
        <h2 className="mb-2 font-semibold text-slate-700">BBMP Bye-laws</h2>
        <dl className="mb-2 space-y-0.5 text-xs text-slate-600">
          <div className="flex justify-between">
            <dt>Ground coverage</dt>
            <dd>{byelawReport.groundCoveragePercent.toFixed(1)}%</dd>
          </div>
          <div className="flex justify-between">
            <dt>FAR</dt>
            <dd>{byelawReport.far.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Setback pts</dt>
            <dd className={byelawReport.setbackViolatingPoints.length > 0 ? 'text-red-500' : ''}>
              {byelawReport.setbackViolatingPoints.length > 0
                ? `${byelawReport.setbackViolatingPoints.length} issue${byelawReport.setbackViolatingPoints.length > 1 ? 's' : ''}`
                : 'OK'}
            </dd>
          </div>
        </dl>
        {byelawReport.violations.length > 0 && (
          <ul className="space-y-1 text-xs">
            {byelawReport.violations.map((v) => (
              <ViolationRow key={v.id} v={v} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
