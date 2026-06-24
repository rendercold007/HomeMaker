/**
 * RoomsLayer — fills detected rooms and labels them with name + area.
 *
 * Rooms are derived (PlanContext keeps them in sync). Polygons are built by
 * walking each room's wall list back into an ordered point ring.
 */
import { Group, Line, Text } from 'react-konva';
import type { Floor, ID } from '../../model/types';
import { signedPolygonArea, type Vec2 } from '../../model/geometry';
import { roomRing } from '../../model/roomDetect';
import { formatArea } from '../../lib/units';

interface RoomsLayerProps {
  floor: Floor;
  invZoom: number;
  interactive: boolean;
  selectedRoomId: ID | null;
  onSelectRoom: (id: ID) => void;
}

function centroid(pts: Vec2[]): Vec2 {
  const c = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
    x: 0,
    y: 0,
  });
  return { x: c.x / pts.length, y: c.y / pts.length };
}

export function RoomsLayer({
  floor,
  invZoom,
  interactive,
  selectedRoomId,
  onSelectRoom,
}: RoomsLayerProps) {
  return (
    <Group>
      {floor.rooms.map((room) => {
        const ring = roomRing(room, floor.points, floor.walls);
        if (ring.length < 3) return null;
        const flat = ring.flatMap((p) => [p.x, p.y]);
        const c = centroid(ring);
        const area = Math.abs(signedPolygonArea(ring));
        const fontSize = 14 * invZoom;
        const selected = room.id === selectedRoomId;
        return (
          <Group key={room.id}>
            <Line
              points={flat}
              closed
              fill={selected ? 'rgba(37, 99, 235, 0.20)' : 'rgba(59, 130, 246, 0.08)'}
              stroke={selected ? '#2563eb' : undefined}
              strokeWidth={selected ? 1.5 * invZoom : 0}
              listening={interactive}
              onClick={interactive ? (e) => { e.cancelBubble = true; onSelectRoom(room.id); } : undefined}
              onTap={interactive ? (e) => { e.cancelBubble = true; onSelectRoom(room.id); } : undefined}
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
