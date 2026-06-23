import { usePlan, useSelection } from '../../state/store';
import { formatArea, formatLength } from '../../lib/units';
import { distance } from '../../model/geometry';
import { getFurnitureDef } from '../../model/furniture';

const DOT_COLORS = ['#818cf8','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#38bdf8','#4ade80'];

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-300">{value}</span>
    </div>
  );
}

export function InfoPanel() {
  const { plan } = usePlan();
  const { selection } = useSelection();
  const floor = plan.floors[0]!;

  const selectedWall =
    selection?.kind === 'wall' ? floor.walls.find((w) => w.id === selection.id) : undefined;
  const wallLength = selectedWall
    ? (() => {
        const a = floor.points.find((p) => p.id === selectedWall.a);
        const b = floor.points.find((p) => p.id === selectedWall.b);
        return a && b ? distance(a, b) : 0;
      })()
    : 0;
  const selectedOpening =
    selection?.kind === 'opening' ? floor.openings.find((o) => o.id === selection.id) : undefined;
  const selectedFurniture =
    selection?.kind === 'furniture' ? floor.furniture.find((f) => f.id === selection.id) : undefined;

  function selectionContent() {
    if (!selection) return <p className="text-xs text-slate-600 italic">Click to select an element</p>;
    if (selection.kind === 'wall' && selectedWall) return (
      <div className="space-y-0.5">
        <p className="text-xs font-semibold text-indigo-400">Wall segment</p>
        <p className="text-xs text-slate-400">{formatLength(wallLength)} · {selectedWall.thickness}cm thick</p>
        <p className="text-[10px] text-slate-600 mt-1">Del to delete</p>
      </div>
    );
    if (selection.kind === 'point') return (
      <div>
        <p className="text-xs font-semibold text-indigo-400">Vertex</p>
        <p className="text-[10px] text-slate-600 mt-1">Drag to move · Del to remove</p>
      </div>
    );
    if (selection.kind === 'opening' && selectedOpening) return (
      <div>
        <p className="text-xs font-semibold text-indigo-400">{selectedOpening.kind === 'door' ? '🚪 Door' : '🪟 Window'}</p>
        <p className="text-xs text-slate-400">{formatLength(selectedOpening.width)} wide</p>
        <p className="text-[10px] text-slate-600 mt-1">Del to delete</p>
      </div>
    );
    if (selection.kind === 'furniture' && selectedFurniture) {
      const def = getFurnitureDef(selectedFurniture.type);
      return (
        <div>
          <p className="text-xs font-semibold text-indigo-400">{def?.label ?? selectedFurniture.type}</p>
          <p className="text-xs text-slate-400">{selectedFurniture.rotationDeg}° rotation</p>
          <p className="text-[10px] text-slate-600 mt-1">Drag · R rotate · Del remove</p>
        </div>
      );
    }
    return null;
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      {/* Stats */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Plan Stats</p>
        <div className="rounded-xl border border-white/5 px-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <StatRow label="Walls"     value={floor.walls.length} />
          <StatRow label="Openings"  value={floor.openings.length} />
          <StatRow label="Rooms"     value={floor.rooms.length} />
          <StatRow label="Furniture" value={floor.furniture.length} />
        </div>
      </section>

      {/* Rooms */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Rooms</p>
        {floor.rooms.length === 0 ? (
          <p className="text-xs italic text-slate-600">Draw a closed wall loop</p>
        ) : (
          <ul className="space-y-1">
            {floor.rooms.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: DOT_COLORS[i % DOT_COLORS.length] }} />
                <span className="flex-1 truncate text-xs text-slate-300">{r.name}</span>
                <span className="text-[10px] font-medium text-slate-500">{formatArea(r.areaCm2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Selection */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Selection</p>
        <div className="rounded-xl border border-white/5 px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {selectionContent()}
        </div>
      </section>
    </aside>
  );
}
