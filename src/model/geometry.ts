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
