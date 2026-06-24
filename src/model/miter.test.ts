import { describe, it, expect } from 'vitest';
import { computeWallQuads, wallEdgePoint } from './miter';
import type { Point, Wall } from './types';
import type { Vec2 } from './geometry';

function pt(id: string, x: number, y: number): Point {
  return { id, x, y };
}
function wall(id: string, a: string, b: string, thickness = 10): Wall {
  return { id, a, b, thickness, height: 270 };
}
function near(actual: Vec2 | undefined, ex: [number, number]) {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(ex[0], 6);
  expect(actual!.y).toBeCloseTo(ex[1], 6);
}

describe('computeWallQuads', () => {
  it('skips walls with missing or coincident endpoints', () => {
    const quads = computeWallQuads(
      [pt('A', 0, 0), pt('B', 0, 0)],
      [wall('zero', 'A', 'B'), wall('missing', 'A', 'X')],
    );
    expect(quads.size).toBe(0);
  });

  it('a free-standing wall is a plain rectangle (square butt ends)', () => {
    const quads = computeWallQuads(
      [pt('A', 0, 0), pt('B', 100, 0)],
      [wall('w', 'A', 'B', 10)],
    );
    const q = quads.get('w');
    expect(q).toBeDefined();
    // ring order: leftA, leftB, rightB, rightA
    near(q!.corners[0], [0, 5]);
    near(q!.corners[1], [100, 5]);
    near(q!.corners[2], [100, -5]);
    near(q!.corners[3], [0, -5]);
  });

  it('two collinear walls stay seamless rectangles at the shared vertex', () => {
    const quads = computeWallQuads(
      [pt('A', 0, 0), pt('M', 100, 0), pt('B', 200, 0)],
      [wall('w1', 'A', 'M', 10), wall('w2', 'M', 'B', 10)],
    );
    const w1 = quads.get('w1')!;
    const w2 = quads.get('w2')!;
    // w1 ends square at M; w2 begins square at M — no overlap, no gap.
    near(w1.corners[1], [100, 5]); // w1 leftB at M
    near(w1.corners[2], [100, -5]); // w1 rightB at M
    near(w2.corners[0], [100, 5]); // w2 leftA at M
    near(w2.corners[3], [100, -5]); // w2 rightA at M
  });

  it('a right-angle corner produces a shared 45° miter edge', () => {
    // Two walls meeting at V=(0,0): one to the left, one straight up (y-down).
    const quads = computeWallQuads(
      [pt('V', 0, 0), pt('L', -100, 0), pt('U', 0, -100)],
      [wall('w1', 'V', 'L', 10), wall('w2', 'V', 'U', 10)],
    );
    const w1 = quads.get('w1')!;
    const w2 = quads.get('w2')!;
    // w1's V-end edge runs leftA→…→rightA = (-5,-5) → (5,5).
    near(w1.corners[0], [-5, -5]);
    near(w1.corners[3], [5, 5]);
    // w2's V-end edge runs (5,5) → (-5,-5) — the SAME segment, so the walls abut
    // cleanly along the miter with no gap or overlap.
    near(w2.corners[0], [5, 5]);
    near(w2.corners[3], [-5, -5]);
  });

  it('clamps an extremely acute miter to a butt end (no spike)', () => {
    // Two nearly-parallel walls sharing V would otherwise miter to a huge spike.
    const quads = computeWallQuads(
      [pt('V', 0, 0), pt('P', 100, 1), pt('Q', 100, -1)],
      [wall('w1', 'V', 'P', 10), wall('w2', 'V', 'Q', 10)],
    );
    const w1 = quads.get('w1')!;
    // The V-end corners must stay within the miter limit (6 × halfT = 30) of V.
    const c0 = w1.corners[0];
    const c3 = w1.corners[3];
    expect(Math.hypot(c0.x, c0.y)).toBeLessThanOrEqual(30 + 1e-6);
    expect(Math.hypot(c3.x, c3.y)).toBeLessThanOrEqual(30 + 1e-6);
  });
});

describe('wallEdgePoint', () => {
  const a: Vec2 = { x: 0, y: 0 };
  const b: Vec2 = { x: 100, y: 0 };
  const quad = computeWallQuads([pt('A', 0, 0), pt('B', 100, 0)], [wall('w', 'A', 'B', 10)]).get('w')!;

  it('returns the mitered end corners at or past the wall ends', () => {
    near(wallEdgePoint(quad, a, b, 10, 0, 1), [0, 5]);    // leftA
    near(wallEdgePoint(quad, a, b, 10, -5, 1), [0, 5]);   // before A clamps to leftA
    near(wallEdgePoint(quad, a, b, 10, 100, 1), [100, 5]); // leftB
    near(wallEdgePoint(quad, a, b, 10, 999, -1), [100, -5]); // past B clamps to rightB
  });

  it('returns square offset points in the interior', () => {
    near(wallEdgePoint(quad, a, b, 10, 50, 1), [50, 5]);
    near(wallEdgePoint(quad, a, b, 10, 50, -1), [50, -5]);
  });
});
