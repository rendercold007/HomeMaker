/**
 * Toolbar — tool selection, grid controls, and undo/redo.
 *
 * Reads ToolContext + PlanContext only. Kept out of the canvas render path so
 * toggling a tool doesn't re-render geometry.
 */
import { usePlan } from '../../state/PlanContext';
import { useTool, type Tool } from '../../state/ToolContext';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select',    label: 'Select', hint: 'V — select, drag, delete' },
  { id: 'wall',      label: 'Wall',   hint: 'W — draw walls' },
  { id: 'door',      label: 'Door',   hint: 'D — click a wall to place door' },
  { id: 'window',    label: 'Window', hint: 'N — click a wall to place window' },
  { id: 'furniture', label: 'Furnish',hint: 'F — pick item in palette, click to place' },
];

function Button({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'rounded px-3 py-1.5 text-sm font-medium transition',
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white text-slate-700 hover:bg-slate-100',
        disabled ? 'cursor-not-allowed opacity-40 hover:bg-white' : '',
        'border border-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const { tool, setTool, grid, setGrid } = useTool();
  const { undo, redo, canUndo, canRedo } = usePlan();

  return (
    <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <Button
            key={t.id}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
            title={t.hint}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="h-5 w-px bg-slate-300" />

      <div className="flex items-center gap-1">
        <Button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </Button>
        <Button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </Button>
      </div>

      <div className="h-5 w-px bg-slate-300" />

      <div className="flex items-center gap-3 text-sm text-slate-600">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={grid.visible}
            onChange={(e) => setGrid({ visible: e.target.checked })}
          />
          Grid
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={grid.snap}
            onChange={(e) => setGrid({ snap: e.target.checked })}
          />
          Snap
        </label>
        <label className="flex items-center gap-1.5">
          Size
          <select
            value={grid.sizeCm}
            onChange={(e) => setGrid({ sizeCm: Number(e.target.value) })}
            className="rounded border border-slate-200 bg-white px-1 py-0.5"
          >
            {[15, 30, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s} cm
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
