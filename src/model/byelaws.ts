/**
 * BBMP (Bengaluru) bye-law checks — pure module, no React imports.
 *
 * Checks three things:
 *   1. Setbacks: no wall points may fall inside the mandatory setback zone.
 *   2. Ground coverage: ground-floor room area ≤ allowed % of plot area.
 *   3. FAR (Floor Area Ratio): total built area / plot area ≤ 1.75.
 *
 * These are simplified approximations of the actual BBMP 2003 bye-laws,
 * sufficient for v1 constraint feedback. Room areas are used as a proxy for
 * built area (wall thickness not counted).
 */
import type { Floor, ID, Plan, Plot } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GROUND_COVERAGE_SMALL = 0.6; // plots ≤ 750 sqm
const MAX_GROUND_COVERAGE_LARGE = 0.5; // plots > 750 sqm
const SMALL_PLOT_THRESHOLD_CM2 = 750 * 10_000; // 750 sqm → cm²
const MAX_FAR = 1.75;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ByelawViolation {
  id: string;
  rule: 'setback' | 'ground_coverage' | 'far';
  severity: 'error' | 'warning';
  message: string;
  actual: number;
  limit: number;
  unit: string;
}

export interface ByelawReport {
  violations: ByelawViolation[];
  groundCoveragePercent: number;
  far: number;
  setbackViolatingPoints: ID[];
}

// ---------------------------------------------------------------------------
// Buildable zone
// ---------------------------------------------------------------------------

export interface BuildableZone {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Compute the inner rectangle that setbacks leave buildable.
 * The `entrance` direction determines which plot edge is the "front" (road side).
 * When facing the entrance direction:
 *   front = road-facing edge, rear = opposite, left/right = sides.
 */
export function getBuildableZone(plot: Plot): BuildableZone {
  const { widthCm, depthCm, setbacks, entrance } = plot;
  const { front: f, rear: r, left: l, right: rt } = setbacks;

  switch (entrance) {
    case 'N': // front = top (y=0), left = West (x=0), right = East
      return { xMin: l, xMax: widthCm - rt, yMin: f, yMax: depthCm - r };
    case 'S': // front = bottom (y=depthCm), left = East, right = West
      return { xMin: rt, xMax: widthCm - l, yMin: r, yMax: depthCm - f };
    case 'E': // front = right (x=widthCm), left = North (y=0), right = South
      return { xMin: r, xMax: widthCm - f, yMin: l, yMax: depthCm - rt };
    case 'W': // front = left (x=0), left = South, right = North
      return { xMin: f, xMax: widthCm - r, yMin: rt, yMax: depthCm - l };
  }
}

// ---------------------------------------------------------------------------
// Setback check
// ---------------------------------------------------------------------------

export function checkSetbacks(
  floor: Floor,
  plot: Plot,
): { violations: ByelawViolation[]; pointIds: ID[] } {
  const zone = getBuildableZone(plot);
  const badIds: ID[] = [];

  for (const pt of floor.points) {
    if (pt.x < zone.xMin || pt.x > zone.xMax || pt.y < zone.yMin || pt.y > zone.yMax) {
      badIds.push(pt.id);
    }
  }

  if (badIds.length === 0) return { violations: [], pointIds: [] };

  const violations: ByelawViolation[] = [
    {
      id: 'byelaw:setback',
      rule: 'setback',
      severity: 'error',
      message: `${badIds.length} wall point${badIds.length > 1 ? 's' : ''} fall inside the mandatory setback zone.`,
      actual: badIds.length,
      limit: 0,
      unit: 'points',
    },
  ];

  return { violations, pointIds: badIds };
}

// ---------------------------------------------------------------------------
// Ground coverage
// ---------------------------------------------------------------------------

/** Sum of all derived room areas on the ground floor (level 0), in cm². */
function groundFloorArea(floors: Floor[]): number {
  const ground = floors.find((f) => f.level === 0);
  if (!ground) return 0;
  return ground.rooms.reduce((sum, r) => sum + r.areaCm2, 0);
}

export function checkGroundCoverage(
  floors: Floor[],
  plot: Plot,
): { violations: ByelawViolation[]; coveragePercent: number } {
  const plotArea = plot.widthCm * plot.depthCm;
  const builtArea = groundFloorArea(floors);
  const ratio = plotArea > 0 ? builtArea / plotArea : 0;
  const coveragePercent = Math.round(ratio * 1000) / 10; // one decimal

  const limit =
    plotArea <= SMALL_PLOT_THRESHOLD_CM2
      ? MAX_GROUND_COVERAGE_SMALL
      : MAX_GROUND_COVERAGE_LARGE;

  if (ratio <= limit) return { violations: [], coveragePercent };

  return {
    coveragePercent,
    violations: [
      {
        id: 'byelaw:ground_coverage',
        rule: 'ground_coverage',
        severity: 'warning',
        message: `Ground coverage ${coveragePercent}% exceeds the ${limit * 100}% BBMP limit.`,
        actual: coveragePercent,
        limit: limit * 100,
        unit: '%',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// FAR
// ---------------------------------------------------------------------------

/** Total room area across all floors, in cm². */
function totalBuiltArea(floors: Floor[]): number {
  return floors.reduce(
    (sum, fl) => sum + fl.rooms.reduce((s, r) => s + r.areaCm2, 0),
    0,
  );
}

export function checkFAR(
  floors: Floor[],
  plot: Plot,
): { violations: ByelawViolation[]; far: number } {
  const plotArea = plot.widthCm * plot.depthCm;
  const builtArea = totalBuiltArea(floors);
  const far = plotArea > 0 ? Math.round((builtArea / plotArea) * 100) / 100 : 0;

  if (far <= MAX_FAR) return { violations: [], far };

  return {
    far,
    violations: [
      {
        id: 'byelaw:far',
        rule: 'far',
        severity: 'warning',
        message: `FAR ${far.toFixed(2)} exceeds the BBMP limit of ${MAX_FAR}.`,
        actual: far,
        limit: MAX_FAR,
        unit: 'ratio',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

export function checkByelaws(plan: Plan): ByelawReport {
  const { floors, plot } = plan;
  const floor0 = floors[0];

  const setbackResult = floor0 ? checkSetbacks(floor0, plot) : { violations: [], pointIds: [] };
  const coverageResult = checkGroundCoverage(floors, plot);
  const farResult = checkFAR(floors, plot);

  return {
    violations: [
      ...setbackResult.violations,
      ...coverageResult.violations,
      ...farResult.violations,
    ],
    groundCoveragePercent: coverageResult.coveragePercent,
    far: farResult.far,
    setbackViolatingPoints: setbackResult.pointIds,
  };
}
