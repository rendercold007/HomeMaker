/**
 * Pure geometry — coordinate math for the editor. NO React imports.
 *
 * Phase 0 scope: the single screen <-> world transform. Per CLAUDE.md, all
 * screen<->world conversion must funnel through one pan/zoom transform; never
 * mix screen px and world cm in the same calculation.
 *
 * Model:
 *   - World units are centimeters. Screen units are CSS pixels.
 *   - A `Viewport` is `{ pan, zoom }` where `pan` is the screen-pixel position
 *     of the world origin (0,0) and `zoom` is screen pixels per world cm.
 *
 *   screen = world * zoom + pan
 *   world  = (screen - pan) / zoom
 *
 * These two are exact inverses (modulo float precision), which the tests pin.
 */

/** A 2D vector / coordinate pair. Used for both world (cm) and screen (px). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The pan/zoom camera.
 * - `pan`: where world-origin (0,0) lands on screen, in pixels.
 * - `zoom`: screen pixels per world centimeter (must be > 0).
 */
export interface Viewport {
  pan: Vec2;
  zoom: number;
}

/** Sensible bounds for zoom (screen px per world cm). */
export const MIN_ZOOM = 0.02; // very zoomed out (whole plot)
export const MAX_ZOOM = 20; // very zoomed in (sub-cm detail)

/** The identity viewport: world origin at screen origin, 1px = 1cm. */
export const IDENTITY_VIEWPORT: Viewport = {
  pan: { x: 0, y: 0 },
  zoom: 1,
};

/** Clamp a zoom value into the supported range. */
export function clampZoom(zoom: number): number {
  if (zoom < MIN_ZOOM) return MIN_ZOOM;
  if (zoom > MAX_ZOOM) return MAX_ZOOM;
  return zoom;
}

/** Convert a world-space point (cm) to screen-space (px). */
export function worldToScreen(world: Vec2, vp: Viewport): Vec2 {
  return {
    x: world.x * vp.zoom + vp.pan.x,
    y: world.y * vp.zoom + vp.pan.y,
  };
}

/** Convert a screen-space point (px) to world-space (cm). */
export function screenToWorld(screen: Vec2, vp: Viewport): Vec2 {
  return {
    x: (screen.x - vp.pan.x) / vp.zoom,
    y: (screen.y - vp.pan.y) / vp.zoom,
  };
}

/**
 * Convert a length only (no translation). Useful for thickness, grid spacing,
 * and dimension readouts where the pan offset must not apply.
 */
export function worldLengthToScreen(lengthCm: number, vp: Viewport): number {
  return lengthCm * vp.zoom;
}

/** Convert a screen length (px) back to a world length (cm). */
export function screenLengthToWorld(lengthPx: number, vp: Viewport): number {
  return lengthPx / vp.zoom;
}

/**
 * Pan the viewport by a screen-pixel delta (e.g. from a drag). Returns a new
 * viewport; does not mutate the input.
 */
export function panBy(vp: Viewport, deltaScreen: Vec2): Viewport {
  return {
    zoom: vp.zoom,
    pan: { x: vp.pan.x + deltaScreen.x, y: vp.pan.y + deltaScreen.y },
  };
}

/**
 * Zoom toward/away from a fixed screen anchor (e.g. the cursor), keeping the
 * world point under the anchor stationary. This is the correct way to wire a
 * scroll-wheel zoom. `nextZoom` is clamped to [MIN_ZOOM, MAX_ZOOM].
 *
 * Returns a new viewport; does not mutate the input.
 */
export function zoomAt(vp: Viewport, anchorScreen: Vec2, nextZoom: number): Viewport {
  const z = clampZoom(nextZoom);
  // World point currently under the anchor must stay under it after zooming.
  const worldUnderAnchor = screenToWorld(anchorScreen, vp);
  return {
    zoom: z,
    pan: {
      x: anchorScreen.x - worldUnderAnchor.x * z,
      y: anchorScreen.y - worldUnderAnchor.y * z,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Plane geometry (all in world cm)                                           */
/* -------------------------------------------------------------------------- */

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Squared distance — cheaper when you only need to compare. */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Round a single coordinate to the nearest multiple of `step`. */
function snapScalar(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Snap a world point to the nearest grid intersection (grid size in cm). */
export function snapToGrid(world: Vec2, gridCm: number): Vec2 {
  if (gridCm <= 0) return { x: world.x, y: world.y };
  return { x: snapScalar(world.x, gridCm), y: snapScalar(world.y, gridCm) };
}

/** Result of a point-snap query. */
export interface PointSnap {
  point: Vec2;
  /** Index of the matched candidate, or -1 if none within threshold. */
  index: number;
}

/**
 * Snap to the nearest candidate point within `thresholdCm`. Candidates are the
 * existing vertices in the wall graph. Returns the original point with
 * `index: -1` when nothing is close enough. Threshold is in WORLD cm, so the
 * caller is responsible for converting a screen-pixel tolerance via
 * `screenLengthToWorld` before calling.
 */
export function snapToNearestPoint(
  world: Vec2,
  candidates: readonly Vec2[],
  thresholdCm: number,
): PointSnap {
  let best = -1;
  let bestSq = thresholdCm * thresholdCm;
  for (let i = 0; i < candidates.length; i++) {
    const dSq = distanceSq(world, candidates[i]!);
    if (dSq <= bestSq) {
      bestSq = dSq;
      best = i;
    }
  }
  return best === -1
    ? { point: { x: world.x, y: world.y }, index: -1 }
    : { point: { x: candidates[best]!.x, y: candidates[best]!.y }, index: best };
}

/**
 * Constrain `target` so the segment from `origin` lies on the nearest angle
 * that is a multiple of `stepDeg` (default 45° → also covers 90°). The segment
 * LENGTH is preserved; only its direction is rotated to the locked angle.
 * Used for Shift-to-constrain while drawing walls.
 */
export function applyAngleLock(origin: Vec2, target: Vec2, stepDeg = 45): Vec2 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: target.x, y: target.y };

  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const locked = Math.round(angle / step) * step;
  return {
    x: origin.x + Math.cos(locked) * len,
    y: origin.y + Math.sin(locked) * len,
  };
}

/**
 * Distance from point `p` to the segment `[a, b]`, plus the closest point on
 * the segment. Used for hit-testing walls (which are segments, not points).
 */
export function distanceToSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { distance: number; closest: Vec2 } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return { distance: distance(p, a), closest: { x: a.x, y: a.y } };
  }
  // Project p onto the line, clamped to the [0,1] segment range.
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: a.x + t * abx, y: a.y + t * aby };
  return { distance: distance(p, closest), closest };
}

/**
 * Intersection of two infinite lines, each given as a point on the line and a
 * direction vector (directions need not be unit length). Returns `null` when the
 * lines are parallel (or near-parallel within a small epsilon), where no single
 * intersection exists. Used by the wall miter solver to find where neighbouring
 * wall edges meet at a shared corner.
 */
export function lineIntersection(
  p1: Vec2,
  d1: Vec2,
  p2: Vec2,
  d2: Vec2,
): Vec2 | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const s = (dx * d2.y - dy * d2.x) / cross;
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y };
}

/**
 * Signed area of a polygon via the shoelace formula (world cm²).
 * In screen coordinates (y down), a CLOCKWISE polygon yields a POSITIVE value.
 * Callers that need a positive area should take the absolute value.
 */
export function signedPolygonArea(pts: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
