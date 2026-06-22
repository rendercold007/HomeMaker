/**
 * InfoPanel — plan summary and selection details.
 *
 * Shows room count/areas, selection properties for walls, points, openings,
 * and furniture. A fuller properties editor is deferred to a later phase.
 */
import { usePlan } from '../../state/PlanContext';
import { useSelection } from '../../state/SelectionContext';
import { formatArea, formatLength } from '../../lib/units';
import { distance } from '../../model/geometry';
import { getFurnitureDef } from '../../model/furniture';

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

  function selectionInfo() {
    if (!selection) return <p className="text-slate-400">Nothing selected.</p>;

    if (selection.kind === 'wall' && selectedWall) {
      return (
        <p className="text-slate-600">
          Wall · {formatLength(wallLength)} · {selectedWall.thickness}cm thick
          <br />
          <span className="text-xs text-slate-400">Del to delete</span>
        </p>
      );
    }
    if (selection.kind === 'point') {
      return (
        <p className="text-slate-600">
          Vertex
          <br />
          <span className="text-xs text-slate-400">Drag to move · Del to remove</span>
        </p>
      );
    }
    if (selection.kind === 'opening' && selectedOpening) {
      const kind = selectedOpening.kind === 'door' ? 'Door' : 'Window';
      return (
        <p className="text-slate-600">
          {kind} · {formatLength(selectedOpening.width)} wide
          <br />
          <span className="text-xs text-slate-400">Del to delete</span>
        </p>
      );
    }
    if (selection.kind === 'furniture' && selectedFurniture) {
      const def = getFurnitureDef(selectedFurniture.type);
      return (
        <p className="text-slate-600">
          {def?.label ?? selectedFurniture.type}
          {selectedFurniture.rotationDeg !== 0 && ` · ${selectedFurniture.rotationDeg}°`}
          <br />
          <span className="text-xs text-slate-400">Drag to move · R to rotate · Del to remove</span>
        </p>
      );
    }
    return <p className="text-slate-400">Nothing selected.</p>;
  }

  return (
    <aside className="flex h-full w-56 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3 text-sm">
      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Plan</h2>
        <dl className="space-y-0.5 text-slate-600">
          <div className="flex justify-between">
            <dt>Walls</dt><dd>{floor.walls.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Openings</dt><dd>{floor.openings.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Rooms</dt><dd>{floor.rooms.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Furniture</dt><dd>{floor.furniture.length}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Rooms</h2>
        {floor.rooms.length === 0 ? (
          <p className="text-slate-400">None yet — draw a closed loop of walls.</p>
        ) : (
          <ul className="space-y-1">
            {floor.rooms.map((r) => (
              <li key={r.id} className="flex justify-between rounded bg-white px-2 py-1 text-slate-600">
                <span>{r.name}</span>
                <span>{formatArea(r.areaCm2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Selection</h2>
        {selectionInfo()}
      </section>
    </aside>
  );
}
