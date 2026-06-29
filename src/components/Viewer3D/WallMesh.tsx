/**
 * Wall mesh — extrudes one wall's mitered footprint into a prism, split into
 * segments around door/window openings, with window glass and door posts.
 */
import * as THREE from 'three';
import type { Floor, Opening } from '../../model/types';
import { DEFAULT_WALL_HEIGHT } from '../../model/planEdits';
import { wallEdgePoint, type WallQuad } from '../../model/miter';
import { wallMaterial } from './materials';
import { CM, DOOR_H, SILL_H, LINTEL_H, SKIRT_H, TRIM_PROUD } from './constants';

interface Seg { offset: number; length: number; yMin: number; yMax: number }

/**
 * Clamp an opening's span to the wall `[0, wallLenCm]`. The single clamp
 * authority for this file — both the wall segments and the glass/post meshes
 * derive their geometry from this, so they can never disagree even if a stale
 * or out-of-range opening slips through. `width <= 0` means it falls entirely
 * off the wall and should be skipped.
 */
function clampSpan(op: Opening, wallLenCm: number): { start: number; end: number; width: number } {
  const start = Math.max(0, Math.min(wallLenCm, op.offset));
  const end   = Math.max(0, Math.min(wallLenCm, op.offset + op.width));
  return { start, end, width: end - start };
}

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
    const { start: gapStart, end: gapEnd, width } = clampSpan(op, wallLenCm);
    if (gapStart <= cursor) {
      cursor = Math.max(cursor, gapEnd);
      continue;
    }
    // Solid wall before the opening.
    segs.push({ offset: cursor, length: gapStart - cursor, yMin: 0, yMax: wallH });
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

/**
 * Spans of the wall that carry a skirting board: the whole length minus the
 * door openings (skirting runs *under* windows but stops at doorways). Mirrors
 * `buildSegments`' defensive clamping so it can never emit a negative span.
 */
function skirtingSpans(wallLenCm: number, openings: Opening[]): Array<[number, number]> {
  if (wallLenCm <= 0) return [];
  const doors = openings
    .filter(o => o.kind === 'door')
    .sort((a, b) => a.offset - b.offset);
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const op of doors) {
    const { start, end, width } = clampSpan(op, wallLenCm);
    if (width <= 0 || start <= cursor) { cursor = Math.max(cursor, end); continue; }
    spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < wallLenCm) spans.push([cursor, wallLenCm]);
  return spans;
}

export function WallMesh({ wall, quad, pointById, openingsOnWall }: {
  wall: Floor['walls'][number];
  quad: WallQuad | undefined;
  pointById: Map<string, Floor['points'][number]>;
  openingsOnWall: Opening[];
}) {
  const pa = pointById.get(wall.a);
  const pb = pointById.get(wall.b);
  if (!pa || !pb || !quad) return null;

  const wallLenCm = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const angle     = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const wallH     = (wall.height ?? DEFAULT_WALL_HEIGHT) * CM;
  const segs      = buildSegments(wallLenCm, openingsOnWall, wallH);
  const t         = wall.thickness * CM;
  const mat       = wallMaterial();

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

  // Outward unit normal (away from the wall centreline) for a given side, in
  // plan space. Used to stand the skirting board proud of the wall face.
  const dirx = (pb.x - pa.x) / (wallLenCm || 1);
  const diry = (pb.y - pa.y) / (wallLenCm || 1);
  const proudCm = TRIM_PROUD / CM;
  // A thin skirting strip hugging one side of the wall over [d0,d1]: the wall
  // face edge, pushed out by `proudCm` along the side normal, as a Shape.
  const skirtShape = (d0: number, d1: number, side: 1 | -1): THREE.Shape => {
    const i0 = edge(d0, side), i1 = edge(d1, side);
    // side normal: +side * (-diry, dirx) points away from the centreline.
    const ox = side * -diry * proudCm, oy = side * dirx * proudCm;
    const pts = [i0!, i1!, { x: i1!.x + ox, y: i1!.y + oy }, { x: i0!.x + ox, y: i0!.y + oy }];
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x * CM, -pts[0].y * CM);
    for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k].x * CM, -pts[k].y * CM);
    shape.closePath();
    return shape;
  };
  const skirtSpans = skirtingSpans(wallLenCm, openingsOnWall);

  return (
    <group>
      {segs.map((seg, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, seg.yMin, 0]} castShadow receiveShadow>
          <extrudeGeometry
            args={[segmentShape(seg.offset, seg.offset + seg.length), { depth: seg.yMax - seg.yMin, bevelEnabled: false }]}
          />
          <meshStandardMaterial
            map={mat.map}
            normalMap={mat.normalMap}
            normalScale={mat.normalScale}
            roughnessMap={mat.roughnessMap}
            color={mat.color}
            roughness={mat.roughness}
            metalness={mat.metalness}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Skirting boards — a short strip standing proud of each wall face,
          running the wall's length but breaking at doorways. Hides the
          wall-floor seam and reads as built trim. */}
      {([1, -1] as const).flatMap((side) =>
        skirtSpans.map(([d0, d1], i) => (
          <mesh key={`sk${side}-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} castShadow receiveShadow>
            <extrudeGeometry args={[skirtShape(d0, d1, side), { depth: SKIRT_H, bevelEnabled: false }]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.45} metalness={0.0} />
          </mesh>
        )),
      )}

      {/* Window glass — driven by the clamped span so it matches the wall hole. */}
      {openingsOnWall.filter(o => o.kind === 'window').map((op, i) => {
        const { start, width } = clampSpan(op, wallLenCm);
        if (width <= 0) return null;
        const frac = (start + width / 2) / wallLenCm;
        const pos: [number, number, number] = [
          (pa.x + frac * (pb.x - pa.x)) * CM,
          (SILL_H + LINTEL_H) / 2,
          (pa.y + frac * (pb.y - pa.y)) * CM,
        ];
        const sillPos: [number, number, number] = [pos[0], SILL_H, pos[2]];
        return (
          <group key={`g${i}`}>
            <mesh position={pos} rotation={[0, -angle, 0]}>
              <boxGeometry args={[width * CM, LINTEL_H - SILL_H, 0.02]} />
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
            {/* Sill ledge — a shallow shelf at the bottom of the opening,
                standing proud of the wall on both faces. */}
            <mesh position={sillPos} rotation={[0, -angle, 0]} castShadow receiveShadow>
              <boxGeometry args={[width * CM + 0.04, 0.03, t + TRIM_PROUD * 2]} />
              <meshStandardMaterial color="#eee9e0" roughness={0.5} metalness={0.0} />
            </mesh>
          </group>
        );
      })}

      {/* Door frame posts — placed at the clamped span ends. */}
      {openingsOnWall.filter(o => o.kind === 'door').flatMap((op, i) => {
        const { start, end, width } = clampSpan(op, wallLenCm);
        if (width <= 0) return [];
        return [start, end].map((off, j) => {
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
        });
      })}
    </group>
  );
}
