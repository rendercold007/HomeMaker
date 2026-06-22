/**
 * Editor snapping — composes the geometry primitives into the snap priority
 * from CLAUDE.md: existing points -> grid -> 45/90 angle lock (Shift).
 *
 * Pure (no React) so it can be unit-tested. Threshold is in world cm; the
 * caller converts a screen-pixel tolerance via screenLengthToWorld first.
 */
import {
  applyAngleLock,
  snapToGrid,
  snapToNearestPoint,
  type Vec2,
} from '../../model/geometry';
import type { ID } from '../../model/types';

export interface SnapCandidate extends Vec2 {
  id: ID;
}

export interface SnapOptions {
  /** Existing vertices that can be snapped to. */
  candidates: readonly SnapCandidate[];
  /** Vertex ids to ignore (e.g. the draft start, or the dragged point). */
  exclude?: ReadonlySet<ID>;
  gridCm: number;
  gridSnap: boolean;
  /** Shift held → constrain direction to 45° multiples from `anchor`. */
  shift: boolean;
  /** Origin for angle lock; required for the lock to apply. */
  anchor?: Vec2 | null;
  /** Point-snap radius in world cm. */
  thresholdCm: number;
}

export interface SnapResult extends Vec2 {
  /** Set when snapped onto an existing vertex. */
  pointId?: ID;
}

/** Resolve a raw world point to its snapped position. */
export function snapWorldPoint(raw: Vec2, opts: SnapOptions): SnapResult {
  const exclude = opts.exclude;
  const usable = exclude
    ? opts.candidates.filter((c) => !exclude.has(c.id))
    : opts.candidates;

  // 1. Existing points win outright.
  const hit = snapToNearestPoint(raw, usable, opts.thresholdCm);
  if (hit.index !== -1) {
    const c = usable[hit.index]!;
    return { x: c.x, y: c.y, pointId: c.id };
  }

  // 2. Angle lock (Shift) when we have an anchor to lock against.
  if (opts.shift && opts.anchor) {
    return applyAngleLock(opts.anchor, raw);
  }

  // 3. Grid.
  if (opts.gridSnap) {
    return snapToGrid(raw, opts.gridCm);
  }

  return { x: raw.x, y: raw.y };
}
