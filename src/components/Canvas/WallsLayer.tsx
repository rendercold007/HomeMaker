/**
 * WallsLayer — renders walls and their endpoint handles.
 *
 * Walls are drawn at real thickness (cm) inside the scaled layer. Endpoint
 * handles are screen-constant (sized via invZoom) and draggable only with the
 * Select tool. Transient drag positions come from `override`; the parent
 * commits to PlanContext on drag end.
 */
import { Circle, Group, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Floor, ID } from '../../model/types';
import type { Vec2 } from '../../model/geometry';
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
  /** Snap a dragged point; returns the position to render it at. */
  onPointDragMove: (id: ID, raw: Vec2) => Vec2;
  onPointDragEnd: (id: ID, raw: Vec2) => void;
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

  return (
    <Group>
      {/* Walls */}
      {floor.walls.map((w) => {
        const a = resolve(w.a);
        const b = resolve(w.b);
        const selected = w.id === selectedWallId;
        return (
          <Line
            key={w.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={selected ? '#2563eb' : '#1e293b'}
            strokeWidth={selected ? Math.max(w.thickness, selectStroke) : w.thickness}
            lineCap="round"
            hitStrokeWidth={Math.max(w.thickness, 14 * invZoom)}
            onClick={(e) => {
              e.cancelBubble = true;
              onSelectWall(w.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSelectWall(w.id);
            }}
          />
        );
      })}

      {/* Endpoint handles */}
      {floor.points.map((p) => {
        const pos = resolve(p.id);
        const selected = p.id === selectedPointId;
        const draggable = tool === 'select';
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
            onClick={(e) => {
              e.cancelBubble = true;
              onSelectPoint(p.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSelectPoint(p.id);
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onSelectPoint(p.id);
            }}
            onDragMove={(e: KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const snapped = onPointDragMove(p.id, { x: node.x(), y: node.y() });
              node.position(snapped);
            }}
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              const node = e.target;
              onPointDragEnd(p.id, { x: node.x(), y: node.y() });
            }}
          />
        );
      })}
    </Group>
  );
}
