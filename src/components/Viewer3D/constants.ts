/**
 * Shared 3D-view constants. Coordinate mapping: cm ÷ 100 → metres.
 * 2D y → 3D z (depth axis). Imported by every Viewer3D submodule.
 */
import { DEFAULT_WALL_HEIGHT } from '../../model/planEdits';

/** Centimetres → metres scale factor. */
export const CM = 1 / 100;
/** Default ceiling height in metres. */
export const WALL_H = DEFAULT_WALL_HEIGHT * CM;
/** Standard door head height (m). */
export const DOOR_H = 2.1;
/** Window sill height (m). */
export const SILL_H = 0.9;
/** Window lintel height (m). */
export const LINTEL_H = 2.1;
/** Skirting board (baseboard) height (m). */
export const SKIRT_H = 0.1;
/** How far skirting / window sills stand proud of the wall face (m). */
export const TRIM_PROUD = 0.02;
