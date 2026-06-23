/**
 * The core data model — the single schema the entire app reads and writes.
 *
 * Everything (editor, AI, exporter) operates on `Plan`. Keep these types
 * stable: changing them ripples everywhere. See CLAUDE.md → "The core data model".
 *
 * Coordinate conventions:
 *   - All coordinates are in CENTIMETERS (integer-friendly world units).
 *   - Origin is top-left; y increases downward (screen convention).
 *   - Convert to feet-inches / meters only at display time.
 *
 * Rooms are NOT authored directly — they are DERIVED by finding closed cycles
 * in the wall graph (see src/model/roomDetect.ts, Phase 1).
 */

export type ID = string;

/** A vertex in the wall graph, in world centimeters. */
export interface Point {
  id: ID;
  x: number;
  y: number;
}

/** An edge between two Points. Endpoints reference Point ids. */
export interface Wall {
  id: ID;
  a: ID;
  b: ID;
  /** Wall thickness in cm. */
  thickness: number;
  /** Wall height in cm — used by the 3D extrusion view. */
  height: number;
}

/** A door or window cut into a wall. */
export interface Opening {
  id: ID;
  wallId: ID;
  kind: 'door' | 'window';
  /** Distance along the wall from endpoint `a`, in cm. */
  offset: number;
  /** Width of the opening, in cm. */
  width: number;
}

/** A room's functional type. Drives 3D floor colors and labelling. */
export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'dining'
  | 'study'
  | 'utility'
  | 'pooja'
  | 'parking'
  | 'other';

/**
 * A room — its geometry is DERIVED (cycle detection over the wall graph), but
 * `name` and `type` are user-authored and carried across recomputation by the
 * room's stable id (its sorted wall set). See planEdits.recomputeRooms.
 */
export interface Room {
  id: ID;
  wallIds: ID[];
  name: string;
  type: RoomType;
  areaCm2: number;
}

/** A placed furniture item. */
export interface Furniture {
  id: ID;
  type: string;
  /** Position in world cm. */
  x: number;
  y: number;
  rotationDeg: number;
  roomId?: ID;
}

/** A single floor level and all of its geometry. */
export interface Floor {
  id: ID;
  level: number;
  points: Point[];
  walls: Wall[];
  openings: Opening[];
  /** Derived from the wall graph; not authored directly. */
  rooms: Room[];
  furniture: Furniture[];
}

/** The plot the building sits on, including setbacks (all in cm). */
export interface Plot {
  widthCm: number;
  depthCm: number;
  shape: 'rectangular' | 'square' | 'lshape' | 'irregular';
  entrance: 'N' | 'S' | 'E' | 'W';
  setbacks: { front: number; rear: number; left: number; right: number };
}

/** The top-level document. Everything else hangs off this. */
export interface Plan {
  id: ID;
  name: string;
  units: 'cm';
  plot: Plot;
  floors: Floor[];
}
