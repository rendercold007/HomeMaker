/**
 * Pure, immutable edits to a Plan. NO React imports.
 *
 * Every function returns a NEW Plan (the input is never mutated), which is what
 * makes undo/redo a simple stack of snapshots. Rooms are kept in sync by
 * `recomputeRooms`, since rooms are derived from the wall graph.
 *
 * These operate on a single "active" floor identified by id; the rest of the
 * plan is passed through untouched.
 */
import type { Floor, Furniture, ID, Opening, Plan, Point, Room, RoomType } from './types';
import { detectRooms } from './roomDetect';
import { newId as defaultNewId } from './ids';

type IdGen = () => ID;

/** Default thickness for newly drawn walls, in cm. */
export const DEFAULT_WALL_THICKNESS = 10;

/** Default height for newly drawn walls, in cm (used by the 3D view). */
export const DEFAULT_WALL_HEIGHT = 270;

/** Replace one floor in the plan, returning a new plan. */
function withFloor(plan: Plan, floorId: ID, next: Floor): Plan {
  return {
    ...plan,
    floors: plan.floors.map((f) => (f.id === floorId ? next : f)),
  };
}

function getFloor(plan: Plan, floorId: ID): Floor {
  const f = plan.floors.find((fl) => fl.id === floorId);
  if (!f) throw new Error(`Floor not found: ${floorId}`);
  return f;
}

/**
 * Carry user-authored `name`/`type` from the previous rooms onto freshly
 * detected ones. A room's id is its sorted wall set, so an unchanged boundary
 * (e.g. dragging a vertex) matches exactly; when walls are added/removed we fall
 * back to the previous room that shares the most boundary walls.
 */
function carryRoomMeta(oldRooms: readonly Room[], newRooms: Room[]): Room[] {
  if (oldRooms.length === 0) return newRooms;
  const oldById = new Map(oldRooms.map((r) => [r.id, r]));
  return newRooms.map((room) => {
    const exact = oldById.get(room.id);
    if (exact) return { ...room, name: exact.name, type: exact.type };

    const wallSet = new Set(room.wallIds);
    let best: Room | undefined;
    let bestShared = 0;
    for (const old of oldRooms) {
      let shared = 0;
      for (const wid of old.wallIds) if (wallSet.has(wid)) shared++;
      if (shared > bestShared) {
        bestShared = shared;
        best = old;
      }
    }
    return best && bestShared > 0 ? { ...room, name: best.name, type: best.type } : room;
  });
}

/** Recompute derived rooms for every floor. Call after any wall-graph change. */
export function recomputeRooms(plan: Plan): Plan {
  return {
    ...plan,
    floors: plan.floors.map((f) => ({
      ...f,
      rooms: carryRoomMeta(f.rooms, detectRooms(f.points, f.walls)),
    })),
  };
}

/** Set a room's display name. Does not recompute geometry. */
export function setRoomName(plan: Plan, floorId: ID, roomId: ID, name: string): Plan {
  const floor = getFloor(plan, floorId);
  const rooms = floor.rooms.map((r) => (r.id === roomId ? { ...r, name } : r));
  return withFloor(plan, floorId, { ...floor, rooms });
}

/** Set a room's functional type (drives 3D floor color). */
export function setRoomType(plan: Plan, floorId: ID, roomId: ID, type: RoomType): Plan {
  const floor = getFloor(plan, floorId);
  const rooms = floor.rooms.map((r) => (r.id === roomId ? { ...r, type } : r));
  return withFloor(plan, floorId, { ...floor, rooms });
}

/** Add a point to a floor. Returns the new plan and the created point id. */
export function addPoint(
  plan: Plan,
  floorId: ID,
  x: number,
  y: number,
  newId: IdGen = defaultNewId,
): { plan: Plan; pointId: ID } {
  const floor = getFloor(plan, floorId);
  const point: Point = { id: newId(), x, y };
  const next: Floor = { ...floor, points: [...floor.points, point] };
  return { plan: withFloor(plan, floorId, next), pointId: point.id };
}

/**
 * Add a wall between two existing points. No-op (returns input) if the wall is
 * degenerate (a === b) or a wall already connects the same pair.
 */
export function addWall(
  plan: Plan,
  floorId: ID,
  a: ID,
  b: ID,
  thickness = DEFAULT_WALL_THICKNESS,
  newId: IdGen = defaultNewId,
  height = DEFAULT_WALL_HEIGHT,
): Plan {
  if (a === b) return plan;
  const floor = getFloor(plan, floorId);
  const exists = floor.walls.some(
    (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
  );
  if (exists) return plan;
  const next: Floor = {
    ...floor,
    walls: [...floor.walls, { id: newId(), a, b, thickness, height }],
  };
  return recomputeRooms(withFloor(plan, floorId, next));
}

/**
 * Draw a wall in one call: resolve the start and end coordinates to existing
 * points when given, or create new points, then connect them. Returns the new
 * plan plus the resolved endpoint ids (useful for chaining segments).
 */
export function drawWall(
  plan: Plan,
  floorId: ID,
  start: { id?: ID; x: number; y: number },
  end: { id?: ID; x: number; y: number },
  thickness = DEFAULT_WALL_THICKNESS,
  newId: IdGen = defaultNewId,
): { plan: Plan; startId: ID; endId: ID } {
  let working = plan;
  let startId = start.id;
  if (!startId) {
    const r = addPoint(working, floorId, start.x, start.y, newId);
    working = r.plan;
    startId = r.pointId;
  }
  let endId = end.id;
  if (!endId) {
    const r = addPoint(working, floorId, end.x, end.y, newId);
    working = r.plan;
    endId = r.pointId;
  }
  working = addWall(working, floorId, startId, endId, thickness, newId);
  return { plan: working, startId, endId };
}

/** Move a point to a new position (e.g. dragging a vertex). */
export function movePoint(
  plan: Plan,
  floorId: ID,
  pointId: ID,
  x: number,
  y: number,
): Plan {
  const floor = getFloor(plan, floorId);
  const next: Floor = {
    ...floor,
    points: floor.points.map((p) => (p.id === pointId ? { ...p, x, y } : p)),
  };
  // Moving a vertex can open or close rooms → recompute.
  return recomputeRooms(withFloor(plan, floorId, next));
}

/** Remove any points that no longer belong to a wall. */
function dropOrphanPoints(floor: Floor): Floor {
  const used = new Set<ID>();
  for (const w of floor.walls) {
    used.add(w.a);
    used.add(w.b);
  }
  const points = floor.points.filter((p) => used.has(p.id));
  if (points.length === floor.points.length) return floor;
  return { ...floor, points };
}

/** Delete a wall (and its openings, and any points it orphaned). */
export function deleteWall(plan: Plan, floorId: ID, wallId: ID): Plan {
  const floor = getFloor(plan, floorId);
  const walls = floor.walls.filter((w) => w.id !== wallId);
  if (walls.length === floor.walls.length) return plan;
  const openings = floor.openings.filter((o) => o.wallId !== wallId);
  const next = dropOrphanPoints({ ...floor, walls, openings });
  return recomputeRooms(withFloor(plan, floorId, next));
}

/** Delete a point and every wall (and opening) attached to it. */
export function deletePoint(plan: Plan, floorId: ID, pointId: ID): Plan {
  const floor = getFloor(plan, floorId);
  if (!floor.points.some((p) => p.id === pointId)) return plan;
  const removedWallIds = new Set(
    floor.walls.filter((w) => w.a === pointId || w.b === pointId).map((w) => w.id),
  );
  const walls = floor.walls.filter((w) => !removedWallIds.has(w.id));
  const openings = floor.openings.filter((o) => !removedWallIds.has(o.wallId));
  const points = floor.points.filter((p) => p.id !== pointId);
  const next = dropOrphanPoints({ ...floor, walls, openings, points });
  return recomputeRooms(withFloor(plan, floorId, next));
}

/** Default widths for new openings, in cm. */
export const DEFAULT_DOOR_WIDTH = 90;
export const DEFAULT_WINDOW_WIDTH = 120;

/**
 * Add a door or window opening to a wall. The model enforces its own invariants
 * rather than trusting the caller: the opening must reference a real wall, have
 * positive width that fits the wall (minus end margins), and not overlap an
 * existing opening. The `offset` is clamped so the whole opening stays on the
 * wall, clear of the mitered ends.
 *
 * On a rejected opening the plan is returned unchanged and `openingId` is `''`.
 */
export function addOpening(
  plan: Plan,
  floorId: ID,
  opening: Omit<Opening, 'id'>,
  newId: IdGen = defaultNewId,
): { plan: Plan; openingId: ID } {
  const floor = getFloor(plan, floorId);

  const wall = floor.walls.find((w) => w.id === opening.wallId);
  if (!wall) return { plan, openingId: '' };
  const pa = floor.points.find((p) => p.id === wall.a);
  const pb = floor.points.find((p) => p.id === wall.b);
  if (!pa || !pb) return { plan, openingId: '' };

  const wallLen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const margin = wall.thickness / 2;
  const maxWidth = wallLen - margin * 2;

  // Width must be positive and physically fit within the wall.
  if (opening.width <= 0 || maxWidth <= 0 || opening.width > maxWidth) {
    return { plan, openingId: '' };
  }

  // Keep the whole span on the wall, clear of the (mitered) ends.
  const offset = Math.max(
    margin,
    Math.min(wallLen - opening.width - margin, opening.offset),
  );

  // Reject overlaps with existing openings on the same wall.
  const overlaps = floor.openings.some(
    (o) =>
      o.wallId === opening.wallId &&
      offset < o.offset + o.width &&
      o.offset < offset + opening.width,
  );
  if (overlaps) return { plan, openingId: '' };

  const id = newId();
  const full: Opening = { id, ...opening, offset };
  const next: Floor = { ...floor, openings: [...floor.openings, full] };
  return { plan: withFloor(plan, floorId, next), openingId: id };
}

/** Remove an opening by id. */
export function deleteOpening(plan: Plan, floorId: ID, openingId: ID): Plan {
  const floor = getFloor(plan, floorId);
  const openings = floor.openings.filter((o) => o.id !== openingId);
  if (openings.length === floor.openings.length) return plan;
  return withFloor(plan, floorId, { ...floor, openings });
}

/** Place a furniture item on the floor. Returns the new plan and the furniture id. */
export function addFurniture(
  plan: Plan,
  floorId: ID,
  item: Omit<Furniture, 'id'>,
  newId: IdGen = defaultNewId,
): { plan: Plan; furnitureId: ID } {
  const floor = getFloor(plan, floorId);
  const id = newId();
  const full: Furniture = { id, ...item };
  const next: Floor = { ...floor, furniture: [...floor.furniture, full] };
  return { plan: withFloor(plan, floorId, next), furnitureId: id };
}

/** Move a placed furniture item. */
export function moveFurniture(
  plan: Plan,
  floorId: ID,
  furnitureId: ID,
  x: number,
  y: number,
): Plan {
  const floor = getFloor(plan, floorId);
  const furniture = floor.furniture.map((f) =>
    f.id === furnitureId ? { ...f, x, y } : f,
  );
  return withFloor(plan, floorId, { ...floor, furniture });
}

/** Rotate a placed furniture item (degrees, clockwise). */
export function rotateFurniture(
  plan: Plan,
  floorId: ID,
  furnitureId: ID,
  rotationDeg: number,
): Plan {
  const floor = getFloor(plan, floorId);
  const furniture = floor.furniture.map((f) =>
    f.id === furnitureId ? { ...f, rotationDeg } : f,
  );
  return withFloor(plan, floorId, { ...floor, furniture });
}

/** Remove a furniture item. */
export function deleteFurniture(plan: Plan, floorId: ID, furnitureId: ID): Plan {
  const floor = getFloor(plan, floorId);
  const furniture = floor.furniture.filter((f) => f.id !== furnitureId);
  if (furniture.length === floor.furniture.length) return plan;
  return withFloor(plan, floorId, { ...floor, furniture });
}

/** A blank floor at the given level. */
export function createEmptyFloor(level = 0, newId: IdGen = defaultNewId): Floor {
  return {
    id: newId(),
    level,
    points: [],
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
  };
}

/**
 * A fresh, empty plan with one floor and a sensible default plot
 * (30x40 ft ≈ 914x1219 cm). Used as the editor's starting document.
 */
export function createInitialPlan(newId: IdGen = defaultNewId): Plan {
  return {
    id: newId(),
    name: 'Untitled Plan',
    units: 'cm',
    plot: {
      widthCm: 914,
      depthCm: 1219,
      shape: 'rectangular',
      entrance: 'E',
      setbacks: { front: 150, rear: 150, left: 90, right: 90 },
    },
    floors: [createEmptyFloor(0, newId)],
  };
}

/**
 * Add an empty floor one level above the current highest. Returns the new plan
 * and the new floor's id (so the caller can switch the active floor to it).
 */
export function addFloor(
  plan: Plan,
  newId: IdGen = defaultNewId,
): { plan: Plan; floorId: ID } {
  const maxLevel = plan.floors.reduce((m, f) => Math.max(m, f.level), -1);
  const floor = createEmptyFloor(maxLevel + 1, newId);
  return { plan: { ...plan, floors: [...plan.floors, floor] }, floorId: floor.id };
}

/** Remove a floor. No-op if it's the only floor (a plan always has ≥1 floor). */
export function deleteFloor(plan: Plan, floorId: ID): Plan {
  if (plan.floors.length <= 1) return plan;
  const floors = plan.floors.filter((f) => f.id !== floorId);
  if (floors.length === plan.floors.length) return plan;
  return { ...plan, floors };
}
