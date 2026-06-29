import { usePlan, useTool, type Tool } from '../../state/store';
import { FloorControls } from './FloorControls';

const TOOLS: { id: Tool; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'select', label: 'Select', hint: 'V',
    icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"/></svg>,
  },
  {
    id: 'wall', label: 'Wall', hint: 'W',
    icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm6 0v6H2v1h4v6h1V9h2v6h1V9h4V8h-4V2H7zm1 0v6h2V2H7z"/></svg>,
  },
  {
    id: 'door', label: 'Door', hint: 'D',
    icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M3 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V2zm6 11a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>,
  },
  {
    id: 'window', label: 'Window', hint: 'N',
    icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M2 1.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V2a.5.5 0 0 0-.5-.5H2zM1 2a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2z"/><path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1"/></svg>,
  },
  {
    id: 'furniture', label: 'Furnish', hint: 'F',
    icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path d="M2 1a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1v1h1v-1h8v1h1v-1h1a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm0 2h12v6H2V3zm0 8h12v2H2v-2z"/></svg>,
  },
];

function ToolBtn({ active, disabled, onClick, title, children }: {
  active?: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
        active
          ? 'bg-zinc-700 text-white shadow-sm shadow-black/40'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      } ${disabled ? 'cursor-not-allowed opacity-30' : ''}`}
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const { tool, setTool, grid, setGrid } = useTool();
  const { undo, redo, canUndo, canRedo } = usePlan();

  return (
    <div
      className="flex flex-none items-center gap-1 px-3 py-1.5"
      style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}
    >
      {/* Tool buttons */}
      {TOOLS.map((t) => (
        <ToolBtn key={t.id} active={tool === t.id} onClick={() => setTool(t.id)} title={`${t.label} (${t.hint})`}>
          {t.icon}
          <span>{t.label}</span>
        </ToolBtn>
      ))}

      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Undo / Redo */}
      <ToolBtn onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
        </svg>
        Undo
      </ToolBtn>
      <ToolBtn onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" style={{ transform: 'scaleX(-1)' }}>
          <path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
        </svg>
        Redo
      </ToolBtn>

      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Grid controls */}
      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-white/5">
        <input
          type="checkbox"
          checked={grid.visible}
          onChange={(e) => setGrid({ visible: e.target.checked })}
          className="accent-zinc-500"
        />
        Grid
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-white/5">
        <input
          type="checkbox"
          checked={grid.snap}
          onChange={(e) => setGrid({ snap: e.target.checked })}
          className="accent-zinc-500"
        />
        Snap
      </label>
      <select
        value={grid.sizeCm}
        onChange={(e) => setGrid({ sizeCm: Number(e.target.value) })}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-zinc-500"
      >
        {[15, 30, 50, 100].map((s) => (
          <option key={s} value={s} className="bg-slate-900">{s} cm</option>
        ))}
      </select>

      {/* Floor switcher */}
      <div className="ml-auto flex items-center gap-1">
        <div className="h-5 w-px bg-white/10" />
        <FloorControls />
      </div>
    </div>
  );
}
