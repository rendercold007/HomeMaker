/**
 * Vastu Shastra rules engine — pure module, no React imports.
 *
 * Each room is classified from its name, its centroid located relative to the
 * plot centre, and its compass direction checked against the rule table.
 * Returns a report with violations and a 0–100 compliance score.
 */
import type { Floor, ID, Plan, Plot, Room, VastuConfig } from './types';

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type RoomType =
  | 'pooja'
  | 'kitchen'
  | 'master_bedroom'
  | 'bedroom'
  | 'living'
  | 'bathroom'
  | 'study'
  | 'dining'
  | 'storage'
  | 'staircase'
  | 'garage'
  | 'unknown';

export interface VastuViolation {
  id: string;
  roomId: ID;
  roomName: string;
  roomType: RoomType;
  actualDirection: Direction;
  allowedDirections: Direction[];
  severity: 'error' | 'warning';
  message: string;
}

export interface VastuReport {
  violations: VastuViolation[];
  score: number;
  checkedRooms: number;
  mode: VastuConfig['mode'];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const ROOM_KEYWORDS: [RoomType, string[]][] = [
  ['pooja', ['pooja', 'puja', 'prayer', 'mandir', 'temple', 'worship']],
  ['kitchen', ['kitchen', 'cook', 'modular kitchen']],
  ['master_bedroom', ['master']],
  ['bedroom', ['bedroom', 'bed room', 'guest room', 'guest', "child's", 'children']],
  ['living', ['living', 'hall', 'drawing', 'lounge', 'family', 'sitting']],
  ['bathroom', ['bathroom', 'toilet', 'wc', 'washroom', 'bath', 'lavatory']],
  ['study', ['study', 'office', 'work', 'library', 'reading']],
  ['dining', ['dining', 'eating', 'breakfast']],
  ['storage', ['storage', 'store', 'utility', 'pantry', 'laundry']],
  ['staircase', ['stair', 'staircase', 'stairs', 'stairwell']],
  ['garage', ['garage', 'parking', 'car park', 'carport']],
];

export function classifyRoom(name: string): RoomType {
  const lower = name.toLowerCase();
  for (const [type, keywords] of ROOM_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Directional rules
// ---------------------------------------------------------------------------

const DIRECTION_ORDER: Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const VASTU_RULES: Record<RoomType, Direction[]> = {
  pooja: ['NE'],
  kitchen: ['SE', 'NW'],
  master_bedroom: ['SW', 'S', 'W'],
  bedroom: ['S', 'W', 'SW', 'NW'],
  living: ['N', 'NE', 'NW', 'E'],
  bathroom: ['NW', 'SE'],
  study: ['NE', 'N', 'W'],
  dining: ['W', 'S', 'SW'],
  storage: ['SW', 'W', 'S'],
  staircase: ['S', 'SW', 'W'],
  garage: ['NW', 'SE'],
  unknown: [],
};

function expandLoose(dirs: Direction[]): Direction[] {
  const expanded = new Set<Direction>(dirs);
  for (const d of dirs) {
    const i = DIRECTION_ORDER.indexOf(d);
    expanded.add(DIRECTION_ORDER[(i + 1) % 8]!);
    expanded.add(DIRECTION_ORDER[(i + 7) % 8]!);
  }
  return [...expanded];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function getRoomCentroid(room: Room, floor: Floor): { x: number; y: number } {
  const pointById = new Map(floor.points.map((p) => [p.id, p]));
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));

  const pointIds = new Set<ID>();
  for (const wallId of room.wallIds) {
    const w = wallById.get(wallId);
    if (w) {
      pointIds.add(w.a);
      pointIds.add(w.b);
    }
  }

  if (pointIds.size === 0) return { x: 0, y: 0 };

  let sumX = 0;
  let sumY = 0;
  for (const pid of pointIds) {
    const p = pointById.get(pid);
    if (p) {
      sumX += p.x;
      sumY += p.y;
    }
  }
  return { x: sumX / pointIds.size, y: sumY / pointIds.size };
}

/**
 * Map a world-cm centroid to one of the 8 compass octants relative to the
 * plot centre. Uses screen-to-compass convention (y-down → North is -dy).
 */
export function getCompassDirection(cx: number, cy: number, plot: Plot): Direction {
  const dx = cx - plot.widthCm / 2;
  const dy = cy - plot.depthCm / 2;
  // atan2(dx, -dy): 0° = North, 90° = East (clockwise), matching compass bearings.
  let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  // Snap to nearest octant (each 45°).
  const octant = Math.round(deg / 45) % 8;
  return DIRECTION_ORDER[octant]!;
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

export function checkVastu(plan: Plan): VastuReport {
  const { vastu, plot, floors } = plan;

  if (vastu.mode === 'off') {
    return { violations: [], score: 100, checkedRooms: 0, mode: 'off' };
  }

  const floor = floors[0];
  if (!floor || floor.rooms.length === 0) {
    return { violations: [], score: 100, checkedRooms: 0, mode: vastu.mode };
  }

  const violations: VastuViolation[] = [];
  let checkedRooms = 0;

  for (const room of floor.rooms) {
    const roomType = classifyRoom(room.name);
    if (roomType === 'unknown') continue;

    const strictDirs = VASTU_RULES[roomType];
    if (strictDirs.length === 0) continue;

    checkedRooms++;

    const allowedDirs =
      vastu.mode === 'loose' ? expandLoose(strictDirs) : strictDirs;

    const centroid = getRoomCentroid(room, floor);
    const direction = getCompassDirection(centroid.x, centroid.y, plot);

    if (!allowedDirs.includes(direction)) {
      violations.push({
        id: `vastu:${room.id}`,
        roomId: room.id,
        roomName: room.name,
        roomType,
        actualDirection: direction,
        allowedDirections: strictDirs,
        severity: vastu.mode === 'strict' ? 'error' : 'warning',
        message: `${room.name} is in the ${direction} — Vastu recommends ${strictDirs.join(' or ')}.`,
      });
    }
  }

  const score =
    checkedRooms === 0
      ? 100
      : Math.round(Math.max(0, 100 - (violations.length / checkedRooms) * 100));

  return { violations, score, checkedRooms, mode: vastu.mode };
}
