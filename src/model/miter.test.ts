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

  it('a T-junction: the through-wall stays straight, the stem butts in cleanly', () => {
    // The dominant junction in every generated plan — a perpendicular interior
    // wall (the stem) meeting a straight run (left+right collinear) at V=(0,0).
    const quads = computeWallQuads(
      [pt('A', -100, 0), pt('V', 0, 0), pt('B', 100, 0), pt('S', 0, 100)],
      [wall('left', 'A', 'V', 10), wall('right', 'V', 'B', 10), wall('stem', 'V', 'S', 10)],
    );
    const left = quads.get('left')!;
    const right = quads.get('right')!;
    const stem = quads.get('stem')!;
    // Through-side (away from the stem, y=-5): left and right meet exactly at
    // (0,-5), so the run reads as one continuous straight edge across V.
    near(left.corners[2], [0, -5]); // left rightB
    near(right.corners[3], [0, -5]); // right rightA
    // Stem-side (y=+5): each through-wall's inner corner coincides with the
    // stem's matching corner — no gap, no overlap at the reentrant corners.
    near(left.corners[1], [-5, 5]); // left leftB  == stem leftA
    near(stem.corners[0], [-5, 5]);
    near(right.corners[0], [5, 5]); // right leftA == stem rightA
    near(stem.corners[3], [5, 5]);
  });

  it('a 4-way cross: every arm miters to the central square corners', () => {
    // Four arms meeting at one point. BSP layouts offset their splits into
    // T-junctions, so generated plans never produce this — it is only reachable
    // by a hand-drawn wall. Each arm cleanly miters its end to the corners of the
    // 10×10 centre square (±halfT, ±halfT); the run-through sides stay flush.
    const quads = computeWallQuads(
      [pt('V', 0, 0), pt('N', 0, -100), pt('S', 0, 100), pt('E', 100, 0), pt('W', -100, 0)],
      [wall('n', 'V', 'N', 10), wall('s', 'V', 'S', 10), wall('e', 'V', 'E', 10), wall('w', 'V', 'W', 10)],
    );
    // North arm's V-end spans the top edge of the centre square: (5,-5)→(-5,-5).
    near(quads.get('n')!.corners[0], [5, -5]);
    near(quads.get('n')!.corners[3], [-5, -5]);
    // East arm's V-end spans the right edge: (5,5)→(5,-5).
    near(quads.get('e')!.corners[0], [5, 5]);
    near(quads.get('e')!.corners[3], [5, -5]);
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
