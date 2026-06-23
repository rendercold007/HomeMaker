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
import { computeWallQuads } from '../../model/miter';
import type { Tool } from '../../state/store';

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

/** Solid spans of a wall as [startCm, endCm] distances, skipping openings. */
function solidSpans(
  wallLen: number,
  wallId: ID,
  openings: Opening[],
): Array<[number, number]> {
  if (wallLen <= 0) return [];

  const sorted = openings
    .filter((o) => o.wallId === wallId)
    .sort((x, y) => x.offset - y.offset);

  const spans: Array<[number, number]> = [];
  let cursor = 0;

  for (const op of sorted) {
    const gapStart = Math.max(0, op.offset);
    const gapEnd = Math.min(wallLen, op.offset + op.width);
    if (gapStart > cursor) spans.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }

  if (cursor < wallLen) spans.push([cursor, wallLen]);

  return spans;
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
  const interactive = tool === 'select';

  // Mitered wall outlines, computed from override-adjusted points so dragging a
  // vertex updates the corner joins live.
  const effPoints = floor.points.map((p) => {
    const o = override[p.id];
    return o ? { ...p, x: o.x, y: o.y } : p;
  });
  const quads = computeWallQuads(effPoints, floor.walls);

  return (
    <Group>
      {/* Walls as filled, mitered polygons (with gaps for openings) */}
      {floor.walls.flatMap((w) => {
        const quad = quads.get(w.id);
        if (!quad) return [];
        const a = resolve(w.a);
        const b = resolve(w.b);
        const wallLen = distance(a, b);
        if (wallLen === 0) return [];

        const [leftA, leftB, rightB, rightA] = quad.corners;
        const dirx = (b.x - a.x) / wallLen;
        const diry = (b.y - a.y) / wallLen;
        const nLx = -diry;
        const nLy = dirx;
        const halfT = w.thickness / 2;

        // Edge point at distance d (cm) along the wall on a given side. The true
        // ends use the mitered corner; interior cuts (at openings) are square.
        const edge = (d: number, side: 1 | -1): Vec2 => {
          if (d <= 0) return side === 1 ? leftA : rightA;
          if (d >= wallLen) return side === 1 ? leftB : rightB;
          return {
            x: a.x + dirx * d + side * nLx * halfT,
            y: a.y + diry * d + side * nLy * halfT,
          };
        };

        const selected = w.id === selectedWallId;
        const fill = selected ? '#2563eb' : '#1e293b';

        return solidSpans(wallLen, w.id, floor.openings).map((span, i) => {
          const [d0, d1] = span;
          const l0 = edge(d0, 1);
          const l1 = edge(d1, 1);
          const r1 = edge(d1, -1);
          const r0 = edge(d0, -1);
          return (
            <Line
              key={`${w.id}-${i}`}
              points={[l0.x, l0.y, l1.x, l1.y, r1.x, r1.y, r0.x, r0.y]}
              closed
              fill={fill}
              stroke={fill}
              strokeWidth={0.6 * invZoom}
              onClick={interactive ? (e) => { e.cancelBubble = true; onSelectWall(w.id); } : undefined}
              onTap={interactive ? (e) => { e.cancelBubble = true; onSelectWall(w.id); } : undefined}
            />
          );
        });
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
