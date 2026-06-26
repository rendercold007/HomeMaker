import { describe, it, expect } from 'vitest';
import { createInitialPlan, addFloor } from '../../model/planEdits';
import { applyGeneratedPlan } from './applyPlan';
import type { GeneratedPlan } from './contract';

/** Fresh deterministic id generator per call (for furniture ids in the adapter). */
function ids(): () => string {
  let n = 0;
  return () => `f${n++}`;
}

/**
 * A 200×100 outer rectangle split vertically at x=100 into two 100×100 rooms.
 * Six points, seven walls — two real closed cycles for recomputeRooms to detect.
 *
 *   p0(0,0) ── p1(100,0) ── p2(200,0)
 *    │           │            │
 *   p3(0,100) ─ p4(100,100) ─ p5(200,100)
 *
 * Left room centroid ≈ (50,50), right room centroid ≈ (150,50).
 * The room metas are listed right-then-left to exercise the consuming match:
 * a naive per-room argmin would still work here, but the greedy consume is what
 * guarantees the two rooms can never both claim the same meta.
 */
function twoRoomPlan(): GeneratedPlan {
  return {
    plan: {
      points: [
        { id: 'p0', x: 0, y: 0 },
        { id: 'p1', x: 100, y: 0 },
        { id: 'p2', x: 200, y: 0 },
        { id: 'p3', x: 0, y: 100 },
        { id: 'p4', x: 100, y: 100 },
        { id: 'p5', x: 200, y: 100 },
      ],
      walls: [
        { id: 'w0', a: 'p0', b: 'p1', thickness: 10, height: 270 }, // top-left
        { id: 'w1', a: 'p1', b: 'p2', thickness: 10, height: 270 }, // top-right
        { id: 'w2', a: 'p0', b: 'p3', thickness: 10, height: 270 }, // left
        { id: 'w3', a: 'p1', b: 'p4', thickness: 10, height: 270 }, // middle divider
        { id: 'w4', a: 'p2', b: 'p5', thickness: 10, height: 270 }, // right
        { id: 'w5', a: 'p3', b: 'p4', thickness: 10, height: 270 }, // bottom-left
        { id: 'w6', a: 'p4', b: 'p5', thickness: 10, height: 270 }, // bottom-right
      ],
      openings: [
        { id: 'o0', wallId: 'w3', kind: 'door', offset: 30, width: 80 },
      ],
      furniture: [
        // roomCx/roomCy tag each item with its room centroid for roomId resolution.
        { type: 'double_bed', x: 50, y: 50, rotationDeg: 0, roomCx: 50, roomCy: 50 },
        { type: 'sofa', x: 150, y: 50, rotationDeg: 90, roomCx: 150, roomCy: 50 },
      ],
      // Listed right-room-first to prove order independence of the match.
      rooms: [
        { name: 'Living Room', type: 'living', cx: 150, cy: 50 },
        { name: 'Master Bedroom', type: 'bedroom', cx: 50, cy: 50 },
      ],
    },
  };
}

describe('applyGeneratedPlan', () => {
  it('derives exactly N rooms and names/types each from the nearest unconsumed meta', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const next = applyGeneratedPlan(plan, floorId, twoRoomPlan(), ids());
    const floor = next.floors[0]!;

    expect(floor.rooms).toHaveLength(2);

    // Centroid (50,50) is the left room → Master Bedroom; (150,50) → Living Room.
    // Each meta is consumed once, so the names are necessarily distinct.
    const names = floor.rooms.map((r) => r.name).sort();
    expect(names).toEqual(['Living Room', 'Master Bedroom']);

    const byName = new Map(floor.rooms.map((r) => [r.name, r]));
    expect(byName.get('Master Bedroom')!.type).toBe('bedroom');
    expect(byName.get('Living Room')!.type).toBe('living');

    // Geometry landed on the floor.
    expect(floor.points).toHaveLength(6);
    expect(floor.walls).toHaveLength(7);
    expect(floor.openings).toHaveLength(1);
  });

  it('does not mutate the input plan (returns a new Plan)', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;
    const before = JSON.parse(JSON.stringify(plan));

    const next = applyGeneratedPlan(plan, floorId, twoRoomPlan(), ids());

    expect(next).not.toBe(plan);
    expect(plan).toEqual(before); // input untouched
    expect(plan.floors[0]!.walls).toHaveLength(0);
  });

  it('places generated geometry/furniture on the target floor and leaves other floors untouched', () => {
    const base = createInitialPlan(ids());
    const { plan, floorId: secondFloorId } = addFloor(base, ids());
    const targetFloorId = plan.floors[0]!.id;

    const untouchedBefore = plan.floors.find((f) => f.id === secondFloorId)!;

    const next = applyGeneratedPlan(plan, targetFloorId, twoRoomPlan(), ids());

    const target = next.floors.find((f) => f.id === targetFloorId)!;
    const other = next.floors.find((f) => f.id === secondFloorId)!;

    expect(target.furniture).toHaveLength(2);
    expect(target.walls).toHaveLength(7);
    // Other floor is identical to before — no geometry, furniture, or openings leaked.
    expect(other).toEqual(untouchedBefore);
    expect(other.walls).toHaveLength(0);
    expect(other.furniture).toHaveLength(0);
  });

  it('assigns fresh ids to furniture via the id generator', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const next = applyGeneratedPlan(plan, floorId, twoRoomPlan(), ids());
    const furnitureIds = next.floors[0]!.furniture.map((f) => f.id);

    expect(furnitureIds).toEqual(['f0', 'f1']);
  });

  it('resolves each furniture item to the derived room nearest its centroid hint', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const next = applyGeneratedPlan(plan, floorId, twoRoomPlan(), ids());
    const floor = next.floors[0]!;

    const bedRoom = floor.rooms.find((r) => r.name === 'Master Bedroom')!; // centroid (50,50)
    const livingRoom = floor.rooms.find((r) => r.name === 'Living Room')!; // centroid (150,50)
    const bed = floor.furniture.find((f) => f.type === 'double_bed')!; // hint (50,50)
    const sofa = floor.furniture.find((f) => f.type === 'sofa')!; // hint (150,50)

    expect(bed.roomId).toBe(bedRoom.id);
    expect(sofa.roomId).toBe(livingRoom.id);
  });

  it('still derives rooms when the rooms meta is empty — just leaves them unnamed', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const payload = twoRoomPlan();
    payload.plan.rooms = [];

    const next = applyGeneratedPlan(plan, floorId, payload, ids());
    const floor = next.floors[0]!;

    expect(floor.rooms).toHaveLength(2);
    // recomputeRooms gives derived rooms a default name; none should be the
    // generator-supplied names since there were no metas to match.
    const names = floor.rooms.map((r) => r.name);
    expect(names).not.toContain('Living Room');
    expect(names).not.toContain('Master Bedroom');
  });
});
