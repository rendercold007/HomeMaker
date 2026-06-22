/**
 * DraftLayer — the in-progress wall while using the Wall tool.
 *
 * Shows the rubber-band segment from the start point to the snapped cursor, a
 * live length readout (required, per CLAUDE.md), and a marker at the snap
 * target. All of this is transient state owned by CanvasStage; nothing here
 * touches PlanContext.
 */
import { Circle, Group, Line, Text, Rect } from 'react-konva';
import type { Vec2 } from '../../model/geometry';
import { distance } from '../../model/geometry';
import { formatLength } from '../../lib/units';

interface DraftLayerProps {
  start: Vec2 | null;
  cursor: Vec2 | null;
  /** True when the cursor is currently snapped to an existing vertex. */
  snapped: boolean;
  invZoom: number;
}

export function DraftLayer({ start, cursor, snapped, invZoom }: DraftLayerProps) {
  if (!cursor) return null;

  const markerR = 5 * invZoom;
  const fontSize = 13 * invZoom;

  return (
    <Group listening={false}>
      {start && (
        <>
          <Line
            points={[start.x, start.y, cursor.x, cursor.y]}
            stroke="#2563eb"
            strokeWidth={2 * invZoom}
            dash={[8 * invZoom, 6 * invZoom]}
          />
          {(() => {
            const len = distance(start, cursor);
            const mid = { x: (start.x + cursor.x) / 2, y: (start.y + cursor.y) / 2 };
            const label = formatLength(len);
            const padX = 6 * invZoom;
            const boxW = (label.length * fontSize * 0.62) + padX * 2;
            const boxH = fontSize + padX;
            return (
              <Group x={mid.x} y={mid.y - 16 * invZoom}>
                <Rect
                  x={-boxW / 2}
                  y={-boxH / 2}
                  width={boxW}
                  height={boxH}
                  fill="#1e293b"
                  cornerRadius={3 * invZoom}
                />
                <Text
                  x={-boxW / 2}
                  y={-boxH / 2 + padX / 2}
                  width={boxW}
                  text={label}
                  fontSize={fontSize}
                  fill="#ffffff"
                  align="center"
                />
              </Group>
            );
          })()}
        </>
      )}

      {/* Snap target marker */}
      <Circle
        x={cursor.x}
        y={cursor.y}
        radius={markerR}
        stroke={snapped ? '#16a34a' : '#2563eb'}
        strokeWidth={2 * invZoom}
        fill={snapped ? 'rgba(22,163,74,0.2)' : 'rgba(37,99,235,0.15)'}
      />
    </Group>
  );
}
