import { describe, it, expect } from 'vitest';
import type { Floor, Opening, Wall } from '../../model/types';
import { buildColliders, resolveCollisions, PLAYER_R } from './walkCollision';

/** A floor with one horizontal wall from (0,0)→(400,0) cm, plus given openings. */
function floorWithWall(openings: Opening[] = [], thickness = 10): Floor {
  const wall: Wall = { id: 'w', a: 'p0', b: 'p1', thickness, height: 280 };
  return {
    id: 'f', level: 0,
    points: [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 400, y: 0 }],
    walls: [wall],
    openings,
    rooms: [],
    furniture: [],
  };
}

const door = (offset: number, width: number): Opening =>
  ({ id: 'd', wallId: 'w', kind: 'door', offset, width });
const window_ = (offset: number, width: number): Opening =>
  ({ id: 'win', wallId: 'w', kind: 'window', offset, width });

describe('buildColliders', () => {
  it('a solid wall becomes one collider spanning its full length (cm→m)', () => {
    const cols = buildColliders(floorWithWall());
    expect(cols).toHaveLength(1);
    expect(cols[0]!.ax).toBeCloseTo(0);
    expect(cols[0]!.bx).toBeCloseTo(4); // 400 cm → 4 m
    // radius = half thickness (10cm→0.05m) + player radius
    expect(cols[0]!.radius).toBeCloseTo(0.05 + PLAYER_R);
  });

  it('a doorway splits the wall into two colliders, leaving the gap open', () => {
    const cols = buildColliders(floorWithWall([door(150, 100)]));
    expect(cols).toHaveLength(2);
    expect(cols[0]!.ax).toBeCloseTo(0);
    expect(cols[0]!.bx).toBeCloseTo(1.5);   // up to the door
    expect(cols[1]!.ax).toBeCloseTo(2.5);   // resumes after the door
    expect(cols[1]!.bx).toBeCloseTo(4);
  });

  it('a window does NOT split the wall (glass still blocks)', () => {
    const cols = buildColliders(floorWithWall([window_(150, 100)]));
    expect(cols).toHaveLength(1);
    expect(cols[0]!.bx).toBeCloseTo(4);
  });

  it('a door spanning the whole wall removes it entirely', () => {
    const cols = buildColliders(floorWithWall([door(0, 400)]));
    expect(cols).toHaveLength(0);
  });
});

describe('resolveCollisions', () => {
  const cols = buildColliders(floorWithWall()); // wall along z=0, radius 0.3

  it('leaves a position outside the radius untouched', () => {
    const [x, z] = resolveCollisions(2, 0.5, cols);
    expect(x).toBeCloseTo(2);
    expect(z).toBeCloseTo(0.5);
  });

  it('pushes a penetrating position out to exactly the collision radius', () => {
    const [x, z] = resolveCollisions(2, 0.1, cols);
    expect(x).toBeCloseTo(2);          // along-wall component preserved (slides)
    expect(z).toBeCloseTo(0.3);        // pushed out to the radius
  });

  it('pushes out on whichever side the player approached from', () => {
    const [, z] = resolveCollisions(2, -0.1, cols);
    expect(z).toBeCloseTo(-0.3);
  });

  it('resolves a corner formed by two perpendicular walls', () => {
    // Add a vertical wall along x=0 (from (0,0)→(0,400)).
    const corner = buildColliders({
      ...floorWithWall(),
      points: [
        { id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 400, y: 0 },
        { id: 'p2', x: 0, y: 400 },
      ],
      walls: [
        { id: 'w', a: 'p0', b: 'p1', thickness: 10, height: 280 },
        { id: 'w2', a: 'p0', b: 'p2', thickness: 10, height: 280 },
      ],
    });
    const [x, z] = resolveCollisions(0.1, 0.1, corner);
    expect(x).toBeGreaterThanOrEqual(0.3 - 1e-6);
    expect(z).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });
});
