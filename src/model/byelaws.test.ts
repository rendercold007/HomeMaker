import { describe, it, expect } from 'vitest';
import {
  getBuildableZone,
  checkSetbacks,
  checkGroundCoverage,
  checkFAR,
  checkByelaws,
} from './byelaws';
import type { Floor, Plan, Plot, Point, Room } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlot(
  widthCm = 1000,
  depthCm = 1000,
  entrance: Plot['entrance'] = 'N',
  setbacks = { front: 100, rear: 80, left: 60, right: 40 },
): Plot {
  return { widthCm, depthCm, shape: 'rectangular', entrance, setbacks };
}

function makePoint(id: string, x: number, y: number): Point {
  return { id, x, y };
}

function makeFloor(
  points: Point[],
  rooms: Room[] = [],
  level = 0,
): Floor {
  return { id: `f${level}`, level, points, walls: [], openings: [], rooms, furniture: [] };
}

function makeRoom(id: string, areaCm2: number): Room {
  return { id, wallIds: [], name: id, type: 'other', areaCm2 };
}

function cleanPlan(floors: Floor[], plot?: Plot): Plan {
  return {
    id: 'p0',
    name: 'Test',
    units: 'cm',
    plot: plot ?? makePlot(),
    floors,
  };
}

// ---------------------------------------------------------------------------
// getBuildableZone
// ---------------------------------------------------------------------------

describe('getBuildableZone', () => {
  const setbacks = { front: 100, rear: 80, left: 60, right: 40 };

  it('entrance N: front = top, left = West', () => {
    const plot = makePlot(1000, 1000, 'N', setbacks);
    const zone = getBuildableZone(plot);
    // yMin = front=100, yMax = 1000-rear=920, xMin = left=60, xMax = 1000-right=960
    expect(zone).toEqual({ xMin: 60, xMax: 960, yMin: 100, yMax: 920 });
  });

  it('entrance S: front = bottom, left = East', () => {
    const plot = makePlot(1000, 1000, 'S', setbacks);
    const zone = getBuildableZone(plot);
    // front=bottom: yMax = 1000-100=900, rear=top: yMin = 80
    // left=East: xMax = 1000-60=940, right=West: xMin = 40
    expect(zone).toEqual({ xMin: 40, xMax: 940, yMin: 80, yMax: 900 });
  });

  it('entrance E: front = right, left = North', () => {
    const plot = makePlot(1000, 1000, 'E', setbacks);
    const zone = getBuildableZone(plot);
    // front=right: xMax = 1000-100=900, rear=left: xMin = 80
    // left=North(top): yMin = 60, right=South: yMax = 1000-40=960
    expect(zone).toEqual({ xMin: 80, xMax: 900, yMin: 60, yMax: 960 });
  });

  it('entrance W: front = left, left = South', () => {
    const plot = makePlot(1000, 1000, 'W', setbacks);
    const zone = getBuildableZone(plot);
    // front=left: xMin = 100, rear=right: xMax = 1000-80=920
    // left=South: yMax = 1000-60=940, right=North: yMin = 40
    expect(zone).toEqual({ xMin: 100, xMax: 920, yMin: 40, yMax: 940 });
  });
});

// ---------------------------------------------------------------------------
// checkSetbacks
// ---------------------------------------------------------------------------

describe('checkSetbacks', () => {
  const plot = makePlot(1000, 1000, 'N'); // zone: x[60,960] y[100,920]

  it('point inside buildable zone → no violation', () => {
    const floor = makeFloor([makePoint('p1', 500, 500)]);
    const result = checkSetbacks(floor, plot);
    expect(result.violations).toHaveLength(0);
    expect(result.pointIds).toHaveLength(0);
  });

  it('point in top setback zone (y < 100) → violation', () => {
    const floor = makeFloor([makePoint('p1', 500, 50)]);
    const result = checkSetbacks(floor, plot);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.rule).toBe('setback');
    expect(result.pointIds).toContain('p1');
  });

  it('point in left setback zone (x < 60) → violation', () => {
    const floor = makeFloor([makePoint('p1', 30, 500)]);
    const result = checkSetbacks(floor, plot);
    expect(result.pointIds).toContain('p1');
  });

  it('point on exact boundary (y = 100) is inside → no violation', () => {
    const floor = makeFloor([makePoint('p1', 500, 100)]);
    expect(checkSetbacks(floor, plot).violations).toHaveLength(0);
  });

  it('multiple violating points → single violation entry with count', () => {
    const floor = makeFloor([
      makePoint('p1', 10, 10),
      makePoint('p2', 500, 500), // ok
      makePoint('p3', 995, 500), // x > 960
    ]);
    const result = checkSetbacks(floor, plot);
    expect(result.violations).toHaveLength(1);
    expect(result.pointIds).toHaveLength(2);
    expect(result.violations[0]!.actual).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkGroundCoverage
// ---------------------------------------------------------------------------

describe('checkGroundCoverage', () => {
  // Plot 1000×1000 = 1_000_000 cm² (= 100 sqm, well below 750 sqm threshold → limit 60%)
  const plot = makePlot(1000, 1000, 'N');

  it('coverage at 50% (below 60% limit) → no violation', () => {
    const floor = makeFloor([], [makeRoom('r1', 500_000)]);
    const result = checkGroundCoverage([floor], plot);
    expect(result.violations).toHaveLength(0);
    expect(result.coveragePercent).toBe(50);
  });

  it('coverage exactly at 60% limit → no violation', () => {
    const floor = makeFloor([], [makeRoom('r1', 600_000)]);
    expect(checkGroundCoverage([floor], plot).violations).toHaveLength(0);
  });

  it('coverage above 60% → warning violation', () => {
    const floor = makeFloor([], [makeRoom('r1', 700_000)]);
    const result = checkGroundCoverage([floor], plot);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.rule).toBe('ground_coverage');
    expect(result.violations[0]!.severity).toBe('warning');
    expect(result.coveragePercent).toBeGreaterThan(60);
  });

  it('large plot (> 750 sqm) has stricter 50% limit', () => {
    // 9000×9000 = 81_000_000 cm² = 8100 sqm (> 750 sqm)
    const largePlot = makePlot(9000, 9000, 'N');
    // 55% of 81_000_000 = 44_550_000 — over 50% limit
    const floor = makeFloor([], [makeRoom('r1', 44_550_000)]);
    expect(checkGroundCoverage([floor], largePlot).violations).toHaveLength(1);
  });

  it('no ground floor → 0% coverage, no violation', () => {
    const upper: Floor = { id: 'f1', level: 1, points: [], walls: [], openings: [], rooms: [makeRoom('r1', 500_000)], furniture: [] };
    expect(checkGroundCoverage([upper], plot).coveragePercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkFAR
// ---------------------------------------------------------------------------

describe('checkFAR', () => {
  const plot = makePlot(1000, 1000); // 1_000_000 cm²

  it('FAR 1.0 (within 1.75) → no violation', () => {
    const floor = makeFloor([], [makeRoom('r1', 1_000_000)]);
    const result = checkFAR([floor], plot);
    expect(result.violations).toHaveLength(0);
    expect(result.far).toBe(1.0);
  });

  it('FAR exactly 1.75 → no violation', () => {
    const floor = makeFloor([], [makeRoom('r1', 1_750_000)]);
    expect(checkFAR([floor], plot).violations).toHaveLength(0);
  });

  it('two floors pushing FAR over 1.75 → violation', () => {
    const f0 = makeFloor([], [makeRoom('r1', 1_000_000)], 0);
    const f1: Floor = { ...makeFloor([], [makeRoom('r2', 1_000_000)], 1), id: 'f1', level: 1 };
    const result = checkFAR([f0, f1], plot);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.rule).toBe('far');
    expect(result.far).toBeCloseTo(2.0);
  });
});

// ---------------------------------------------------------------------------
// checkByelaws integration
// ---------------------------------------------------------------------------

describe('checkByelaws integration', () => {
  it('clean plan with no rooms and no points → zero violations', () => {
    const plan = cleanPlan([makeFloor([])]);
    const report = checkByelaws(plan);
    expect(report.violations).toHaveLength(0);
    expect(report.far).toBe(0);
    expect(report.groundCoveragePercent).toBe(0);
    expect(report.setbackViolatingPoints).toHaveLength(0);
  });

  it('aggregates violations from all three checks', () => {
    const plot = makePlot(1000, 1000, 'N'); // zone y[100,920]
    // Point in setback + rooms over coverage limit
    const floor = makeFloor(
      [makePoint('p1', 500, 10)], // setback violation
      [makeRoom('r1', 800_000)],  // 80% > 60% → coverage violation
    );
    const plan = cleanPlan([floor], plot);
    const report = checkByelaws(plan);
    const rules = report.violations.map((v) => v.rule);
    expect(rules).toContain('setback');
    expect(rules).toContain('ground_coverage');
  });
});
