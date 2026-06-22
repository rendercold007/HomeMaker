import { describe, it, expect } from 'vitest';
import {
  createInitialPlan,
  drawWall,
  addWall,
  movePoint,
  deleteWall,
  deletePoint,
} from './planEdits';
import type { ID, Plan } from './types';

/** Deterministic id generator for assertions: p0, p1, p2, ... */
function counter(prefix = 'id'): () => ID {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function freshPlan(): { plan: Plan; floorId: ID } {
  const plan = createInitialPlan(counter('plan'));
  return { plan, floorId: plan.floors[0]!.id };
}

/** Build a closed square via chained drawWall calls. Returns final plan. */
function square(plan: Plan, floorId: ID, gen: () => ID): Plan {
  let p = plan;
  const r1 = drawWall(p, floorId, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, gen);
  p = r1.plan;
  const r2 = drawWall(p, floorId, { id: r1.endId, x: 100, y: 0 }, { x: 100, y: 100 }, 10, gen);
  p = r2.plan;
  const r3 = drawWall(p, floorId, { id: r2.endId, x: 100, y: 100 }, { x: 0, y: 100 }, 10, gen);
  p = r3.plan;
  const r4 = drawWall(
    p,
    floorId,
    { id: r3.endId, x: 0, y: 100 },
    { id: r1.startId, x: 0, y: 0 },
    10,
    gen,
  );
  return r4.plan;
}

describe('createInitialPlan', () => {
  it('has one empty floor and cm units', () => {
    const { plan } = freshPlan();
    expect(plan.units).toBe('cm');
    expect(plan.floors).toHaveLength(1);
    expect(plan.floors[0]!.walls).toEqual([]);
  });
});

describe('drawWall', () => {
  it('creates two points and a wall from scratch', () => {
    const { plan, floorId } = freshPlan();
    const { plan: next } = drawWall(
      plan,
      floorId,
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      10,
      counter('g'),
    );
    const floor = next.floors[0]!;
    expect(floor.points).toHaveLength(2);
    expect(floor.walls).toHaveLength(1);
  });

  it('reuses an existing point id when chaining', () => {
    const { plan, floorId } = freshPlan();
    const gen = counter('g');
    const r1 = drawWall(plan, floorId, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, gen);
    const r2 = drawWall(
      r1.plan,
      floorId,
      { id: r1.endId, x: 100, y: 0 },
      { x: 100, y: 100 },
      10,
      gen,
    );
    const floor = r2.plan.floors[0]!;
    expect(floor.points).toHaveLength(3); // shared midpoint, not 4
    expect(floor.walls).toHaveLength(2);
  });

  it('does not mutate the input plan', () => {
    const { plan, floorId } = freshPlan();
    drawWall(plan, floorId, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, counter('g'));
    expect(plan.floors[0]!.walls).toHaveLength(0);
  });
});

describe('addWall', () => {
  it('refuses a degenerate wall (a === b)', () => {
    const { plan, floorId } = freshPlan();
    const gen = counter('g');
    const r = drawWall(plan, floorId, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, gen);
    const before = r.plan.floors[0]!.walls.length;
    const after = addWall(r.plan, floorId, r.startId, r.startId, 10, gen);
    expect(after.floors[0]!.walls).toHaveLength(before);
  });

  it('refuses a duplicate wall between the same pair', () => {
    const { plan, floorId } = freshPlan();
    const gen = counter('g');
    const r = drawWall(plan, floorId, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, gen);
    const dup = addWall(r.plan, floorId, r.startId, r.endId, 10, gen);
    expect(dup.floors[0]!.walls).toHaveLength(1);
  });
});

describe('rooms are kept derived', () => {
  it('a closed square yields one room', () => {
    const { plan, floorId } = freshPlan();
    const done = square(plan, floorId, counter('g'));
    expect(done.floors[0]!.rooms).toHaveLength(1);
    expect(done.floors[0]!.rooms[0]!.areaCm2).toBe(10000);
  });

  it('deleting a wall opens the room back up', () => {
    const { plan, floorId } = freshPlan();
    const done = square(plan, floorId, counter('g'));
    const wallId = done.floors[0]!.walls[0]!.id;
    const opened = deleteWall(done, floorId, wallId);
    expect(opened.floors[0]!.rooms).toHaveLength(0);
    expect(opened.floors[0]!.walls).toHaveLength(3);
  });
});

describe('movePoint', () => {
  it('updates coordinates and recomputes area', () => {
    const { plan, floorId } = freshPlan();
    const done = square(plan, floorId, counter('g'));
    // Move the corner at (100,100) out to (200,100), enlarging the room.
    const corner = done.floors[0]!.points.find((p) => p.x === 100 && p.y === 100)!;
    const moved = movePoint(done, floorId, corner.id, 200, 100);
    const p = moved.floors[0]!.points.find((pt) => pt.id === corner.id)!;
    expect(p).toMatchObject({ x: 200, y: 100 });
    expect(moved.floors[0]!.rooms[0]!.areaCm2).toBeGreaterThan(10000);
  });
});

describe('deletePoint', () => {
  it('removes the point and its attached walls', () => {
    const { plan, floorId } = freshPlan();
    const done = square(plan, floorId, counter('g'));
    const corner = done.floors[0]!.points[0]!;
    const after = deletePoint(done, floorId, corner.id);
    expect(after.floors[0]!.points.find((p) => p.id === corner.id)).toBeUndefined();
    // The corner touched 2 walls; both should be gone.
    expect(after.floors[0]!.walls).toHaveLength(2);
    expect(after.floors[0]!.rooms).toHaveLength(0);
  });
});

describe('deleteWall orphan cleanup', () => {
  it('drops points left with no walls', () => {
    const { plan, floorId } = freshPlan();
    const { plan: next, startId } = drawWall(
      plan,
      floorId,
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      10,
      counter('g'),
    );
    const wallId = next.floors[0]!.walls[0]!.id;
    const after = deleteWall(next, floorId, wallId);
    expect(after.floors[0]!.walls).toHaveLength(0);
    expect(after.floors[0]!.points).toHaveLength(0); // both orphans removed
    expect(startId).toBeDefined();
  });
});
