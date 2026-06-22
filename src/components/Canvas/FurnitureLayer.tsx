/**
 * FurnitureLayer — renders placed furniture as labeled rectangles in plan view.
 *
 * Each item is centered at (item.x, item.y) and rotated by item.rotationDeg.
 * Draggable in Select mode; the parent commits position on drag end.
 */
import { Group, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Floor, ID } from '../../model/types';
import { getFurnitureDef } from '../../model/furniture';
import type { Vec2 } from '../../model/geometry';
import type { Tool } from '../../state/ToolContext';

interface FurnitureLayerProps {
  floor: Floor;
  override: Record<ID, Vec2>;
  tool: Tool;
  selectedFurnitureId: ID | null;
  invZoom: number;
  onSelectFurniture: (id: ID) => void;
  onFurnitureDragMove: (id: ID, raw: Vec2) => Vec2;
  onFurnitureDragEnd: (id: ID, raw: Vec2) => void;
}

export function FurnitureLayer({
  floor,
  override,
  tool,
  selectedFurnitureId,
  invZoom,
  onSelectFurniture,
  onFurnitureDragMove,
  onFurnitureDragEnd,
}: FurnitureLayerProps) {
  const draggable = tool === 'select';

  return (
    <Group>
      {floor.furniture.map((item) => {
        const def = getFurnitureDef(item.type);
        const w = def?.widthCm ?? 60;
        const h = def?.heightCm ?? 60;
        const color = def?.color ?? '#e2e8f0';
        const label = def?.label ?? item.type;
        const selected = item.id === selectedFurnitureId;

        const pos = override[item.id] ?? { x: item.x, y: item.y };

        return (
          <Group
            key={item.id}
            x={pos.x}
            y={pos.y}
            rotation={item.rotationDeg}
            draggable={draggable}
            onClick={(e) => { e.cancelBubble = true; onSelectFurniture(item.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelectFurniture(item.id); }}
            onDragStart={(e) => { e.cancelBubble = true; onSelectFurniture(item.id); }}
            onDragMove={(e: KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const snapped = onFurnitureDragMove(item.id, { x: node.x(), y: node.y() });
              node.position(snapped);
            }}
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              const node = e.target;
              onFurnitureDragEnd(item.id, { x: node.x(), y: node.y() });
            }}
          >
            <Rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              fill={color}
              stroke={selected ? '#2563eb' : '#64748b'}
              strokeWidth={selected ? 2 * invZoom : 1 * invZoom}
              cornerRadius={3 * invZoom}
            />
            <Text
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              text={label}
              fontSize={Math.min(12 * invZoom, w * 0.4, h * 0.4)}
              fill={selected ? '#1e40af' : '#334155'}
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
