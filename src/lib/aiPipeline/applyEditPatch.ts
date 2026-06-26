/**
 * Adapter: fold a chat-driven edit PATCH into the active Floor.
 *
 * Same rule as the other AI adapters (CLAUDE.md → "The AI backend"): the backend
 * result re-enters through the store as ONE commit, so the whole edit is a single
 * undo step. The worker has already resolved every op to concrete, id-level
 * geometry (coordinates, wall ids), so this is a thin, mechanical fold — each op
 * maps 1:1 to a pure planEdits function, applied in order onto one draft Plan.
 *
 * v1 ops are local (furniture, openings, room name/type) and never change the
 * wall graph, so derived room ids stay stable across the patch — the worker's
 * roomIds remain valid. `replaceFloor` (v2 structural edits) routes through the
 * existing applyGeneratedPlan path.
 */
import type { ID, Plan } from '../../model/types';
import {
  addFurniture,
  addOpening,
  deleteFurniture,
  deleteOpening,
  setRoomName,
  setRoomType,
} from '../../model/planEdits';
import { newId as defaultNewId } from '../../model/ids';
import { applyGeneratedPlan, asRoomType } from './applyPlan';
import type { EditPlanResponse } from './contract';

export function applyEditPatch(
  plan: Plan,
  floorId: ID,
  response: EditPlanResponse,
  newId: () => ID = defaultNewId,
): Plan {
  let next = plan;

  for (const op of response.patch) {
    switch (op.op) {
      case 'addFurniture':
        for (const it of op.items) {
          next = addFurniture(
            next,
            floorId,
            { type: it.type, x: it.x, y: it.y, rotationDeg: it.rotationDeg, roomId: it.roomId },
            newId,
          ).plan;
        }
        break;

      case 'removeFurniture':
        for (const id of op.ids) next = deleteFurniture(next, floorId, id);
        break;

      case 'addOpening':
        // addOpening enforces its own invariants (fit, no overlap, clamp) and is
        // a no-op on a rejected opening — the final safety net over the worker.
        for (const o of op.openings) {
          next = addOpening(
            next,
            floorId,
            { wallId: o.wallId, kind: o.kind, offset: o.offset, width: o.width },
            newId,
          ).plan;
        }
        break;

      case 'removeOpening':
        for (const id of op.ids) next = deleteOpening(next, floorId, id);
        break;

      case 'setRoomName':
        next = setRoomName(next, floorId, op.roomId, op.name);
        break;

      case 'setRoomType':
        next = setRoomType(next, floorId, op.roomId, asRoomType(op.type));
        break;

      case 'replaceFloor': // v2 structural edits — reuse the full-plan adapter
        next = applyGeneratedPlan(
          next,
          floorId,
          { plan: { points: op.points, walls: op.walls, openings: op.openings, furniture: op.furniture, rooms: op.rooms } },
          newId,
        );
        break;

      default:
        break; // forward-compatible: ignore ops this client doesn't know
    }
  }

  return next;
}
