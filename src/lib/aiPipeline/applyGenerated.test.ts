import { describe, it, expect } from 'vitest';
import { createInitialPlan } from '../../model/planEdits';
import { applyGeneratedFurniture } from './applyGenerated';
import type { AutoFurnishResponse } from './contract';

/** Fresh deterministic id generator per call. */
function ids(): () => string {
  let n = 0;
  return () => `f${n++}`;
}

const response: AutoFurnishResponse = {
  generated_furniture: [
    { asset_id: 'a', type: 'double_bed', position: [2.5, 0, 3.0], rotation: [0, 0, 0] },
    { asset_id: 'b', type: 'wardrobe', position: [1.0, 0, 0.7], rotation: [0, 90, 0] },
  ],
};

describe('applyGeneratedFurniture', () => {
  it('converts metres → cm (2D y = 3D z), keeps yaw, places on the target floor', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const next = applyGeneratedFurniture(plan, floorId, response, ids());

    const furniture = next.floors[0]!.furniture;
    expect(furniture).toHaveLength(2);
    expect(furniture[0]).toMatchObject({ type: 'double_bed', x: 250, y: 300, rotationDeg: 0 });
    expect(furniture[1]).toMatchObject({ type: 'wardrobe', x: 100, y: 70, rotationDeg: 90 });
  });

  it('does not mutate the input plan', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    applyGeneratedFurniture(plan, floorId, response, ids());

    expect(plan.floors[0]!.furniture).toHaveLength(0);
  });

  it('returns the input plan unchanged for an empty response', () => {
    const plan = createInitialPlan(ids());
    const floorId = plan.floors[0]!.id;

    const next = applyGeneratedFurniture(plan, floorId, { generated_furniture: [] }, ids());

    expect(next).toBe(plan);
  });
});
