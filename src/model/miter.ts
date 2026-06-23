/**
 * Wall mitering — clean corner joins for the wall graph. PURE logic, no React.
 *
 * A wall is a centerline segment with a thickness. Rendered naively as a
 * rectangle, two walls meeting at a vertex overlap on the inside and leave a
 * triangular notch on the outside. Mitering replaces each wall's square end with
 * the actual intersection of its side edge and its neighbour's side edge at the
 * shared vertex, so corners meet cleanly with no gap or overlap.
 *
 * The output is one quad (four corners) per wall, consumed by both the 2D
 * renderer (filled polygon) and, later, the 3D extrusion.
 *
 * Approach, per vertex V:
 *   - Collect every wall touching V as a "half-edge" pointing away from V.
 *   - Sort them by angle around V.
 *   - For each half-edge, its left corner is where its left edge meets the
 *     right edge of its counter-clockwise neighbour; its right corner is where
 *     its right edge meets the left edge of its clockwise neighbour.
 *   - Free ends (one wall at V) and parallel/collinear neighbours fall back to a
 *     square butt end. Very acute miters are clamped to a butt end to avoid
 *     long spikes (see MITER_LIMIT).
 */
import type { ID, Point, Wall } from './types';
import { lineIntersection, type Vec2 } from './geometry';

/**
 * Beyond this multiple of a wall's half-thickness, an acute miter is clamped to
 * a square butt end so corners don't shoot out into long spikes.
 */
const MITER_LIMIT = 6;

export interface WallQuad {
  wallId: ID;
  /**
   * Outline corners in ring order: leftA → leftB → rightB → rightA, where
   * "left"/"right" are the wall's two physical sides relative to the A→B
   * direction. Suitable for a closed filled polygon.
   */
  corners: [Vec2, Vec2, Vec2, Vec2];
}

/** A wall as seen from one of its endpoints, pointing away from that vertex. */
interface HalfEdge {
  wall: Wall;
  /** Unit direction from this vertex toward the wall's other endpoint. */
  dir: Vec2;
  /** Left normal of `dir` (dir rotated +90°). */
  nL: Vec2;
  /** Half the wall thickness. */
  halfT: number;
  /** atan2 of `dir`, for sorting around the vertex. */
  angle: number;
}

/** Corners of one wall end, in that vertex's own left/right frame. */
interface EndCorners {
  left: Vec2;
  right: Vec2;
}

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });

/** Square (un-mitered) corners at a vertex: offset perpendicular by ±halfT. */
function buttCorners(v: Vec2, he: HalfEdge): EndCorners {
  return {
    left: add(v, scale(he.nL, he.halfT)),
    right: add(v, scale(he.nL, -he.halfT)),
  };
}

/**
 * Miter corner for `he` on the requested side, against `neighbor`. `he`'s edge
 * on that side is intersected with the neighbour's facing (opposite-side) edge.
 * Falls back to the square corner when the edges are parallel or the miter is
 * too long (acute spike).
 */
function miterCorner(
  v: Vec2,
  he: HalfEdge,
  neighbor: HalfEdge,
  side: 'left' | 'right',
): Vec2 {
  const sign = side === 'left' ? 1 : -1;
  const thisEdgePt = add(v, scale(he.nL, sign * he.halfT));
  const nbrEdgePt = add(v, scale(neighbor.nL, -sign * neighbor.halfT));
  const hit = lineIntersection(thisEdgePt, he.dir, nbrEdgePt, neighbor.dir);
  if (!hit) return thisEdgePt; // parallel / collinear → butt
  if (Math.hypot(hit.x - v.x, hit.y - v.y) > MITER_LIMIT * he.halfT) {
    return thisEdgePt; // acute spike → clamp to butt
  }
  return hit;
}

/**
 * Compute the mitered quad for every wall in the graph. Walls whose endpoints
 * are missing or coincident are skipped. The result is keyed by wall id.
 */
export function computeWallQuads(
  points: readonly Point[],
  walls: readonly Wall[],
): Map<ID, WallQuad> {
  const pById = new Map(points.map((p) => [p.id, p]));

  // vertexId → half-edges touching it.
  const incident = new Map<ID, HalfEdge[]>();
  const pushHalfEdge = (vid: ID, he: HalfEdge) => {
    const list = incident.get(vid);
    if (list) list.push(he);
    else incident.set(vid, [he]);
  };

  for (const wall of walls) {
    const pa = pById.get(wall.a);
    const pb = pById.get(wall.b);
    if (!pa || !pb) continue;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len === 0) continue;
    const halfT = wall.thickness / 2;

    const dAB: Vec2 = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len };
    pushHalfEdge(wall.a, {
      wall,
      dir: dAB,
      nL: { x: -dAB.y, y: dAB.x },
      halfT,
      angle: Math.atan2(dAB.y, dAB.x),
    });

    const dBA: Vec2 = { x: -dAB.x, y: -dAB.y };
    pushHalfEdge(wall.b, {
      wall,
      dir: dBA,
      nL: { x: -dBA.y, y: dBA.x },
      halfT,
      angle: Math.atan2(dBA.y, dBA.x),
    });
  }

  // Per (vertex, wall) end corners.
  const ends = new Map<string, EndCorners>();
  for (const [vid, hes] of incident) {
    const v = pById.get(vid)!;
    hes.sort((x, y) => x.angle - y.angle);
    const n = hes.length;
    for (let i = 0; i < n; i++) {
      const he = hes[i]!;
      if (n === 1) {
        ends.set(`${vid}|${he.wall.id}`, buttCorners(v, he));
        continue;
      }
      const ccw = hes[(i + 1) % n]!; // left neighbour
      const cw = hes[(i - 1 + n) % n]!; // right neighbour
      ends.set(`${vid}|${he.wall.id}`, {
        left: miterCorner(v, he, ccw, 'left'),
        right: miterCorner(v, he, cw, 'right'),
      });
    }
  }

  // Assemble quads. At vertex B the left/right frame is flipped (B's outward
  // direction is the reverse of A's), so B's "right" is the wall's physical left.
  const quads = new Map<ID, WallQuad>();
  for (const wall of walls) {
    const ea = ends.get(`${wall.a}|${wall.id}`);
    const eb = ends.get(`${wall.b}|${wall.id}`);
    if (!ea || !eb) continue;
    quads.set(wall.id, {
      wallId: wall.id,
      corners: [ea.left, eb.right, eb.left, ea.right],
    });
  }
  return quads;
}
