/**
 * RoomsLayer — fills detected rooms and labels them with name + area.
 *
 * Rooms are derived (PlanContext keeps them in sync). Polygons are built by
 * walking each room's wall list back into an ordered point ring.
 */
import { Group, Line, Text } from 'react-konva';
import type { Floor, ID, Room } from '../../model/types';
import { signedPolygonArea, type Vec2 } from '../../model/geometry';
import { formatArea } from '../../lib/units';

interface RoomsLayerProps {
  floor: Floor;
  invZoom: number;
}

/** Order a room's walls into a ring of points for filling. */
function roomRing(room: Room, floor: Floor): Vec2[] {
  const pointById = new Map<ID, Vec2>(
    floor.points.map((p) => [p.id, { x: p.x, y: p.y }]),
  );
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));

  // Build adjacency restricted to this room's walls, then walk the loop.
  const adj = new Map<ID, ID[]>();
  for (const wid of room.wallIds) {
    const w = wallById.get(wid);
    if (!w) continue;
    (adj.get(w.a) ?? adj.set(w.a, []).get(w.a)!).push(w.b);
    (adj.get(w.b) ?? adj.set(w.b, []).get(w.b)!).push(w.a);
  }
  const startId = adj.keys().next().value as ID | undefined;
  if (startId === undefined) return [];

  const ring: ID[] = [startId];
  let prev: ID | null = null;
  let cur: ID = startId;
  for (let i = 0; i < room.wallIds.length; i++) {
    const neighbors = adj.get(cur) ?? [];
    const next = neighbors.find((n) => n !== prev);
    if (next === undefined || next === startId) break;
    ring.push(next);
    prev = cur;
    cur = next;
  }
  return ring.map((id) => pointById.get(id)!).filter(Boolean);
}

function centroid(pts: Vec2[]): Vec2 {
  const c = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
    x: 0,
    y: 0,
  });
  return { x: c.x / pts.length, y: c.y / pts.length };
}

export function RoomsLayer({ floor, invZoom }: RoomsLayerProps) {
  return (
    <Group listening={false}>
      {floor.rooms.map((room) => {
        const ring = roomRing(room, floor);
        if (ring.length < 3) return null;
        const flat = ring.flatMap((p) => [p.x, p.y]);
        const c = centroid(ring);
        const area = Math.abs(signedPolygonArea(ring));
        const fontSize = 14 * invZoom;
        return (
          <Group key={room.id}>
            <Line
              points={flat}
              closed
              fill="rgba(59, 130, 246, 0.08)"
              listening={false}
            />
            <Text
              x={c.x}
              y={c.y - fontSize}
              text={`${room.name}\n${formatArea(area)}`}
              fontSize={fontSize}
              fill="#475569"
              align="center"
              offsetX={50 * invZoom}
              width={100 * invZoom}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
