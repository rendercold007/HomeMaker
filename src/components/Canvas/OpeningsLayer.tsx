/**
 * OpeningsLayer — renders door and window symbols in wall gaps.
 *
 * Door: a pie-slice (Konva Arc) showing the swing zone, hinged at the A-side
 * of the opening, sweeping 90° clockwise from the wall direction.
 *
 * Window: a semi-transparent glass fill + two parallel lines spanning the gap.
 *
 * The gap itself is already cleared by WallsLayer (wall segments skip openings).
 */
import { Arc, Group, Line, Rect } from 'react-konva';
import type { Floor, ID, Opening } from '../../model/types';
import { distance, type Vec2 } from '../../model/geometry';

interface OpeningsLayerProps {
  floor: Floor;
  invZoom: number;
  selectedOpeningId: ID | null;
  onSelectOpening: (id: ID) => void;
}

interface OpeningGeo {
  opening: Opening;
  gapStart: Vec2;
  gapEnd: Vec2;
  /** Wall direction angle in radians (atan2 from A→B). */
  wallAngle: number;
  wallThickness: number;
}

function computeGeo(opening: Opening, floor: Floor): OpeningGeo | null {
  const wall = floor.walls.find((w) => w.id === opening.wallId);
  if (!wall) return null;
  const a = floor.points.find((p) => p.id === wall.a);
  const b = floor.points.find((p) => p.id === wall.b);
  if (!a || !b) return null;
  const wallLen = distance(a, b);
  if (wallLen === 0) return null;

  const ux = (b.x - a.x) / wallLen;
  const uy = (b.y - a.y) / wallLen;

  return {
    opening,
    gapStart: { x: a.x + ux * opening.offset, y: a.y + uy * opening.offset },
    gapEnd:   { x: a.x + ux * (opening.offset + opening.width), y: a.y + uy * (opening.offset + opening.width) },
    wallAngle: Math.atan2(uy, ux),
    wallThickness: wall.thickness,
  };
}

function DoorSymbol({
  geo,
  selected,
  invZoom,
  onSelect,
}: {
  geo: OpeningGeo;
  selected: boolean;
  invZoom: number;
  onSelect: () => void;
}) {
  const { gapStart, wallAngle, opening } = geo;
  const rotDeg = (wallAngle * 180) / Math.PI;
  const stroke = selected ? '#2563eb' : '#334155';

  return (
    <Arc
      x={gapStart.x}
      y={gapStart.y}
      innerRadius={0}
      outerRadius={opening.width}
      angle={90}
      rotation={rotDeg}
      fill={selected ? 'rgba(219,234,254,0.5)' : 'rgba(241,245,249,0.6)'}
      stroke={stroke}
      strokeWidth={1.2 * invZoom}
      hitStrokeWidth={8 * invZoom}
      onClick={(e) => { e.cancelBubble = true; onSelect(); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(); }}
    />
  );
}

function WindowSymbol({
  geo,
  selected,
  invZoom,
  onSelect,
}: {
  geo: OpeningGeo;
  selected: boolean;
  invZoom: number;
  onSelect: () => void;
}) {
  const { gapStart, gapEnd, wallAngle, wallThickness, opening } = geo;
  const px = Math.cos(wallAngle + Math.PI / 2);
  const py = Math.sin(wallAngle + Math.PI / 2);
  const offset = wallThickness * 0.3;
  const stroke = selected ? '#2563eb' : '#334155';

  // Center of the gap for the glass rectangle
  const cx = (gapStart.x + gapEnd.x) / 2;
  const cy = (gapStart.y + gapEnd.y) / 2;
  const rotDeg = (wallAngle * 180) / Math.PI;

  return (
    <Group
      onClick={(e) => { e.cancelBubble = true; onSelect(); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(); }}
    >
      {/* Glass fill */}
      <Rect
        x={cx}
        y={cy}
        width={opening.width}
        height={wallThickness}
        offsetX={opening.width / 2}
        offsetY={wallThickness / 2}
        rotation={rotDeg}
        fill={selected ? 'rgba(186,230,253,0.5)' : 'rgba(186,230,253,0.3)'}
        strokeEnabled={false}
        listening={false}
      />
      {/* Pane line 1 */}
      <Line
        points={[
          gapStart.x + px * offset, gapStart.y + py * offset,
          gapEnd.x   + px * offset, gapEnd.y   + py * offset,
        ]}
        stroke={stroke}
        strokeWidth={0.8 * invZoom}
        listening={false}
      />
      {/* Pane line 2 */}
      <Line
        points={[
          gapStart.x - px * offset, gapStart.y - py * offset,
          gapEnd.x   - px * offset, gapEnd.y   - py * offset,
        ]}
        stroke={stroke}
        strokeWidth={0.8 * invZoom}
        listening={false}
      />
      {/* Invisible hit target */}
      <Line
        points={[gapStart.x, gapStart.y, gapEnd.x, gapEnd.y]}
        stroke="transparent"
        strokeWidth={wallThickness + 8 * invZoom}
      />
    </Group>
  );
}

export function OpeningsLayer({
  floor,
  invZoom,
  selectedOpeningId,
  onSelectOpening,
}: OpeningsLayerProps) {
  return (
    <Group>
      {floor.openings.map((op) => {
        const geo = computeGeo(op, floor);
        if (!geo) return null;
        const selected = op.id === selectedOpeningId;
        if (op.kind === 'door') {
          return (
            <DoorSymbol
              key={op.id}
              geo={geo}
              selected={selected}
              invZoom={invZoom}
              onSelect={() => onSelectOpening(op.id)}
            />
          );
        }
        return (
          <WindowSymbol
            key={op.id}
            geo={geo}
            selected={selected}
            invZoom={invZoom}
            onSelect={() => onSelectOpening(op.id)}
          />
        );
      })}
    </Group>
  );
}
