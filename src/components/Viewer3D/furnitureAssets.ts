/**
 * Furniture → real GLB asset manifest (Tier 2 #4).
 *
 * Pure data + pure math, no React/THREE imports — so the fit logic is
 * unit-testable. The 3D view loads a real `.glb` for any type that has a model
 * and falls back to the hand-built procedural mesh (`FurnitureMesh`) for
 * everything else (and for any model that fails to load).
 *
 * Assets are AUTO-DISCOVERED: every `<type>.glb` in `src/assets/models/` wires
 * itself up — no list to maintain. To add a model:
 *   1. Drop a CC0/licensed file named after the furniture `type` into
 *      `src/assets/models/`, e.g. `sofa.glb`, `double_bed.glb` (types live in
 *      FURNITURE_CATALOG, src/model/furniture.ts).
 *   2. That's it — the loader fits it to the catalog footprint and rests it on
 *      the floor automatically.
 *   3. Only if a model needs it, add a tweak in ASSET_OVERRIDES below.
 *
 * Types with no file render procedurally, exactly as before — and produce no
 * network requests, so there are no 404s for furniture you haven't sourced yet.
 */

export interface AssetDef {
  /** Resolved (bundled) URL of the model file. */
  url: string;
  /**
   * Extra yaw in degrees, applied before the item's own rotation. Use when a
   * model's "front" doesn't face +Z (our convention) in its source file.
   */
  yawDeg?: number;
  /**
   * Force a fixed uniform scale instead of fitting to the catalog footprint.
   * Leave unset to auto-fit (the common case).
   */
  scale?: number;
  /**
   * Don't rest the model on the floor (y=0). Use for wall-mounted items
   * (mirror, geyser, towel rail) whose source origin is already placed.
   */
  keepModelY?: boolean;
}

/**
 * Per-type tweaks, merged onto the auto-discovered entry. Only add a type here
 * if its model needs a correction — most don't. Examples:
 *   double_bed: { yawDeg: 180 },   // model faces the wrong way
 *   mirror: { keepModelY: true },  // wall-mounted, keep its own height
 */
const ASSET_OVERRIDES: Readonly<Record<string, Omit<AssetDef, 'url'>>> = {
  // Wall-mounted fixtures: their source origin already sits at mounting height,
  // so don't drop them to the floor. (Harmless until a matching .glb exists.)
  mirror: { keepModelY: true },
  towel_rail: { keepModelY: true },
  geyser: { keepModelY: true },
};

/**
 * Types whose `.glb` is present on disk but deliberately NOT wired up, so they
 * render with the procedural mesh instead. Use when a sourced model can't be
 * salvaged by an override.
 *
 * - kitchen_counter: the file is a full kitchen run (≈5.5 m wide × 2.9 m tall,
 *   with upper wall cabinets baked in), not a single counter segment. Auto-fit
 *   to the 180×60 footprint squashes it into an unrecognisable thin slab, and no
 *   scale can fix the 2.9 m cabinet height. Re-source a single base-counter
 *   model, then remove it from this set.
 */
const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['kitchen_counter']);

// Vite bundles every matching file and hands back its hashed URL. Eager so the
// manifest is a plain object at module load. Only files that exist are included.
const MODEL_URLS = import.meta.glob('../../assets/models/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Derive the furniture `type` from a model path: '.../sofa.glb' → 'sofa'. */
export function typeFromPath(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.glb$/i, '');
}

function buildManifest(): Record<string, AssetDef> {
  const out: Record<string, AssetDef> = {};
  for (const [path, url] of Object.entries(MODEL_URLS)) {
    const type = typeFromPath(path);
    if (type && !EXCLUDED_TYPES.has(type)) out[type] = { url, ...ASSET_OVERRIDES[type] };
  }
  return out;
}

export const FURNITURE_ASSETS: Readonly<Record<string, AssetDef>> = buildManifest();

export function hasAsset(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FURNITURE_ASSETS, type);
}

// ── Fit math (pure) ─────────────────────────────────────────────────────────

/** A loaded model's axis-aligned bounds, in metres, in model-local space. */
export interface ModelBox {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  centerX: number;
  centerZ: number;
  minY: number;
}

export interface FitTransform {
  /** Uniform scale to apply to the model. */
  scale: number;
  /** Local offset so the model is centred on X/Z and rests on the floor. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

/**
 * Compute a uniform scale that fits the model within the target footprint
 * (preserving aspect ratio — we never stretch a model), plus the offset that
 * centres it horizontally and drops it onto the floor (min-y → 0).
 *
 * `footprint` is the catalog footprint in metres (widthCm·CM, heightCm·CM).
 */
export function computeFitTransform(
  box: ModelBox,
  def: AssetDef,
  footprint: { w: number; d: number },
): FitTransform {
  const fitW = box.sizeX > 1e-6 ? footprint.w / box.sizeX : 1;
  const fitD = box.sizeZ > 1e-6 ? footprint.d / box.sizeZ : 1;
  const scale = def.scale ?? Math.min(fitW, fitD);
  return {
    scale,
    offsetX: -box.centerX * scale,
    offsetY: def.keepModelY ? 0 : -box.minY * scale,
    offsetZ: -box.centerZ * scale,
  };
}
