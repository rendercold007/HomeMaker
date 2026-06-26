import { describe, expect, it } from 'vitest';
import type { Plan } from '../../model/types';
import { recomputeRooms } from '../../model/planEdits';
import { applyEditPatch } from './applyEditPatch';
import type { EditPlanResponse, EditPatchOp } from './contract';

/** A 200x200 square room with one window and one chair; rooms derived. */
function squarePlan() {
  const floorId = 'f0';
  const base: Plan = {
    id: 'plan',
    name: 'T',
    units: 'cm',
    plot: { widthCm: 200, depthCm: 200, shape: 'rectangular', entrance: 'E', setbacks: { front: 0, rear: 0, left: 0, right: 0 } },
    floors: [
      {
        id: floorId,
        level: 0,
        points: [
          { id: 'p0', x: 0, y: 0 },
          { id: 'p1', x: 200, y: 0 },
          { id: 'p2', x: 200, y: 200 },
          { id: 'p3', x: 0, y: 200 },
        ],
        walls: [
          { id: 'w0', a: 'p0', b: 'p1', thickness: 10, height: 270 },
          { id: 'w1', a: 'p1', b: 'p2', thickness: 10, height: 270 },
          { id: 'w2', a: 'p2', b: 'p3', thickness: 10, height: 270 },
          { id: 'w3', a: 'p3', b: 'p0', thickness: 10, height: 270 },
        ],
        openings: [{ id: 'o0', wallId: 'w0', kind: 'window', offset: 40, width: 120 }],
        rooms: [],
        furniture: [{ id: 'fy', type: 'chair', x: 100, y: 100, rotationDeg: 0 }],
      },
    ],
  };
  const plan = recomputeRooms(base);
  return { plan, floorId, roomId: plan.floors[0]!.rooms[0]!.id };
}

function res(...patch: EditPatchOp[]): EditPlanResponse {
  return { patch, summary: 'ok', warnings: [] };
}

const floor = (p: Plan) => p.floors[0]!;

describe('applyEditPatch', () => {
  it('adds furniture with its roomId', () => {
    const { plan, floorId, roomId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res({
      op: 'addFurniture',
      items: [{ type: 'sofa', x: 50, y: 50, rotationDeg: 90, roomId }],
    }));
    const f = floor(out).furniture;
    expect(f).toHaveLength(2);
    const sofa = f.find((x) => x.type === 'sofa')!;
    expect(sofa.roomId).toBe(roomId);
    expect(sofa.x).toBe(50);
    expect(sofa.rotationDeg).toBe(90);
  });

  it('removes furniture by id', () => {
    const { plan, floorId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res({ op: 'removeFurniture', ids: ['fy'] }));
    expect(floor(out).furniture).toHaveLength(0);
  });

  it('adds an opening to a real wall', () => {
    const { plan, floorId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res({
      op: 'addOpening',
      openings: [{ wallId: 'w1', kind: 'door', offset: 50, width: 90 }],
    }));
    const openings = floor(out).openings;
    expect(openings).toHaveLength(2);
    expect(openings.some((o) => o.wallId === 'w1' && o.kind === 'door')).toBe(true);
  });

  it('removes an opening by id', () => {
    const { plan, floorId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res({ op: 'removeOpening', ids: ['o0'] }));
    expect(floor(out).openings).toHaveLength(0);
  });

  it('renames and retypes a room by id', () => {
    const { plan, floorId, roomId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res(
      { op: 'setRoomName', roomId, name: 'Lounge' },
      { op: 'setRoomType', roomId, type: 'living' },
    ));
    const room = floor(out).rooms.find((r) => r.id === roomId)!;
    expect(room.name).toBe('Lounge');
    expect(room.type).toBe('living');
  });

  it('coerces an unknown room type to "other"', () => {
    const { plan, floorId, roomId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res({ op: 'setRoomType', roomId, type: 'dungeon' }));
    expect(floor(out).rooms.find((r) => r.id === roomId)!.type).toBe('other');
  });

  it('applies multiple ops in one patch (remove then add)', () => {
    const { plan, floorId, roomId } = squarePlan();
    const out = applyEditPatch(plan, floorId, res(
      { op: 'removeFurniture', ids: ['fy'] },
      { op: 'addFurniture', items: [{ type: 'sofa', x: 60, y: 60, rotationDeg: 0, roomId }] },
    ));
    const f = floor(out).furniture;
    expect(f).toHaveLength(1);
    expect(f[0]!.type).toBe('sofa');
  });

  it('does not mutate the input plan', () => {
    const { plan, floorId } = squarePlan();
    const before = JSON.stringify(plan);
    applyEditPatch(plan, floorId, res({ op: 'removeFurniture', ids: ['fy'] }));
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('ignores an unrecognised op (forward-compatible)', () => {
    const { plan, floorId } = squarePlan();
    const out = applyEditPatch(plan, floorId, { patch: [{ op: 'frobnicate' } as unknown as EditPatchOp], summary: '', warnings: [] });
    expect(out).toBe(plan); // unchanged reference — nothing applied
  });

  it('drops a rejected opening (overlaps existing) without throwing', () => {
    const { plan, floorId } = squarePlan();
    // o0 already occupies w0 at offset 40..160; this overlaps → addOpening no-ops.
    const out = applyEditPatch(plan, floorId, res({
      op: 'addOpening',
      openings: [{ wallId: 'w0', kind: 'door', offset: 50, width: 90 }],
    }));
    expect(floor(out).openings).toHaveLength(1);
  });
});
