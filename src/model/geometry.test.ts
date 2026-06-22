import { describe, it, expect } from 'vitest';
import {
  IDENTITY_VIEWPORT,
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  worldToScreen,
  screenToWorld,
  worldLengthToScreen,
  screenLengthToWorld,
  panBy,
  zoomAt,
  type Viewport,
  type Vec2,
} from './geometry';

const EPS = 1e-9;

function expectClose(a: Vec2, b: Vec2, eps = EPS) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
}

describe('worldToScreen / screenToWorld', () => {
  it('identity viewport maps world to itself', () => {
    expectClose(worldToScreen({ x: 100, y: 250 }, IDENTITY_VIEWPORT), {
      x: 100,
      y: 250,
    });
  });

  it('applies zoom then pan: screen = world*zoom + pan', () => {
    const vp: Viewport = { pan: { x: 30, y: -10 }, zoom: 2 };
    expectClose(worldToScreen({ x: 50, y: 100 }, vp), { x: 130, y: 190 });
  });

  it('screenToWorld is the inverse of worldToScreen', () => {
    const vp: Viewport = { pan: { x: 30, y: -10 }, zoom: 2 };
    const world: Vec2 = { x: 123, y: -456 };
    expectClose(screenToWorld(worldToScreen(world, vp), vp), world);
  });

  it('round-trips for a variety of viewports and points', () => {
    const viewports: Viewport[] = [
      { pan: { x: 0, y: 0 }, zoom: 1 },
      { pan: { x: 640, y: 360 }, zoom: 0.05 },
      { pan: { x: -200, y: 75 }, zoom: 12.5 },
    ];
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1000, y: -2000 },
      { x: -37.5, y: 88.25 },
    ];
    for (const vp of viewports) {
      for (const p of points) {
        expectClose(screenToWorld(worldToScreen(p, vp), vp), p, 1e-6);
      }
    }
  });

  it('zooming out scales distances down on screen', () => {
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 0.5 };
    expectClose(worldToScreen({ x: 200, y: 200 }, vp), { x: 100, y: 100 });
  });
});

describe('length conversions (no translation)', () => {
  it('worldLengthToScreen scales by zoom only, ignoring pan', () => {
    const vp: Viewport = { pan: { x: 999, y: -999 }, zoom: 3 };
    expect(worldLengthToScreen(10, vp)).toBe(30);
  });

  it('screenLengthToWorld is the inverse of worldLengthToScreen', () => {
    const vp: Viewport = { pan: { x: 5, y: 5 }, zoom: 2.5 };
    expect(screenLengthToWorld(worldLengthToScreen(42, vp), vp)).toBeCloseTo(42);
  });
});

describe('clampZoom', () => {
  it('passes through values in range', () => {
    expect(clampZoom(1)).toBe(1);
  });
  it('clamps below MIN_ZOOM', () => {
    expect(clampZoom(MIN_ZOOM / 10)).toBe(MIN_ZOOM);
  });
  it('clamps above MAX_ZOOM', () => {
    expect(clampZoom(MAX_ZOOM * 10)).toBe(MAX_ZOOM);
  });
});

describe('panBy', () => {
  it('shifts pan by the screen delta without touching zoom', () => {
    const vp: Viewport = { pan: { x: 10, y: 20 }, zoom: 4 };
    const next = panBy(vp, { x: 5, y: -5 });
    expect(next.pan).toEqual({ x: 15, y: 15 });
    expect(next.zoom).toBe(4);
  });

  it('does not mutate the input viewport', () => {
    const vp: Viewport = { pan: { x: 10, y: 20 }, zoom: 4 };
    panBy(vp, { x: 100, y: 100 });
    expect(vp.pan).toEqual({ x: 10, y: 20 });
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the anchor stationary', () => {
    const vp: Viewport = { pan: { x: 100, y: 50 }, zoom: 1 };
    const anchor: Vec2 = { x: 400, y: 300 };
    const worldBefore = screenToWorld(anchor, vp);

    const zoomed = zoomAt(vp, anchor, 3);
    const worldAfter = screenToWorld(anchor, zoomed);

    expect(zoomed.zoom).toBe(3);
    expectClose(worldAfter, worldBefore, 1e-6);
  });

  it('clamps the resulting zoom to the supported range', () => {
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
    expect(zoomAt(vp, { x: 0, y: 0 }, MAX_ZOOM * 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(vp, { x: 0, y: 0 }, MIN_ZOOM / 100).zoom).toBe(MIN_ZOOM);
  });

  it('does not mutate the input viewport', () => {
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
    zoomAt(vp, { x: 10, y: 10 }, 5);
    expect(vp).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
  });
});
