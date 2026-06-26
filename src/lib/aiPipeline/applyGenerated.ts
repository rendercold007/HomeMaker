/**
 * Adapter: fold a backend AutoFurnishResponse into the Plan as Furniture.
 *
 * The architecture rule (CLAUDE.md → "The AI backend"): the backend response
 * re-enters through the store, never around it. So we convert each placement to
 * a model `Furniture` and add them ALL into one new Plan — a single commit, i.e.
 * one undo step — exactly like a hand-placed item. three.js still renders purely
 * from the resulting Plan.
 *
 * Wire units are metres; the model is centimetres (×100). The 3D yaw (rotation
 * about y) maps to the floor-plan `rotationDeg`. 2D y is the 3D z (depth) axis.
 * Unknown `type`s fall through to the catalog's generic box, so a stray type
 * never throws.
 */
import type { ID, Plan } from '../../model/types';
import { addFurniture } from '../../model/planEdits';
import { newId as defaultNewId } from '../../model/ids';
import type { AutoFurnishResponse } from './contract';

const M_TO_CM = 100;

export function applyGeneratedFurniture(
  plan: Plan,
  floorId: ID,
  response: AutoFurnishResponse,
  newId: () => ID = defaultNewId,
): Plan {
  return response.generated_furniture.reduce((acc, item) => {
    const [x, , z] = item.position;
    const { plan: next } = addFurniture(
      acc,
      floorId,
      {
        type: item.type,
        x: Math.round(x * M_TO_CM),
        y: Math.round(z * M_TO_CM),
        rotationDeg: item.rotation[1],
      },
      newId,
    );
    return next;
  }, plan);
}
