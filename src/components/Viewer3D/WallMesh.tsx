/**
 * Wall mesh — extrudes one wall's mitered footprint into a prism, split into
 * segments around door/window openings, with window glass and door posts.
 */
import * as THREE from 'three';
import type { Floor, Opening } from '../../model/types';
import { DEFAULT_WALL_HEIGHT } from '../../model/planEdits';
import { wallEdgePoint, type WallQuad } from '../../model/miter';
import { CM, DOOR_H, SILL_H, LINTEL_H } from './constants';

interface Seg { offset: number; length: number; yMin: number; yMax: number }

/**
 * Split a wall into solid spans + lintel/sill pieces around its openings.
 * Defensive: clamps each opening to the wall and skips any that overlap an
 * already-consumed span, so we never emit a negative-length segment even if a
 * stale/invalid opening slips through.
 */
function buildSegments(wallLenCm: number, openings: Opening[], wallH: number): Seg[] {
  if (wallLenCm <= 0) return [];
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  const segs: Seg[] = [];
  let cursor = 0;

  for (const op of sorted) {
    const gapStart = Math.max(0, Math.min(wallLenCm, op.offset));
    const gapEnd   = Math.max(0, Math.min(wallLenCm, op.offset + op.width));
    if (gapStart <= cursor) {
      cursor = Math.max(cursor, gapEnd);
      continue;
    }
    // Solid wall before the opening.
    segs.push({ offset: cursor, length: gapStart - cursor, yMin: 0, yMax: wallH });
    const width = gapEnd - gapStart;
    if (width > 0) {
      if (op.kind === 'window') {
        segs.push({ offset: gapStart, length: width, yMin: 0,        yMax: SILL_H   });
        segs.push({ offset: gapStart, length: width, yMin: LINTEL_H, yMax: wallH   });
      }
      if (op.kind === 'door' && DOOR_H < wallH) {
        segs.push({ offset: gapStart, length: width, yMin: DOOR_H, yMax: wallH });
      }
    }
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < wallLenCm) {
    segs.push({ offset: cursor, length: wallLenCm - cursor, yMin: 0, yMax: wallH });
  }
  return segs;
}

export function WallMesh({ wall, quad, pointById, openingsOnWall, wallTex }: {
  wall: Floor['walls'][number];
  quad: WallQuad | undefined;
  pointById: Map<string, Floor['points'][number]>;
  openingsOnWall: Opening[];
  wallTex: THREE.CanvasTexture;
}) {
  const pa = pointById.get(wall.a);
  const pb = pointById.get(wall.b);
  if (!pa || !pb || !quad) return null;

  const wallLenCm = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const angle     = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const wallH     = (wall.height ?? DEFAULT_WALL_HEIGHT) * CM;
  const segs      = buildSegments(wallLenCm, openingsOnWall, wallH);
  const t         = wall.thickness * CM;

  // Plan-space edge point along the wall — mitered ends, square interior cuts.
  // Shared with the 2D layer (model/miter) so 2D and 3D corners agree exactly.
  const edge = (d: number, side: 1 | -1) =>
    wallEdgePoint(quad, pa, pb, wall.thickness, d, side);

  // Footprint of a segment as a THREE.Shape (cm → m). Plan y maps to world z;
  // the mesh is rotated -90° about X so the shape extrudes upward into a prism.
  const segmentShape = (d0: number, d1: number): THREE.Shape => {
    const pts = [edge(d0, 1), edge(d1, 1), edge(d1, -1), edge(d0, -1)];
    const shape = new THREE.Shape();
    shape.moveTo(pts[0]!.x * CM, -pts[0]!.y * CM);
    for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k]!.x * CM, -pts[k]!.y * CM);
    shape.closePath();
    return shape;
  };

  return (
    <group>
      {segs.map((seg, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, seg.yMin, 0]} castShadow receiveShadow>
          <extrudeGeometry
            args={[segmentShape(seg.offset, seg.offset + seg.length), { depth: seg.yMax - seg.yMin, bevelEnabled: false }]}
          />
          <meshStandardMaterial
            map={wallTex}
            color="#ddd8d0"
            roughness={0.92}
            metalness={0.0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Window glass */}
      {openingsOnWall.filter(o => o.kind === 'window').map((op, i) => {
        const frac = (op.offset + op.width / 2) / wallLenCm;
        const pos: [number, number, number] = [
          (pa.x + frac * (pb.x - pa.x)) * CM,
          (SILL_H + LINTEL_H) / 2,
          (pa.y + frac * (pb.y - pa.y)) * CM,
        ];
        return (
          <mesh key={`g${i}`} position={pos} rotation={[0, -angle, 0]}>
            <boxGeometry args={[op.width * CM, LINTEL_H - SILL_H, 0.02]} />
            <meshPhysicalMaterial
              color="#a8d4f0"
              transparent
              opacity={0.22}
              roughness={0.02}
              metalness={0.0}
              transmission={0.85}
              thickness={0.02}
            />
          </mesh>
        );
      })}

      {/* Door frame posts */}
      {openingsOnWall.filter(o => o.kind === 'door').flatMap((op, i) =>
        [op.offset, op.offset + op.width].map((off, j) => {
          const frac = off / wallLenCm;
          const pos: [number, number, number] = [
            (pa.x + frac * (pb.x - pa.x)) * CM,
            DOOR_H / 2,
            (pa.y + frac * (pb.y - pa.y)) * CM,
          ];
          return (
            <mesh key={`post-${i}-${j}`} position={pos} rotation={[0, -angle, 0]} castShadow>
              <boxGeometry args={[0.06, DOOR_H, t + 0.01]} />
              <meshStandardMaterial color="#8b7355" roughness={0.6} metalness={0.05} />
            </mesh>
          );
        })
      )}
    </group>
  );
}
