/**
 * WallsLayer — renders walls (with opening gaps) and endpoint handles.
 *
 * Each wall is split into segments around its openings so the gap is visible.
 * Endpoint handles are screen-constant (sized via invZoom) and draggable only
 * in Select mode. Transient drag positions come from `override`; the parent
 * commits to PlanContext on drag end.
 */
import { Circle, Group, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Floor, ID, Opening } from '../../model/types';
import { distance, type Vec2 } from '../../model/geometry';
import type { Tool } from '../../state/ToolContext';

interface WallsLayerProps {
  floor: Floor;
  override: Record<ID, Vec2>;
  tool: Tool;
  selectedWallId: ID | null;
  selectedPointId: ID | null;
  invZoom: number;
  onSelectWall: (id: ID) => void;
  onSelectPoint: (id: ID) => void;
  onPointDragMove: (id: ID, raw: Vec2) => Vec2;
  onPointDragEnd: (id: ID, raw: Vec2) => void;
}

/** Split a wall into renderable segments, leaving gaps for openings. */
function wallSegments(
  a: Vec2,
  b: Vec2,
  wallId: ID,
  openings: Opening[],
): Array<[Vec2, Vec2]> {
  const wallLen = distance(a, b);
  if (wallLen === 0) return [];

  const ux = (b.x - a.x) / wallLen;
  const uy = (b.y - a.y) / wallLen;

  const sorted = openings
    .filter((o) => o.wallId === wallId)
    .sort((x, y) => x.offset - y.offset);

  const segs: Array<[Vec2, Vec2]> = [];
  let cursor = 0;

  for (const op of sorted) {
    const gapStart = Math.max(0, op.offset);
    const gapEnd = Math.min(wallLen, op.offset + op.width);
    if (gapStart > cursor) {
      segs.push([
        { x: a.x + ux * cursor, y: a.y + uy * cursor },
        { x: a.x + ux * gapStart, y: a.y + uy * gapStart },
      ]);
    }
    cursor = Math.max(cursor, gapEnd);
  }

  if (cursor < wallLen) {
    segs.push([
      { x: a.x + ux * cursor, y: a.y + uy * cursor },
      b,
    ]);
  }

  return segs;
}

export function WallsLayer({
  floor,
  override,
  tool,
  selectedWallId,
  selectedPointId,
  invZoom,
  onSelectWall,
  onSelectPoint,
  onPointDragMove,
  onPointDragEnd,
}: WallsLayerProps) {
  const resolve = (id: ID): Vec2 => {
    const o = override[id];
    if (o) return o;
    const p = floor.points.find((pt) => pt.id === id)!;
    return { x: p.x, y: p.y };
  };

  const handleRadius = 5 * invZoom;
  const selectStroke = 3 * invZoom;
  const interactive = tool === 'select';

  return (
    <Group>
      {/* Walls rendered as segments (with gaps for openings) */}
      {floor.walls.flatMap((w) => {
        const a = resolve(w.a);
        const b = resolve(w.b);
        const selected = w.id === selectedWallId;
        const segs = wallSegments(a, b, w.id, floor.openings);
        return segs.map((seg, i) => (
          <Line
            key={`${w.id}-${i}`}
            points={[seg[0].x, seg[0].y, seg[1].x, seg[1].y]}
            stroke={selected ? '#2563eb' : '#1e293b'}
            strokeWidth={selected ? Math.max(w.thickness, selectStroke) : w.thickness}
            lineCap="butt"
            hitStrokeWidth={Math.max(w.thickness, 14 * invZoom)}
            onClick={interactive ? (e) => { e.cancelBubble = true; onSelectWall(w.id); } : undefined}
            onTap={interactive ? (e) => { e.cancelBubble = true; onSelectWall(w.id); } : undefined}
          />
        ));
      })}

      {/* Endpoint handles */}
      {floor.points.map((p) => {
        const pos = resolve(p.id);
        const selected = p.id === selectedPointId;
        const draggable = interactive;
        return (
          <Circle
            key={p.id}
            x={pos.x}
            y={pos.y}
            radius={selected ? handleRadius * 1.4 : handleRadius}
            fill={selected ? '#2563eb' : '#ffffff'}
            stroke="#2563eb"
            strokeWidth={1.5 * invZoom}
            draggable={draggable}
            onClick={interactive ? (e) => { e.cancelBubble = true; onSelectPoint(p.id); } : undefined}
            onTap={interactive ? (e) => { e.cancelBubble = true; onSelectPoint(p.id); } : undefined}
            onDragStart={interactive ? (e) => { e.cancelBubble = true; onSelectPoint(p.id); } : undefined}
            onDragMove={(e: KonvaEventObject<DragEvent>) => {
              if (!draggable) return;
              const node = e.target;
              const snapped = onPointDragMove(p.id, { x: node.x(), y: node.y() });
              node.position(snapped);
            }}
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              if (!draggable) return;
              const node = e.target;
              onPointDragEnd(p.id, { x: node.x(), y: node.y() });
            }}
          />
        );
      })}
    </Group>
  );
}
