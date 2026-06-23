import { useState } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { FurniturePalette } from './components/Panels/FurniturePalette';
import { InfoPanel } from './components/Panels/InfoPanel';
import { PlansPanel } from './components/Panels/PlansPanel';
import { Viewer3D } from './components/Viewer3D/Viewer3D';
import { usePlan } from './state/store';
import { savePlan } from './lib/storage';
import { exportPNG, exportPDF } from './lib/export';

type LeftTab = 'furniture' | 'plans';

const TABS: { id: LeftTab; label: string; icon: string }[] = [
  { id: 'furniture', label: 'Palette',   icon: '⬡' },
  { id: 'plans',     label: 'Plans',     icon: '▤' },
];

function LeftSidebar() {
  const [tab, setTab] = useState<LeftTab>('furniture');

  return (
    <div className="flex w-56 flex-none flex-col" style={{ background: '#0f172a' }}>
      {/* Tab strip */}
      <div className="flex border-b border-white/5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.label}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
              tab === t.id
                ? 'border-b-2 border-indigo-400 text-indigo-400'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'furniture' && <FurniturePalette />}
        {tab === 'plans'     && <PlansPanel />}
      </div>
    </div>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M2 2a2 2 0 0 1 2-2h8l2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm3-10H5v3h5V2z"/>
    </svg>
  );
}
function PNGIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
      <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>
    </svg>
  );
}
function PDFIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zM9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3z"/>
    </svg>
  );
}

function AppShell() {
  const { plan } = usePlan();
  const [view, setView]           = useState<'2d' | '3d'>('2d');
  const [saveLabel, setSaveLabel] = useState<'Save' | 'Saved!'>('Save');
  const [exporting, setExporting] = useState(false);

  function handleSave() {
    savePlan(plan);
    setSaveLabel('Saved!');
    setTimeout(() => setSaveLabel('Save'), 1600);
  }

  async function handleExportPDF() {
    setExporting(true);
    await exportPDF(plan.name);
    setExporting(false);
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="flex flex-none items-center gap-3 px-4 py-2.5"
        style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', borderBottom: '1px solid rgba(99,102,241,0.2)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 shadow-lg shadow-indigo-500/30">
            <svg viewBox="0 0 20 20" fill="white" className="h-4 w-4">
              <path d="M10.707 2.293a1 1 0 0 0-1.414 0l-7 7a1 1 0 0 0 1.414 1.414L4 10.414V17a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1v-6.586l.293.293a1 1 0 0 0 1.414-1.414l-7-7z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">HomeMaker</h1>
            <p className="text-[10px] text-indigo-300 leading-none mt-0.5">2D → 3D Floor Plan Editor</p>
          </div>
        </div>

        {/* Plan name */}
        <div className="mx-2 h-5 w-px bg-white/10" />
        <span className="max-w-[160px] truncate rounded-md bg-white/5 px-2 py-1 text-xs text-slate-300 border border-white/10">
          {plan.name}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Action buttons */}
          <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white active:scale-95">
            <SaveIcon />
            <span className={saveLabel === 'Saved!' ? 'text-green-400' : ''}>{saveLabel}</span>
          </button>
          <button onClick={() => exportPNG(plan.name)} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white active:scale-95">
            <PNGIcon /> PNG
          </button>
          <button onClick={handleExportPDF} disabled={exporting} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-40">
            <PDFIcon /> {exporting ? 'Exporting…' : 'PDF'}
          </button>

          <div className="h-5 w-px bg-white/10" />

          {/* 2D / 3D toggle */}
          <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs font-semibold">
            {(['2d', '3d'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 transition-all ${
                  view === v
                    ? 'bg-indigo-600 text-white shadow shadow-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      {view === '2d' && <Toolbar />}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {view === '2d' && <LeftSidebar />}
        <main className="relative min-w-0 flex-1 bg-white">
          {view === '2d' ? <CanvasStage /> : <Viewer3D />}
        </main>
        <div className="flex min-h-0 w-56 flex-none flex-col" style={{ background: '#0f172a', borderLeft: '1px solid #1e293b' }}>
          <InfoPanel />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
