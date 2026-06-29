/**
 * Walkthrough wall-collision math (pure — no React/THREE imports, so it's
 * unit-testable). The player is a circle of radius PLAYER_R; walls are line
 * segments inflated by half their thickness. Doorways are removed so you can
 * walk between rooms; windows still block (there's glass).
 *
 * Coordinates are in metres (plan cm → m via CM), with plan-y mapped to world-z.
 */
import type { Floor, Opening } from '../../model/types';
import { CM } from './constants';

/** Player collision radius, metres. */
export const PLAYER_R = 0.25;

/** A wall sub-segment the player collides with: endpoints + collision radius. */
export interface WallCollider {
  ax: number; az: number; bx: number; bz: number;
  /** half wall thickness + player radius, in metres. */
  radius: number;
}

/**
 * Build the collision segments for a floor: each wall split into the spans that
 * actually block the player — i.e. the wall minus its door openings.
 */
export function buildColliders(floor: Floor): WallCollider[] {
  const pointById = new Map(floor.points.map((p) => [p.id, p]));
  const openingsByWall = new Map<string, Opening[]>();
  for (const op of floor.openings) {
    const list = openingsByWall.get(op.wallId) ?? [];
    list.push(op);
    openingsByWall.set(op.wallId, list);
  }

  const colliders: WallCollider[] = [];
  for (const wall of floor.walls) {
    const pa = pointById.get(wall.a);
    const pb = pointById.get(wall.b);
    if (!pa || !pb) continue;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len <= 0) continue;

    // Solid spans = whole wall minus the door openings (clamped, sorted, merged).
    const doors = (openingsByWall.get(wall.id) ?? [])
      .filter((o) => o.kind === 'door')
      .map((o) => ({ start: Math.max(0, Math.min(len, o.offset)), end: Math.max(0, Math.min(len, o.offset + o.width)) }))
      .filter((d) => d.end > d.start)
      .sort((a, b) => a.start - b.start);

    const spans: Array<[number, number]> = [];
    let cursor = 0;
    for (const d of doors) {
      if (d.start > cursor) spans.push([cursor, d.start]);
      cursor = Math.max(cursor, d.end);
    }
    if (cursor < len) spans.push([cursor, len]);

    const radius = (wall.thickness * CM) / 2 + PLAYER_R;
    for (const [d0, d1] of spans) {
      colliders.push({
        ax: (pa.x + (d0 / len) * (pb.x - pa.x)) * CM,
        az: (pa.y + (d0 / len) * (pb.y - pa.y)) * CM,
        bx: (pa.x + (d1 / len) * (pb.x - pa.x)) * CM,
        bz: (pa.y + (d1 / len) * (pb.y - pa.y)) * CM,
        radius,
      });
    }
  }
  return colliders;
}

/**
 * Push (px,pz) out of any wall it has penetrated and return the corrected
 * position. A few passes resolve being wedged against two walls in a corner.
 * Cancelling only the into-wall component lets the caller slide along walls.
 */
export function resolveCollisions(px: number, pz: number, colliders: WallCollider[]): [number, number] {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      const dx = c.bx - c.ax;
      const dz = c.bz - c.az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - c.ax) * dx + (pz - c.az) * dz) / len2)) : 0;
      const qx = c.ax + t * dx;
      const qz = c.az + t * dz;
      let nx = px - qx;
      let nz = pz - qz;
      let dist = Math.hypot(nx, nz);
      if (dist >= c.radius) continue;
      if (dist < 1e-6) {
        // On the wall line: push along its perpendicular (sign is arbitrary here).
        const il = 1 / Math.sqrt(len2 || 1);
        nx = -dz * il; nz = dx * il; dist = 0;
      } else {
        nx /= dist; nz /= dist;
      }
      const push = c.radius - dist;
      px += nx * push;
      pz += nz * push;
      moved = true;
    }
    if (!moved) break;
  }
  return [px, pz];
}
