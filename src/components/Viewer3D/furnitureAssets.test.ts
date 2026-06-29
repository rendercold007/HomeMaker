import { describe, it, expect } from 'vitest';
import {
  computeFitTransform,
  hasAsset,
  typeFromPath,
  FURNITURE_ASSETS,
  type ModelBox,
} from './furnitureAssets';

// A 2m × 1m × 0.8m model centred at the origin, sitting 0.1m below the floor.
const box: ModelBox = {
  sizeX: 2, sizeY: 0.8, sizeZ: 1,
  centerX: 0.5, centerZ: -0.25, minY: -0.1,
};

describe('computeFitTransform', () => {
  it('scales uniformly to fit within the footprint (aspect preserved)', () => {
    // Footprint 1m × 1m: width is the tighter constraint (1/2 = 0.5 < 1/1 = 1).
    const fit = computeFitTransform(box, { url: 'x' }, { w: 1, d: 1 });
    expect(fit.scale).toBeCloseTo(0.5);
  });

  it('centres the model horizontally on the group origin', () => {
    const fit = computeFitTransform(box, { url: 'x' }, { w: 1, d: 1 });
    expect(fit.offsetX).toBeCloseTo(-0.5 * 0.5); // -centerX * scale
    expect(fit.offsetZ).toBeCloseTo(0.25 * 0.5); // -centerZ * scale
  });

  it('rests the model on the floor (scaled min-y → 0)', () => {
    const fit = computeFitTransform(box, { url: 'x' }, { w: 1, d: 1 });
    expect(fit.offsetY).toBeCloseTo(0.1 * 0.5); // -minY * scale
  });

  it('honours a fixed scale override and skips auto-fit', () => {
    const fit = computeFitTransform(box, { url: 'x', scale: 2 }, { w: 1, d: 1 });
    expect(fit.scale).toBe(2);
  });

  it('leaves wall-mounted models at their model height with keepModelY', () => {
    const fit = computeFitTransform(box, { url: 'x', keepModelY: true }, { w: 1, d: 1 });
    expect(fit.offsetY).toBe(0);
  });

  it('never divides by zero on a degenerate (flat) model', () => {
    const flat: ModelBox = { sizeX: 0, sizeY: 1, sizeZ: 0, centerX: 0, centerZ: 0, minY: 0 };
    const fit = computeFitTransform(flat, { url: 'x' }, { w: 1, d: 1 });
    expect(Number.isFinite(fit.scale)).toBe(true);
  });
});

describe('typeFromPath', () => {
  it('derives the furniture type from a model filename', () => {
    expect(typeFromPath('../../assets/models/sofa.glb')).toBe('sofa');
    expect(typeFromPath('/x/y/double_bed.glb')).toBe('double_bed');
    expect(typeFromPath('KITCHEN_SINK.GLB')).toBe('KITCHEN_SINK');
  });
});

describe('manifest (auto-discovered from src/assets/models)', () => {
  it('reports false for types with no model so they render procedurally', () => {
    expect(hasAsset('__definitely_not_a_real_type__')).toBe(false);
  });

  it('every discovered entry is keyed by type and carries a .glb url', () => {
    for (const [type, def] of Object.entries(FURNITURE_ASSETS)) {
      expect(hasAsset(type)).toBe(true);
      expect(def.url, type).toMatch(/\.glb($|\?)/i);
    }
  });

  it('picks up the sofa model that lives in the folder', () => {
    // sofa.glb is committed under src/assets/models, so it must auto-wire.
    expect(hasAsset('sofa')).toBe(true);
  });

  it('excludes kitchen_counter even though its file exists (renders procedurally)', () => {
    // The kitchen_counter.glb on disk is a full kitchen run, not a single
    // counter; it's deliberately excluded so it falls back to the procedural
    // mesh. See EXCLUDED_TYPES in furnitureAssets.ts.
    expect(hasAsset('kitchen_counter')).toBe(false);
  });
});
