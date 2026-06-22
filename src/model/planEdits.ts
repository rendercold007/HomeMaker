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
import type { Floor, ID, Plan, Point } from './types';
import { detectRooms } from './roomDetect';
import { newId as defaultNewId } from './ids';

type IdGen = () => ID;

/** Default thickness for newly drawn walls, in cm. */
export const DEFAULT_WALL_THICKNESS = 10;

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

/** Recompute derived rooms for every floor. Call after any wall-graph change. */
export function recomputeRooms(plan: Plan): Plan {
  return {
    ...plan,
    floors: plan.floors.map((f) => ({
      ...f,
      rooms: detectRooms(f.points, f.walls),
    })),
  };
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
): Plan {
  if (a === b) return plan;
  const floor = getFloor(plan, floorId);
  const exists = floor.walls.some(
    (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
  );
  if (exists) return plan;
  const next: Floor = {
    ...floor,
    walls: [...floor.walls, { id: newId(), a, b, thickness }],
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
 * A fresh, empty plan with one floor and a sensible default Bengaluru-ish plot
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
    vastu: { mode: 'loose' },
  };
}
