/**
 * API contract for the AI auto-furnish pipeline (Phase 4).
 *
 * This is the wire format between the frontend and the generation backend
 * described in docs/BackenAndAI.md. The frontend sends a room + prompt; the
 * backend returns furniture placements. In Phase 4 · step 1 the backend is a
 * MOCK that returns a hardcoded payload — but this shape is the stable boundary
 * the real LLM + spatial-solver worker (steps 2–4) will implement unchanged.
 *
 * Wire units are METRES (three.js world units), matching the BackenAndAI payload
 * examples. The frontend adapter converts to the model's centimetres.
 */

/** Request: the room to furnish plus the natural-language intent. */
export interface AutoFurnishRequest {
  prompt: string;
  room: {
    /** Room envelope in metres. */
    dimensions: { width: number; length: number; height: number };
    /** Doors as [x, z] position (m) along the envelope + width (m). */
    doors?: { position: [number, number]; width: number }[];
    /** Windows, same convention as doors. */
    windows?: { position: [number, number]; width: number }[];
  };
}

/** One placed item the backend computed. */
export interface GeneratedFurniture {
  /** Asset id. Until the vector DB exists this is just a catalog `type`. */
  asset_id: string;
  /**
   * The furniture `type` to instantiate from the catalog (src/model/furniture).
   * Bridges the backend's generic asset to a renderable model type; once the
   * vector DB lands (step 4) this is derived from asset metadata instead.
   */
  type: string;
  /** Position in metres, [x, y(up), z(depth)]. y is the floor (0). */
  position: [number, number, number];
  /** Rotation in degrees, [x, y, z]. Only y (yaw) is used by the floor plan. */
  rotation: [number, number, number];
}

/** Response: the furniture the backend placed. */
export interface AutoFurnishResponse {
  generated_furniture: GeneratedFurniture[];
}

/* ------------------------------------------------------------------ *
 * Multi-room floor-plan generation (chat → whole editable plan).
 *
 * Unlike auto-furnish (metres, furniture only), this builds the floor-plan
 * GEOMETRY, so its payload is in CENTIMETRES — the model's native unit — and
 * the adapter (applyGeneratedPlan) commits it straight into a Floor.
 * ------------------------------------------------------------------ */

/** Request: a prompt + the plot envelope to lay the home out in. */
export interface GeneratePlanRequest {
  prompt: string;
  plot: { widthCm: number; depthCm: number };
}

export interface GenPoint { id: string; x: number; y: number } // cm
export interface GenWall { id: string; a: string; b: string; thickness: number; height: number }
export interface GenOpening { id: string; wallId: string; kind: 'door' | 'window'; offset: number; width: number }
export interface GenFurniture {
  type: string; x: number; y: number; rotationDeg: number; // cm
  /** Centroid of the room this item belongs to — resolved to a derived roomId by the adapter. */
  roomCx?: number; roomCy?: number;
}
export interface GenRoomMeta { name: string; type: string; cx: number; cy: number } // centroid, for naming

/** Response: a full editable floor plan in centimetres. */
export interface GeneratedPlan {
  plan: {
    points: GenPoint[];
    walls: GenWall[];
    openings: GenOpening[];
    furniture: GenFurniture[];
    rooms: GenRoomMeta[];
  };
}

/* ------------------------------------------------------------------ *
 * Iterative editing (chat → edits to the EXISTING plan).
 *
 * Unlike generate-plan (which sends only the plot and returns a whole new
 * floor), editing sends the CURRENT floor — so the worker can resolve "the
 * kitchen", reuse real room/furniture ids, and place new items around what's
 * already there — and returns a PATCH the adapter folds in as one undo step.
 * All cm. See docs/IterativeEditing.md.
 * ------------------------------------------------------------------ */

import type { Floor } from '../../model/types';

/** A furniture item on the edit wire — carries its real id + roomId (unlike GenFurniture). */
export interface EditFurniture { id: string; type: string; x: number; y: number; rotationDeg: number; roomId?: string }
/** A derived room on the edit wire — the client is authoritative for room derivation. */
export interface EditRoom { id: string; wallIds: string[]; name: string; type: string; areaCm2: number }

/** The current active floor, serialized for the worker (cm). */
export interface SerializedFloor {
  points: GenPoint[];
  walls: GenWall[];
  openings: (GenOpening & { id: string })[];
  furniture: EditFurniture[];
  rooms: EditRoom[];
}

/** Request: a natural-language edit + the current floor it applies to. */
export interface EditPlanRequest {
  prompt: string;
  floor: SerializedFloor;
}

/**
 * One concrete, id-level edit operation. Each maps 1:1 to a planEdits call in
 * applyEditPatch. `replaceFloor` is reserved for v2 structural edits (room
 * resize/add/remove); no v1 command emits it yet.
 */
export type EditPatchOp =
  | { op: 'addFurniture'; items: { type: string; x: number; y: number; rotationDeg: number; roomId: string }[] }
  | { op: 'removeFurniture'; ids: string[] }
  | { op: 'addOpening'; openings: { wallId: string; kind: 'door' | 'window'; offset: number; width: number }[] }
  | { op: 'removeOpening'; ids: string[] }
  | { op: 'setRoomName'; roomId: string; name: string }
  | { op: 'setRoomType'; roomId: string; type: string }
  | {
      op: 'replaceFloor'; // v2 — full re-flow of one floor (structural edits)
      points: GenPoint[]; walls: GenWall[]; openings: GenOpening[];
      furniture: GenFurniture[]; rooms: GenRoomMeta[];
    };

/** Response: the patch to apply, a human-readable recap, and any caveats. */
export interface EditPlanResponse {
  patch: EditPatchOp[];
  summary: string;
  warnings: string[];
}

/** Serialize the active floor for the edit wire (a straight cm copy). */
export function serializeFloor(floor: Floor): SerializedFloor {
  return {
    points: floor.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    walls: floor.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: w.thickness, height: w.height })),
    openings: floor.openings.map((o) => ({ id: o.id, wallId: o.wallId, kind: o.kind, offset: o.offset, width: o.width })),
    furniture: floor.furniture.map((f) => ({
      id: f.id, type: f.type, x: f.x, y: f.y, rotationDeg: f.rotationDeg, roomId: f.roomId,
    })),
    rooms: floor.rooms.map((r) => ({
      id: r.id, wallIds: r.wallIds, name: r.name, type: r.type, areaCm2: r.areaCm2,
    })),
  };
}
