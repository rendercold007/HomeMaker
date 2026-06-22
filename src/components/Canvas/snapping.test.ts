import { describe, it, expect } from 'vitest';
import { snapWorldPoint, type SnapCandidate } from './snapping';

const candidates: SnapCandidate[] = [
  { id: 'p0', x: 0, y: 0 },
  { id: 'p1', x: 300, y: 0 },
];

describe('snapWorldPoint priority', () => {
  it('snaps to an existing point first (highest priority)', () => {
    const r = snapWorldPoint(
      { x: 304, y: 3 },
      { candidates, gridCm: 30, gridSnap: true, shift: false, thresholdCm: 10 },
    );
    expect(r.pointId).toBe('p1');
    expect(r).toMatchObject({ x: 300, y: 0 });
  });

  it('respects exclude so a dragged point cannot snap to itself', () => {
    const r = snapWorldPoint(
      { x: 2, y: 1 },
      {
        candidates,
        exclude: new Set(['p0']),
        gridCm: 30,
        gridSnap: true,
        shift: false,
        thresholdCm: 10,
      },
    );
    expect(r.pointId).toBeUndefined();
    expect(r).toMatchObject({ x: 0, y: 0 }); // falls through to grid
  });

  it('applies angle lock when shift is held and an anchor is given', () => {
    const r = snapWorldPoint(
      { x: 200, y: 15 },
      {
        candidates: [],
        gridCm: 30,
        gridSnap: true,
        shift: true,
        anchor: { x: 0, y: 0 },
        thresholdCm: 10,
      },
    );
    expect(r.y).toBeCloseTo(0); // locked to horizontal
    expect(r.pointId).toBeUndefined();
  });

  it('falls back to grid when nothing else applies', () => {
    const r = snapWorldPoint(
      { x: 47, y: 62 },
      { candidates: [], gridCm: 30, gridSnap: true, shift: false, thresholdCm: 10 },
    );
    expect(r).toMatchObject({ x: 60, y: 60 });
  });

  it('returns the raw point when grid snap is off and nothing matches', () => {
    const r = snapWorldPoint(
      { x: 47, y: 62 },
      { candidates: [], gridCm: 30, gridSnap: false, shift: false, thresholdCm: 10 },
    );
    expect(r).toMatchObject({ x: 47, y: 62 });
  });
});
