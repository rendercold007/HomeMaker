/**
 * InfoPanel — read-only summary of the current plan: detected rooms with areas
 * and the active selection. A fuller properties/dimensions editor comes later;
 * this gives immediate feedback that room detection and selection work.
 */
import { usePlan } from '../../state/PlanContext';
import { useSelection } from '../../state/SelectionContext';
import { formatArea, formatLength } from '../../lib/units';
import { distance } from '../../model/geometry';

export function InfoPanel() {
  const { plan } = usePlan();
  const { selection } = useSelection();
  const floor = plan.floors[0]!;

  const selectedWall =
    selection?.kind === 'wall'
      ? floor.walls.find((w) => w.id === selection.id)
      : undefined;
  const wallLength = selectedWall
    ? (() => {
        const a = floor.points.find((p) => p.id === selectedWall.a);
        const b = floor.points.find((p) => p.id === selectedWall.b);
        return a && b ? distance(a, b) : 0;
      })()
    : 0;

  return (
    <aside className="flex h-full w-64 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3 text-sm">
      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Plan</h2>
        <dl className="space-y-0.5 text-slate-600">
          <div className="flex justify-between">
            <dt>Points</dt>
            <dd>{floor.points.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Walls</dt>
            <dd>{floor.walls.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Rooms</dt>
            <dd>{floor.rooms.length}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Rooms</h2>
        {floor.rooms.length === 0 ? (
          <p className="text-slate-400">
            None yet — draw a closed loop of walls.
          </p>
        ) : (
          <ul className="space-y-1">
            {floor.rooms.map((r) => (
              <li
                key={r.id}
                className="flex justify-between rounded bg-white px-2 py-1 text-slate-600"
              >
                <span>{r.name}</span>
                <span>{formatArea(r.areaCm2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-slate-700">Selection</h2>
        {!selection ? (
          <p className="text-slate-400">Nothing selected.</p>
        ) : selection.kind === 'wall' ? (
          <p className="text-slate-600">
            Wall · {formatLength(wallLength)}
            {selectedWall ? ` · ${selectedWall.thickness}cm thick` : ''}
          </p>
        ) : (
          <p className="text-slate-600">Point · drag to move, Del to remove</p>
        )}
      </section>
    </aside>
  );
}
