/**
 * Adapter: fold a generated multi-room plan into the active Floor.
 *
 * Same architectural rule as the furniture adapter (CLAUDE.md → "The AI
 * backend"): the backend result re-enters through the store as ONE commit, so
 * the whole generated home is a single undo step and 2D/3D render from it.
 *
 * The payload is already in centimetres (the model's unit), so we drop its
 * points/walls/openings straight in and replace the active floor's geometry.
 * Rooms are then DERIVED by the existing cycle detector (recomputeRooms), and
 * we name each detected room by matching its centroid to the generator's room
 * metadata.
 */
import type { ID, Opening, Plan, Point, RoomType, Wall, Furniture } from '../../model/types';
import { recomputeRooms } from '../../model/planEdits';
import { newId as defaultNewId } from '../../model/ids';
import type { GeneratedPlan, GenRoomMeta } from './contract';

const ROOM_TYPES: readonly RoomType[] = [
  'living', 'bedroom', 'kitchen', 'bathroom', 'dining',
  'study', 'utility', 'pooja', 'parking', 'other',
];

export function asRoomType(t: string): RoomType {
  return (ROOM_TYPES as readonly string[]).includes(t) ? (t as RoomType) : 'other';
}

export function applyGeneratedPlan(
  plan: Plan,
  floorId: ID,
  payload: GeneratedPlan,
  newId: () => ID = defaultNewId,
): Plan {
  const g = payload.plan;

  const points: Point[] = g.points.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const walls: Wall[] = g.walls.map((w) => ({
    id: w.id, a: w.a, b: w.b, thickness: w.thickness, height: w.height,
  }));
  const openings: Opening[] = g.openings.map((o) => ({
    id: o.id, wallId: o.wallId, kind: o.kind, offset: o.offset, width: o.width,
  }));
  const furniture: Furniture[] = g.furniture.map((f) => ({
    id: newId(), type: f.type, x: f.x, y: f.y, rotationDeg: f.rotationDeg,
  }));

  // Replace the active floor's geometry, then derive rooms from the wall graph.
  const replaced: Plan = {
    ...plan,
    floors: plan.floors.map((fl) =>
      fl.id === floorId ? { ...fl, points, walls, openings, furniture, rooms: [] } : fl,
    ),
  };
  const named = nameRooms(recomputeRooms(replaced), floorId, g.rooms);
  return assignFurnitureRooms(named, floorId, g.furniture);
}

/** Squared distance between two points (cheap; we only compare). */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/** Mean position of a derived room's corner points. null if it has none. */
function roomCentroid(
  room: Plan['floors'][number]['rooms'][number],
  pointById: Map<ID, Point>,
  wallById: Map<ID, Wall>,
): { cx: number; cy: number } | null {
  const ptIds = new Set<ID>();
  for (const wid of room.wallIds) {
    const w = wallById.get(wid);
    if (w) { ptIds.add(w.a); ptIds.add(w.b); }
  }
  let cx = 0, cy = 0, n = 0;
  for (const pid of ptIds) {
    const p = pointById.get(pid);
    if (p) { cx += p.x; cy += p.y; n++; }
  }
  return n === 0 ? null : { cx: cx / n, cy: cy / n };
}

/**
 * Resolve each generated item's room centroid (roomCx/roomCy from the worker) to
 * the id of the nearest DERIVED room, so furniture carries a roomId. Items without
 * a centroid hint (or when no room matches) are left unassigned — roomId stays
 * undefined, which is valid per the model.
 */
function assignFurnitureRooms(plan: Plan, floorId: ID, gen: GeneratedPlan['plan']['furniture']): Plan {
  const floor = plan.floors.find((f) => f.id === floorId);
  if (!floor || floor.rooms.length === 0) return plan;

  const pointById = new Map(floor.points.map((p) => [p.id, p]));
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  const roomCentroids = floor.rooms
    .map((room) => ({ id: room.id, c: roomCentroid(room, pointById, wallById) }))
    .filter((r): r is { id: ID; c: { cx: number; cy: number } } => r.c !== null);
  if (roomCentroids.length === 0) return plan;

  const furniture = floor.furniture.map((item, i) => {
    const hint = gen[i];
    if (!hint || hint.roomCx === undefined || hint.roomCy === undefined) return item;
    let bestId: ID | undefined;
    let bestDist = Infinity;
    for (const { id, c } of roomCentroids) {
      const d = dist2(hint.roomCx, hint.roomCy, c.cx, c.cy);
      if (d < bestDist) { bestDist = d; bestId = id; }
    }
    return bestId === undefined ? item : { ...item, roomId: bestId };
  });

  return { ...plan, floors: plan.floors.map((f) => (f.id === floorId ? { ...f, furniture } : f)) };
}

/**
 * Assign each derived room the name/type of the nearest generator room metadata.
 *
 * Greedy nearest-match that CONSUMES each meta once: we score every
 * (room, meta) centroid pair, then award matches in ascending distance order,
 * removing both the room and the meta from the pool as we go. This prevents two
 * rooms from claiming the same meta (the bug a naive per-room argmin would have).
 */
function nameRooms(plan: Plan, floorId: ID, metas: GenRoomMeta[]): Plan {
  if (metas.length === 0) return plan;
  const floor = plan.floors.find((f) => f.id === floorId);
  if (!floor) return plan;

  const pointById = new Map(floor.points.map((p) => [p.id, p]));
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));

  // Centroid per room (indexed alongside floor.rooms). null = could not compute.
  const centroids = floor.rooms.map((room) => roomCentroid(room, pointById, wallById));

  // Score every (room, meta) pair, then award by ascending distance, consuming
  // each room and each meta at most once.
  const pairs: { roomIdx: number; metaIdx: number; dist: number }[] = [];
  centroids.forEach((c, roomIdx) => {
    if (!c) return;
    metas.forEach((m, metaIdx) => {
      pairs.push({ roomIdx, metaIdx, dist: dist2(m.cx, m.cy, c.cx, c.cy) });
    });
  });
  pairs.sort((p, q) => p.dist - q.dist);

  const metaForRoom = new Map<number, GenRoomMeta>();
  const usedRooms = new Set<number>();
  const usedMetas = new Set<number>();
  for (const { roomIdx, metaIdx } of pairs) {
    if (usedRooms.has(roomIdx) || usedMetas.has(metaIdx)) continue;
    metaForRoom.set(roomIdx, metas[metaIdx]!);
    usedRooms.add(roomIdx);
    usedMetas.add(metaIdx);
  }

  const rooms = floor.rooms.map((room, roomIdx) => {
    const meta = metaForRoom.get(roomIdx);
    if (!meta) return room; // n === 0 room, or more rooms than metas
    return { ...room, name: meta.name, type: asRoomType(meta.type) };
  });

  return { ...plan, floors: plan.floors.map((f) => (f.id === floorId ? { ...f, rooms } : f)) };
}
