/**
 * FloorControls — switch the active floor, add a floor above, or delete the
 * current one. 2D editing targets the active floor; the 3D view shows all
 * floors stacked.
 */
import { usePlan, useActiveFloor } from '../../state/store';
import { addFloor, deleteFloor } from '../../model/planEdits';

function floorLabel(level: number): string {
  if (level === 0) return 'G';
  if (level < 0) return `B${-level}`;
  return String(level);
}

export function FloorControls() {
  const { plan, commit } = usePlan();
  const { activeFloorId, setActiveFloor } = useActiveFloor();

  const floors = [...plan.floors].sort((a, b) => a.level - b.level);

  function handleAdd() {
    const r = addFloor(plan);
    commit(r.plan);
    setActiveFloor(r.floorId);
  }

  function handleDelete() {
    if (plan.floors.length <= 1) return;
    const remaining = plan.floors.filter((f) => f.id !== activeFloorId);
    commit(deleteFloor(plan, activeFloorId));
    if (remaining.length > 0) setActiveFloor(remaining[remaining.length - 1]!.id);
  }

  return (
    <div className="flex items-center gap-1">
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Floor</span>
      <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
        {floors.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFloor(f.id)}
            title={`Floor ${floorLabel(f.level)}`}
            className={`min-w-[22px] rounded-md px-2 py-1 text-xs font-semibold transition-all ${
              f.id === activeFloorId
                ? 'bg-zinc-700 text-white shadow shadow-black/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {floorLabel(f.level)}
          </button>
        ))}
      </div>
      <button
        onClick={handleAdd}
        title="Add floor above"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white active:scale-95"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
        </svg>
      </button>
      <button
        onClick={handleDelete}
        disabled={plan.floors.length <= 1}
        title="Delete current floor"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-red-400 active:scale-95 disabled:opacity-30 disabled:hover:text-slate-400"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0H11z"/>
        </svg>
      </button>
    </div>
  );
}
