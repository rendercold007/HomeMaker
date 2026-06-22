/**
 * Room detection — rooms are DERIVED, never authored (see CLAUDE.md).
 *
 * A room is a minimal closed cycle (a "face") of the wall graph. We treat the
 * walls as a planar straight-line graph and enumerate its interior faces using
 * the classic next-half-edge traversal:
 *
 *   At each vertex we sort the outgoing edges by angle. To walk a face, after
 *   arriving at vertex `v` along edge `u -> v`, the next edge is the one
 *   immediately CLOCKWISE from the reverse edge `v -> u`. Following this rule
 *   from every directed half-edge, and marking half-edges as we consume them,
 *   partitions the graph into faces. Exactly one face is the unbounded outer
 *   face; the rest are rooms.
 *
 * Coordinates are screen-style (y down). With the clockwise traversal above,
 * interior faces come out with POSITIVE signed area (see signedPolygonArea),
 * and the outer face comes out negative — that's how we drop it.
 *
 * Pure module: no React imports. Fully unit-tested.
 */
import type { Floor, Point, Room, Wall, ID } from './types';
import { signedPolygonArea, type Vec2 } from './geometry';

/** Faces smaller than this (cm²) are treated as degenerate and ignored. */
const MIN_ROOM_AREA_CM2 = 1;

interface HalfEdge {
  from: ID;
  to: ID;
  angle: number; // direction from -> to, radians
}

function pairKey(a: ID, b: ID): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function edgeKey(from: ID, to: ID): string {
  return `${from}>${to}`;
}

/**
 * Detect rooms for a single floor from its points + walls.
 * Returns a fresh Room[]; does not mutate the floor.
 */
export function detectRooms(points: readonly Point[], walls: readonly Wall[]): Room[] {
  const pointById = new Map<ID, Point>();
  for (const p of points) pointById.set(p.id, p);

  // Wall lookup by unordered endpoint pair, so a traced edge can name its wall.
  const wallByPair = new Map<string, ID>();
  for (const w of walls) {
    // Skip self-loops and walls referencing missing points.
    if (w.a === w.b) continue;
    if (!pointById.has(w.a) || !pointById.has(w.b)) continue;
    wallByPair.set(pairKey(w.a, w.b), w.id);
  }

  // Adjacency: vertex -> outgoing half-edges, each later sorted by angle.
  const adjacency = new Map<ID, HalfEdge[]>();
  const addHalfEdge = (from: ID, to: ID) => {
    const pf = pointById.get(from)!;
    const pt = pointById.get(to)!;
    const angle = Math.atan2(pt.y - pf.y, pt.x - pf.x);
    const list = adjacency.get(from);
    const he: HalfEdge = { from, to, angle };
    if (list) list.push(he);
    else adjacency.set(from, [he]);
  };
  for (const [key] of wallByPair) {
    const [a, b] = key.split('|') as [ID, ID];
    addHalfEdge(a, b);
    addHalfEdge(b, a);
  }
  for (const list of adjacency.values()) {
    list.sort((m, n) => m.angle - n.angle);
  }

  /**
   * Given we arrived at `to` from `from`, return the next half-edge of the
   * face: the edge immediately clockwise from the reverse edge `to -> from`.
   * "Clockwise" with ascending-angle sorting = the previous entry (wrapping).
   */
  const nextHalfEdge = (from: ID, to: ID): HalfEdge => {
    const out = adjacency.get(to)!;
    const idx = out.findIndex((he) => he.to === from);
    const prev = (idx - 1 + out.length) % out.length;
    return out[prev]!;
  };

  const visited = new Set<string>();
  const rooms: Room[] = [];

  for (const [, list] of adjacency) {
    for (const start of list) {
      if (visited.has(edgeKey(start.from, start.to))) continue;

      // Trace one face.
      const cycle: ID[] = [];
      let cur = start;
      let guard = 0;
      const maxSteps = walls.length * 2 + 4;
      do {
        visited.add(edgeKey(cur.from, cur.to));
        cycle.push(cur.from);
        cur = nextHalfEdge(cur.from, cur.to);
        if (++guard > maxSteps) break; // safety against malformed graphs
      } while (edgeKey(cur.from, cur.to) !== edgeKey(start.from, start.to));

      if (cycle.length < 3) continue;

      const polygon: Vec2[] = cycle.map((id) => {
        const p = pointById.get(id)!;
        return { x: p.x, y: p.y };
      });
      const signed = signedPolygonArea(polygon);

      // Interior faces are positive under our clockwise traversal; the outer
      // face is negative. Drop the outer face and any degenerate slivers.
      if (signed <= MIN_ROOM_AREA_CM2) continue;

      const wallIds: ID[] = [];
      for (let i = 0; i < cycle.length; i++) {
        const a = cycle[i]!;
        const b = cycle[(i + 1) % cycle.length]!;
        const wid = wallByPair.get(pairKey(a, b));
        if (wid) wallIds.push(wid);
      }

      // Stable id derived from the wall set, so recomputation keeps room ids
      // consistent across edits that don't change a room's boundary.
      const id = `room:${[...wallIds].sort().join(',')}`;
      rooms.push({ id, wallIds, name: 'Room', areaCm2: Math.round(signed) });
    }
  }

  return rooms;
}

/** Convenience: return a copy of the floor with its `rooms` field recomputed. */
export function withDetectedRooms(floor: Floor): Floor {
  return { ...floor, rooms: detectRooms(floor.points, floor.walls) };
}
