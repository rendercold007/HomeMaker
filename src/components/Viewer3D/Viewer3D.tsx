/**
 * 3D view — extrudes the 2D wall graph with door gaps and window glass.
 * Coordinate mapping: cm ÷ 100 → metres. 2D y → 3D z (depth axis).
 */
import { useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { usePlan } from '../../state/PlanContext';
import type { Floor, Opening } from '../../model/types';

const CM          = 1 / 100;
const WALL_H      = 2.7;   // metres — ceiling height
const DOOR_H      = 2.1;   // door clear height
const SILL_H      = 0.9;   // window sill
const LINTEL_H    = 2.1;   // window top (= door height)

const ROOM_COLORS = [
  '#bfdbfe', '#bbf7d0', '#fde68a', '#fecaca',
  '#ddd6fe', '#fed7aa', '#cffafe', '#d1fae5',
];

// ── Wall segment builder ───────────────────────────────────────────────────
// Splits a wall into solid box segments around openings.

interface Seg { offset: number; length: number; yMin: number; yMax: number }

function buildSegments(wallLenCm: number, openings: Opening[]): Seg[] {
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  const segs: Seg[] = [];
  let cursor = 0;

  for (const op of sorted) {
    if (op.offset > cursor) {
      segs.push({ offset: cursor, length: op.offset - cursor, yMin: 0, yMax: WALL_H });
    }
    if (op.kind === 'window') {
      // Keep solid below sill and above lintel; leave gap for glass.
      segs.push({ offset: op.offset, length: op.width, yMin: 0,        yMax: SILL_H   });
      segs.push({ offset: op.offset, length: op.width, yMin: LINTEL_H, yMax: WALL_H   });
    }
    // Doors: full gap — no segment added.
    // Add a thin header above the door frame to close the top.
    if (op.kind === 'door' && DOOR_H < WALL_H) {
      segs.push({ offset: op.offset, length: op.width, yMin: DOOR_H, yMax: WALL_H });
    }
    cursor = op.offset + op.width;
  }

  if (cursor < wallLenCm) {
    segs.push({ offset: cursor, length: wallLenCm - cursor, yMin: 0, yMax: WALL_H });
  }
  return segs;
}

// ── Wall mesh (with openings) ──────────────────────────────────────────────

function WallMesh({ wall, pointById, openingsOnWall }: {
  wall: Floor['walls'][number];
  pointById: Map<string, Floor['points'][number]>;
  openingsOnWall: Opening[];
}) {
  const pa = pointById.get(wall.a);
  const pb = pointById.get(wall.b);
  if (!pa || !pb) return null;

  const pax = pa.x, pay = pa.y, pbx = pb.x, pby = pb.y;
  const wallLenCm = Math.hypot(pbx - pax, pby - pay);
  const angle     = Math.atan2(pby - pay, pbx - pax);
  const segs      = buildSegments(wallLenCm, openingsOnWall);
  const t         = wall.thickness * CM;

  function segCenter(seg: Seg): [number, number, number] {
    const frac = (seg.offset + seg.length / 2) / wallLenCm;
    return [
      (pax + frac * (pbx - pax)) * CM,
      (seg.yMin + seg.yMax) / 2,
      (pay + frac * (pby - pay)) * CM,
    ];
  }

  return (
    <group>
      {/* Solid wall segments */}
      {segs.map((seg, i) => (
        <mesh
          key={i}
          position={segCenter(seg)}
          rotation={[0, -angle, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[seg.length * CM, seg.yMax - seg.yMin, t]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.85} metalness={0.05} />
        </mesh>
      ))}

      {/* Window glass panes */}
      {openingsOnWall.filter((o) => o.kind === 'window').map((op, i) => {
        const frac = (op.offset + op.width / 2) / wallLenCm;
        const pos: [number, number, number] = [
          (pax + frac * (pbx - pax)) * CM,
          (SILL_H + LINTEL_H) / 2,
          (pay + frac * (pby - pay)) * CM,
        ];
        return (
          <mesh key={`glass-${i}`} position={pos} rotation={[0, -angle, 0]}>
            <boxGeometry args={[op.width * CM, LINTEL_H - SILL_H, 0.02]} />
            <meshStandardMaterial color="#7dd3fc" transparent opacity={0.35} roughness={0.1} />
          </mesh>
        );
      })}

      {/* Door frame posts (thin pillars either side of door gap) */}
      {openingsOnWall.filter((o) => o.kind === 'door').map((op, i) => {
        const postW = 0.08; // 8 cm post width in metres
        return [op.offset, op.offset + op.width].map((off, j) => {
          const frac = off / wallLenCm;
          const pos: [number, number, number] = [
            (pax + frac * (pbx - pax)) * CM,
            DOOR_H / 2,
            (pay + frac * (pby - pay)) * CM,
          ];
          return (
            <mesh key={`post-${i}-${j}`} position={pos} rotation={[0, -angle, 0]}>
              <boxGeometry args={[postW, DOOR_H, t]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.7} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

// ── Room floor slab ────────────────────────────────────────────────────────

function RoomSlab({ room, floor, colorIndex }: {
  room: Floor['rooms'][number];
  floor: Floor;
  colorIndex: number;
}) {
  const pointById = new Map(floor.points.map((p) => [p.id, p]));
  const wallById  = new Map(floor.walls.map((w) => [w.id, w]));

  const ptIds = new Set<string>();
  for (const wid of room.wallIds) {
    const w = wallById.get(wid);
    if (w) { ptIds.add(w.a); ptIds.add(w.b); }
  }
  if (!ptIds.size) return null;

  const coords = [...ptIds]
    .map((id) => pointById.get(id))
    .filter((p) => p !== undefined) as Array<{ id: string; x: number; y: number }>;

  if (!coords.length) return null;

  const cx = coords.reduce((s, p) => s + p.x, 0) / coords.length;
  const cy = coords.reduce((s, p) => s + p.y, 0) / coords.length;
  const sorted = [...coords].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );

  if (!sorted[0]) return null;
  const shape = new THREE.Shape();
  shape.moveTo(sorted[0].x * CM, sorted[0].y * CM);
  for (let i = 1; i < sorted.length; i++) {
    const pt = sorted[i];
    if (pt) shape.lineTo(pt.x * CM, pt.y * CM);
  }
  shape.closePath();

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={ROOM_COLORS[colorIndex % ROOM_COLORS.length]} roughness={1} />
      </mesh>
      <Text
        position={[cx * CM, 0.05, cy * CM]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        color="#1e293b"
        anchorX="center"
        anchorY="middle"
        maxWidth={4}
      >
        {room.name}
      </Text>
    </group>
  );
}

// ── Camera initialiser ─────────────────────────────────────────────────────

function CameraRig({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const { camera } = useThree();
  const done = useRef(false);
  if (!done.current) {
    camera.position.set(cx - w * 0.8, Math.max(w, d) * 0.9, cz + d * 0.9);
    camera.lookAt(cx, 0, cz);
    done.current = true;
  }
  return null;
}

// ── Scene ──────────────────────────────────────────────────────────────────

function Scene() {
  const { plan } = usePlan();
  const floor = plan.floors[0];
  if (!floor) return null;

  const { widthCm, depthCm } = plan.plot;
  const w  = widthCm * CM;
  const d  = depthCm * CM;
  const cx = w / 2;
  const cz = d / 2;

  const pointById  = new Map(floor.points.map((p) => [p.id, p]));
  // Group openings by wallId for fast lookup.
  const openingsByWall = new Map<string, Opening[]>();
  for (const op of floor.openings) {
    const list = openingsByWall.get(op.wallId) ?? [];
    list.push(op);
    openingsByWall.set(op.wallId, list);
  }

  return (
    <>
      <CameraRig cx={cx} cz={cz} w={w} d={d} />

      <ambientLight intensity={0.65} />
      <directionalLight
        position={[cx + w, 6, cz - d]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.01, cz]} receiveShadow>
        <planeGeometry args={[w + 6, d + 6]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>

      {/* Room slabs */}
      {floor.rooms.map((room, i) => (
        <RoomSlab key={room.id} room={room} floor={floor} colorIndex={i} />
      ))}

      {/* Walls with openings */}
      {floor.walls.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          pointById={pointById}
          openingsOnWall={openingsByWall.get(wall.id) ?? []}
        />
      ))}

      <OrbitControls makeDefault target={[cx, 0, cz]} />
    </>
  );
}

// ── Public export ──────────────────────────────────────────────────────────

export function Viewer3D() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#f8fafc' }}>
      <Canvas
        shadows
        camera={{ fov: 50, near: 0.1, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ alpha: false }}
        onCreated={({ gl }) => gl.setClearColor('#f8fafc')}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
