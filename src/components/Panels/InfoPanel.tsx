import { useEffect, useState } from 'react';
import { usePlan, useSelection, useActiveFloor } from '../../state/store';
import { formatArea, formatLength } from '../../lib/units';
import { distance } from '../../model/geometry';
import { getFurnitureDef } from '../../model/furniture';
import { setRoomName, setRoomType } from '../../model/planEdits';
import { ROOM_TYPES, roomTypeColor } from '../../model/roomTypes';
import type { ID, Room, RoomType } from '../../model/types';

function RoomEditor({ room, floorId }: { room: Room; floorId: ID }) {
  const { plan, commit } = usePlan();
  const [name, setName] = useState(room.name);
  // Resync the draft when a different room is selected, or after undo/redo.
  useEffect(() => setName(room.name), [room.id, room.name]);

  const commitName = () => {
    const v = name.trim() || 'Room';
    if (v !== room.name) commit(setRoomName(plan, floorId, room.id, v));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-indigo-400">Room</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="Room name"
        className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
      />
      <select
        value={room.type}
        onChange={(e) => commit(setRoomType(plan, floorId, room.id, e.target.value as RoomType))}
        className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
      >
        {ROOM_TYPES.map((t) => (
          <option key={t.type} value={t.type} className="bg-slate-900">{t.label}</option>
        ))}
      </select>
      <p className="text-[10px] text-slate-600">{formatArea(room.areaCm2)}</p>
    </div>
  );
}

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
  const { selection, select } = useSelection();
  const { activeFloorId } = useActiveFloor();
  const floor = plan.floors.find((f) => f.id === activeFloorId) ?? plan.floors[0]!;

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
    if (selection.kind === 'room') {
      const room = floor.rooms.find((r) => r.id === selection.id);
      if (room) return <RoomEditor key={room.id} room={room} floorId={floor.id} />;
    }
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
            {floor.rooms.map((r) => {
              const isSel = selection?.kind === 'room' && selection.id === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => select({ kind: 'room', id: r.id })}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${isSel ? 'ring-1 ring-indigo-500/50' : 'hover:bg-white/5'}`}
                    style={{ background: isSel ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.04)' }}
                  >
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: roomTypeColor(r.type) }} />
                    <span className="flex-1 truncate text-xs text-slate-300">{r.name}</span>
                    <span className="text-[10px] font-medium text-slate-500">{formatArea(r.areaCm2)}</span>
                  </button>
                </li>
              );
            })}
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
