import { describe, it, expect } from 'vitest';
import {
  classifyRoom,
  getCompassDirection,
  getRoomCentroid,
  checkVastu,
  type Direction,
} from './vastu';
import type { Floor, Plan, Plot, Point, Room, Wall } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlot(widthCm = 1000, depthCm = 1000, entrance: Plot['entrance'] = 'N'): Plot {
  return {
    widthCm,
    depthCm,
    shape: 'rectangular',
    entrance,
    setbacks: { front: 150, rear: 150, left: 90, right: 90 },
  };
}

/**
 * Build a floor containing a single room whose wall-endpoint centroid lands
 * exactly at (cx, cy). The room is a 2 × 2 cm square around that centroid.
 */
function makeFloor(name: string, cx: number, cy: number, suffix = '0'): Floor {
  const pts: Point[] = [
    { id: `pa${suffix}`, x: cx - 1, y: cy - 1 },
    { id: `pb${suffix}`, x: cx + 1, y: cy - 1 },
    { id: `pc${suffix}`, x: cx + 1, y: cy + 1 },
    { id: `pd${suffix}`, x: cx - 1, y: cy + 1 },
  ];
  const walls: Wall[] = [
    { id: `wa${suffix}`, a: `pa${suffix}`, b: `pb${suffix}`, thickness: 10 },
    { id: `wb${suffix}`, a: `pb${suffix}`, b: `pc${suffix}`, thickness: 10 },
    { id: `wc${suffix}`, a: `pc${suffix}`, b: `pd${suffix}`, thickness: 10 },
    { id: `wd${suffix}`, a: `pd${suffix}`, b: `pa${suffix}`, thickness: 10 },
  ];
  const room: Room = {
    id: `room${suffix}`,
    wallIds: walls.map((w) => w.id),
    name,
    areaCm2: 4,
  };
  return {
    id: `floor${suffix}`,
    level: 0,
    points: pts,
    walls,
    openings: [],
    rooms: [room],
    furniture: [],
  };
}

function makePlan(
  floors: Floor[],
  mode: Plan['vastu']['mode'] = 'strict',
  plot?: Plot,
): Plan {
  return {
    id: 'plan0',
    name: 'Test',
    units: 'cm',
    plot: plot ?? makePlot(),
    floors,
    vastu: { mode },
  };
}

// ---------------------------------------------------------------------------
// classifyRoom
// ---------------------------------------------------------------------------

describe('classifyRoom', () => {
  it.each([
    ['Kitchen', 'kitchen'],
    ['Modular Kitchen', 'kitchen'],
    ['Pooja Room', 'pooja'],
    ['Mandir', 'pooja'],
    ['Master Bedroom', 'master_bedroom'],
    ['Master', 'master_bedroom'],
    ['Bedroom', 'bedroom'],
    ['Guest Room', 'bedroom'],
    ['Living Room', 'living'],
    ['Drawing Hall', 'living'],
    ['Bathroom', 'bathroom'],
    ['Toilet', 'bathroom'],
    ['WC', 'bathroom'],
    ['Study', 'study'],
    ['Home Office', 'study'],
    ['Dining Room', 'dining'],
    ['Store', 'storage'],
    ['Utility', 'storage'],
    ['Staircase', 'staircase'],
    ['Garage', 'garage'],
    ['Parking', 'garage'],
    ['Balcony', 'unknown'],
    ['Room', 'unknown'],
  ] as const)('classifies %s as %s', (name, expected) => {
    expect(classifyRoom(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getCompassDirection
// ---------------------------------------------------------------------------

describe('getCompassDirection', () => {
  const plot = makePlot(1000, 1000);
  // Centre of plot is (500, 500).

  it.each([
    [500, 100, 'N'],    // directly above centre
    [900, 100, 'NE'],   // top-right
    [900, 500, 'E'],    // directly right
    [900, 900, 'SE'],   // bottom-right
    [500, 900, 'S'],    // directly below centre
    [100, 900, 'SW'],   // bottom-left
    [100, 500, 'W'],    // directly left
    [100, 100, 'NW'],   // top-left
  ] as [number, number, Direction][])('(%i, %i) → %s', (cx, cy, expected) => {
    expect(getCompassDirection(cx, cy, plot)).toBe(expected);
  });

  it('does not crash when centroid is exactly at plot centre', () => {
    expect(() => getCompassDirection(500, 500, plot)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getRoomCentroid
// ---------------------------------------------------------------------------

describe('getRoomCentroid', () => {
  it('returns the average of room corner points', () => {
    const floor = makeFloor('Kitchen', 300, 700);
    const room = floor.rooms[0]!;
    const c = getRoomCentroid(room, floor);
    expect(c.x).toBeCloseTo(300);
    expect(c.y).toBeCloseTo(700);
  });

  it('returns (0, 0) for a room with no matching wall points', () => {
    const room: Room = { id: 'r', wallIds: ['nonexistent'], name: 'X', areaCm2: 0 };
    const floor: Floor = {
      id: 'f',
      level: 0,
      points: [],
      walls: [],
      openings: [],
      rooms: [room],
      furniture: [],
    };
    expect(getRoomCentroid(room, floor)).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// checkVastu — mode: 'off'
// ---------------------------------------------------------------------------

describe("checkVastu with mode 'off'", () => {
  it('returns zero violations regardless of room placement', () => {
    // Kitchen placed in NW — wrong per strict rules, but mode is off.
    const floor = makeFloor('Kitchen', 100, 100); // NW region
    const plan = makePlan([floor], 'off');
    const report = checkVastu(plan);
    expect(report.violations).toHaveLength(0);
    expect(report.score).toBe(100);
    expect(report.checkedRooms).toBe(0);
    expect(report.mode).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// checkVastu — correct placement
// ---------------------------------------------------------------------------

describe('checkVastu correct placements (strict)', () => {
  const plot = makePlot(1000, 1000);

  it('kitchen in SE → no violation', () => {
    // SE region: cx > 500, cy > 500, e.g. (750, 750)
    const floor = makeFloor('Kitchen', 750, 750);
    const plan = makePlan([floor], 'strict', plot);
    expect(checkVastu(plan).violations).toHaveLength(0);
    expect(checkVastu(plan).score).toBe(100);
  });

  it('pooja room in NE → no violation', () => {
    // NE: cx > 500, cy < 500, e.g. (750, 250)
    const floor = makeFloor('Pooja Room', 750, 250);
    const plan = makePlan([floor], 'strict', plot);
    expect(checkVastu(plan).violations).toHaveLength(0);
  });

  it('master bedroom in SW → no violation', () => {
    const floor = makeFloor('Master Bedroom', 250, 750);
    const plan = makePlan([floor], 'strict', plot);
    expect(checkVastu(plan).violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkVastu — wrong placement
// ---------------------------------------------------------------------------

describe('checkVastu wrong placements (strict)', () => {
  const plot = makePlot(1000, 1000);

  it('kitchen in NE → one error violation', () => {
    const floor = makeFloor('Kitchen', 750, 250); // NE
    const plan = makePlan([floor], 'strict', plot);
    const report = checkVastu(plan);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]!.severity).toBe('error');
    expect(report.violations[0]!.actualDirection).toBe('NE');
    expect(report.violations[0]!.roomType).toBe('kitchen');
    expect(report.score).toBe(0);
  });

  it('violation message names the room and allowed directions', () => {
    const floor = makeFloor('Kitchen', 750, 250);
    const plan = makePlan([floor], 'strict', plot);
    const msg = checkVastu(plan).violations[0]!.message;
    expect(msg).toMatch(/Kitchen/);
    expect(msg).toMatch(/SE|NW/);
  });
});

// ---------------------------------------------------------------------------
// checkVastu — loose mode
// ---------------------------------------------------------------------------

describe('checkVastu loose mode', () => {
  const plot = makePlot(1000, 1000);

  it('kitchen one octant away from SE (i.e. in S) → no violation in loose mode', () => {
    // S: cx ≈ 500, cy > 500 — adjacent to SE
    const floor = makeFloor('Kitchen', 500, 800);
    const strictPlan = makePlan([floor], 'strict', plot);
    const loosePlan = makePlan([floor], 'loose', plot);
    // Strict: should flag (S is not SE or NW)
    expect(checkVastu(strictPlan).violations).toHaveLength(1);
    // Loose: S is adjacent to SE, so expanded set includes it
    expect(checkVastu(loosePlan).violations).toHaveLength(0);
  });

  it('loose violations are warnings, not errors', () => {
    // Kitchen in NE: far from allowed, even loose
    const floor = makeFloor('Kitchen', 750, 250);
    const plan = makePlan([floor], 'loose', plot);
    const report = checkVastu(plan);
    if (report.violations.length > 0) {
      expect(report.violations[0]!.severity).toBe('warning');
    }
  });
});

// ---------------------------------------------------------------------------
// checkVastu — score computation
// ---------------------------------------------------------------------------

describe('checkVastu score', () => {
  const plot = makePlot(1000, 1000);

  it('100 when no rooms to check', () => {
    const emptyFloor: Floor = {
      id: 'f0',
      level: 0,
      points: [],
      walls: [],
      openings: [],
      rooms: [],
      furniture: [],
    };
    expect(checkVastu(makePlan([emptyFloor], 'strict', plot)).score).toBe(100);
  });

  it('100 when all rooms comply', () => {
    const floor = makeFloor('Kitchen', 750, 750); // SE
    expect(checkVastu(makePlan([floor], 'strict', plot)).score).toBe(100);
  });

  it('0 when the single checked room violates', () => {
    const floor = makeFloor('Kitchen', 750, 250); // NE — wrong
    expect(checkVastu(makePlan([floor], 'strict', plot)).score).toBe(0);
  });

  it('unknown rooms do not count toward checkedRooms or violations', () => {
    const floor = makeFloor('Balcony', 750, 250);
    const report = checkVastu(makePlan([floor], 'strict', plot));
    expect(report.checkedRooms).toBe(0);
    expect(report.violations).toHaveLength(0);
    expect(report.score).toBe(100);
  });
});
