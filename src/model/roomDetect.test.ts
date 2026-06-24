import { describe, it, expect } from 'vitest';
import { detectRooms, roomRing } from './roomDetect';
import { signedPolygonArea } from './geometry';
import type { Point, Wall } from './types';

/** Tiny builder: points keyed by a short label, walls as label pairs. */
function build(
  coords: Record<string, [number, number]>,
  pairs: [string, string][],
) {
  const points: Point[] = Object.entries(coords).map(([id, [x, y]]) => ({
    id,
    x,
    y,
  }));
  const walls: Wall[] = pairs.map(([a, b], i) => ({
    id: `w${i}`,
    a,
    b,
    thickness: 10,
    height: 270,
  }));
  return { points, walls };
}

describe('detectRooms', () => {
  it('finds no room for an empty graph', () => {
    expect(detectRooms([], [])).toEqual([]);
  });

  it('finds no room for an open (non-closed) chain', () => {
    const { points, walls } = build(
      { A: [0, 0], B: [100, 0], C: [100, 100] },
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    expect(detectRooms(points, walls)).toEqual([]);
  });

  it('detects a single closed square and its area', () => {
    const { points, walls } = build(
      { A: [0, 0], B: [100, 0], C: [100, 100], D: [0, 100] },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'A'],
      ],
    );
    const rooms = detectRooms(points, walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.areaCm2).toBe(10000);
    expect(rooms[0]!.wallIds).toHaveLength(4);
  });

  it('detects two rooms sharing a middle wall', () => {
    // Two unit squares side by side sharing edge B-E.
    //  A---B---C
    //  |   |   |
    //  D---E---F
    const { points, walls } = build(
      {
        A: [0, 0],
        B: [100, 0],
        C: [200, 0],
        D: [0, 100],
        E: [100, 100],
        F: [200, 100],
      },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['A', 'D'],
        ['B', 'E'],
        ['C', 'F'],
        ['D', 'E'],
        ['E', 'F'],
      ],
    );
    const rooms = detectRooms(points, walls);
    expect(rooms).toHaveLength(2);
    for (const r of rooms) expect(r.areaCm2).toBe(10000);
  });

  it('ignores a pendant wall sticking out of a closed room', () => {
    const { points, walls } = build(
      {
        A: [0, 0],
        B: [100, 0],
        C: [100, 100],
        D: [0, 100],
        E: [200, 0], // stub hanging off B
      },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'A'],
        ['B', 'E'],
      ],
    );
    const rooms = detectRooms(points, walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.areaCm2).toBe(10000);
  });

  it('produces stable ids across recomputation', () => {
    const { points, walls } = build(
      { A: [0, 0], B: [100, 0], C: [100, 100], D: [0, 100] },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'A'],
      ],
    );
    const first = detectRooms(points, walls);
    const second = detectRooms(points, walls);
    expect(first[0]!.id).toBe(second[0]!.id);
  });
});

describe('roomRing', () => {
  it('orders a convex room into a ring matching its area', () => {
    const { points, walls } = build(
      { A: [0, 0], B: [100, 0], C: [100, 100], D: [0, 100] },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'A'],
      ],
    );
    const [room] = detectRooms(points, walls);
    const ring = roomRing(room!, points, walls);
    expect(ring).toHaveLength(4);
    expect(Math.abs(signedPolygonArea(ring))).toBeCloseTo(10000, 6);
  });

  it('recovers a concave (L-shaped) room boundary without self-intersection', () => {
    // L-shape: a 200×200 square with the bottom-right 100×100 quadrant removed.
    // The concave corner at D(100,100) is exactly what a centroid-angle sort
    // scrambles — this asserts the topological walk recovers the true ring.
    const { points, walls } = build(
      {
        A: [0, 0],
        B: [200, 0],
        C: [200, 100],
        D: [100, 100],
        E: [100, 200],
        F: [0, 200],
      },
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'E'],
        ['E', 'F'],
        ['F', 'A'],
      ],
    );
    const [room] = detectRooms(points, walls);
    const ring = roomRing(room!, points, walls);
    expect(ring).toHaveLength(6);
    // True L-shape area is 30000 cm²; a scrambled ring yields a different value.
    expect(Math.abs(signedPolygonArea(ring))).toBeCloseTo(30000, 6);
  });

  it('returns [] for a room whose walls are missing', () => {
    const room = { id: 'r', wallIds: ['nope'], name: 'x', type: 'other' as const, areaCm2: 0 };
    expect(roomRing(room, [], [])).toEqual([]);
  });
});
