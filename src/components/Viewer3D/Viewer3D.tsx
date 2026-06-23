/**
 * 3D view — extrudes the 2D wall graph with door gaps and window glass.
 * Coordinate mapping: cm ÷ 100 → metres. 2D y → 3D z (depth axis).
 *
 * Visual approach: PBR materials + HDR environment + post-processing (SSAO,
 * SMAA, tone-mapping) so the result reads as an architectural interior render
 * rather than a technical model.
 */
import { useRef, useMemo } from 'react';
import { Canvas, useThree, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Text,
  Environment,
  SoftShadows,
  ContactShadows,
} from '@react-three/drei';
import { EffectComposer, SSAO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { usePlan } from '../../state/PlanContext';
import type { Floor, Opening } from '../../model/types';

extend({ THREE });

const CM     = 1 / 100;
const WALL_H = 2.7;   // metres — ceiling height
const DOOR_H = 2.1;
const SILL_H = 0.9;
const LINTEL_H = 2.1;

// Muted, warm interior palette (not vivid pastels)
const ROOM_FLOOR_COLORS = [
  '#c8b89a', // warm oak
  '#b5c4b1', // sage
  '#c4b5a0', // sandstone
  '#adb8c0', // cool stone
  '#c9bfb0', // linen
  '#b8c0b5', // eucalyptus
  '#c0b4a8', // terracotta blush
  '#b2bec3', // slate
];

// ── Procedural wall texture (canvas → texture) ─────────────────────────────
// Creates a subtle plaster-like roughness without needing external asset files.

function makePlasterTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8e0d8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.5;
    const v = Math.floor(210 + Math.random() * 40).toString(16).padStart(2, '0');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `#${v}${v}${v}`;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}

function makeCeilingTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5f2ee';
  ctx.fillRect(0, 0, size, size);
  // Subtle ceiling texture — very light grain
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = Math.floor(238 + Math.random() * 15).toString(16).padStart(2, '0');
    ctx.fillStyle = `#${v}${v}${v}`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// ── Wall segment builder ────────────────────────────────────────────────────

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
      segs.push({ offset: op.offset, length: op.width, yMin: 0,        yMax: SILL_H   });
      segs.push({ offset: op.offset, length: op.width, yMin: LINTEL_H, yMax: WALL_H   });
    }
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

// ── Wall mesh ───────────────────────────────────────────────────────────────

function WallMesh({ wall, pointById, openingsOnWall, wallTex }: {
  wall: Floor['walls'][number];
  pointById: Map<string, Floor['points'][number]>;
  openingsOnWall: Opening[];
  wallTex: THREE.CanvasTexture;
}) {
  const pa = pointById.get(wall.a);
  const pb = pointById.get(wall.b);
  if (!pa || !pb) return null;

  const wallLenCm = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const angle     = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const segs      = buildSegments(wallLenCm, openingsOnWall);
  const t         = wall.thickness * CM;

  // pa/pb are guaranteed non-null — early return guard is above
  const paNonNull = pa!;
  const pbNonNull = pb!;

  function segCenter(seg: Seg): [number, number, number] {
    const frac = (seg.offset + seg.length / 2) / wallLenCm;
    return [
      (paNonNull.x + frac * (pbNonNull.x - paNonNull.x)) * CM,
      (seg.yMin + seg.yMax) / 2,
      (paNonNull.y + frac * (pbNonNull.y - paNonNull.y)) * CM,
    ];
  }

  return (
    <group>
      {segs.map((seg, i) => (
        <mesh key={i} position={segCenter(seg)} rotation={[0, -angle, 0]} castShadow receiveShadow>
          <boxGeometry args={[seg.length * CM, seg.yMax - seg.yMin, t]} />
          <meshStandardMaterial
            map={wallTex}
            color="#ddd8d0"
            roughness={0.92}
            metalness={0.0}
          />
        </mesh>
      ))}

      {/* Window glass */}
      {openingsOnWall.filter(o => o.kind === 'window').map((op, i) => {
        const frac = (op.offset + op.width / 2) / wallLenCm;
        const pos: [number, number, number] = [
          (paNonNull.x + frac * (pbNonNull.x - paNonNull.x)) * CM,
          (SILL_H + LINTEL_H) / 2,
          (paNonNull.y + frac * (pbNonNull.y - paNonNull.y)) * CM,
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
            (paNonNull.x + frac * (pbNonNull.x - paNonNull.x)) * CM,
            DOOR_H / 2,
            (paNonNull.y + frac * (pbNonNull.y - paNonNull.y)) * CM,
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

// ── Ceiling slab ────────────────────────────────────────────────────────────

function CeilingSlab({ plot, ceilTex }: {
  plot: { widthCm: number; depthCm: number };
  ceilTex: THREE.CanvasTexture;
}) {
  const w = plot.widthCm * CM;
  const d = plot.depthCm * CM;
  return (
    <mesh position={[w / 2, WALL_H, d / 2]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial map={ceilTex} color="#f0ece6" roughness={0.95} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Room floor slab ─────────────────────────────────────────────────────────

function RoomSlab({ room, floor, colorIndex }: {
  room: Floor['rooms'][number];
  floor: Floor;
  colorIndex: number;
}) {
  const pointById = useMemo(() => new Map(floor.points.map(p => [p.id, p])), [floor.points]);
  const wallById  = useMemo(() => new Map(floor.walls.map(w => [w.id, w])), [floor.walls]);

  const ptIds = new Set<string>();
  for (const wid of room.wallIds) {
    const w = wallById.get(wid);
    if (w) { ptIds.add(w.a); ptIds.add(w.b); }
  }
  if (!ptIds.size) return null;

  const coords = [...ptIds]
    .map(id => pointById.get(id))
    .filter((p): p is Floor['points'][number] => p !== undefined);
  if (!coords.length) return null;

  const cx = coords.reduce((s, p) => s + p.x, 0) / coords.length;
  const cy = coords.reduce((s, p) => s + p.y, 0) / coords.length;
  const sorted = [...coords].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );

  const shape = new THREE.Shape();
  shape.moveTo(sorted[0]!.x * CM, sorted[0]!.y * CM);
  for (let i = 1; i < sorted.length; i++) shape.lineTo(sorted[i]!.x * CM, sorted[i]!.y * CM);
  shape.closePath();

  const color = ROOM_FLOOR_COLORS[colorIndex % ROOM_FLOOR_COLORS.length];

  return (
    <group>
      {/* Floor with reflector material for subtle sheen */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} />
      </mesh>
      <Text
        position={[cx * CM, 0.02, cy * CM]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.18}
        color="#4a3f35"
        anchorX="center"
        anchorY="middle"
        maxWidth={4}
        font={undefined}
      >
        {room.name}
      </Text>
    </group>
  );
}

// ── Camera initialiser ──────────────────────────────────────────────────────

function CameraRig({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const { camera } = useThree();
  const done = useRef(false);
  if (!done.current) {
    const dist = Math.max(w, d);
    camera.position.set(cx - dist * 0.9, dist * 0.8, cz + dist * 1.0);
    camera.lookAt(cx, 0, cz);
    done.current = true;
  }
  return null;
}

// ── Scene ───────────────────────────────────────────────────────────────────

function Scene() {
  const { plan } = usePlan();
  const floor = plan.floors[0];

  const wallTex  = useMemo(() => makePlasterTexture(),  []);
  const ceilTex  = useMemo(() => makeCeilingTexture(), []);

  if (!floor) return null;

  const { widthCm, depthCm } = plan.plot;
  const w  = widthCm * CM;
  const d  = depthCm * CM;
  const cx = w / 2;
  const cz = d / 2;

  const pointById = useMemo(
    () => new Map(floor.points.map(p => [p.id, p])),
    [floor.points],
  );

  const openingsByWall = useMemo(() => {
    const map = new Map<string, Opening[]>();
    for (const op of floor.openings) {
      const list = map.get(op.wallId) ?? [];
      list.push(op);
      map.set(op.wallId, list);
    }
    return map;
  }, [floor.openings]);

  return (
    <>
      <CameraRig cx={cx} cz={cz} w={w} d={d} />

      {/* HDR environment for realistic ambient light + reflections */}
      <Environment preset="apartment" background={false} />

      {/* Soft shadow pass */}
      <SoftShadows size={25} samples={16} focus={0.5} />

      {/* Key light — warm sun coming through windows */}
      <directionalLight
        position={[cx + w * 0.6, 5, cz - d * 0.4]}
        intensity={1.8}
        color="#fff8e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.001}
      />

      {/* Fill light — cooler, opposite side */}
      <directionalLight
        position={[cx - w * 0.5, 3, cz + d * 0.5]}
        intensity={0.4}
        color="#ddeeff"
        castShadow={false}
      />

      {/* Ceiling bounce */}
      <pointLight position={[cx, WALL_H - 0.1, cz]} intensity={0.6} color="#fff5e0" distance={Math.max(w, d) * 2} />

      {/* Ground plane — extends past the plot for a grounded look */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.005, cz]} receiveShadow>
        <planeGeometry args={[w + 10, d + 10]} />
        <meshStandardMaterial color="#b8b0a0" roughness={0.9} />
      </mesh>

      {/* Contact shadows baked under the structure */}
      <ContactShadows
        position={[cx, 0, cz]}
        width={w + 4}
        height={d + 4}
        far={0.5}
        blur={2.5}
        opacity={0.4}
        color="#1a1008"
      />

      {/* Room floors */}
      {floor.rooms.map((room, i) => (
        <RoomSlab key={room.id} room={room} floor={floor} colorIndex={i} />
      ))}

      {/* Ceiling */}
      <CeilingSlab plot={plan.plot} ceilTex={ceilTex} />

      {/* Walls */}
      {floor.walls.map(wall => (
        <WallMesh
          key={wall.id}
          wall={wall}
          pointById={pointById}
          openingsOnWall={openingsByWall.get(wall.id) ?? []}
          wallTex={wallTex}
        />
      ))}

      <OrbitControls makeDefault target={[cx, WALL_H * 0.35, cz]} minDistance={1} maxDistance={50} />
    </>
  );
}

// ── Post-processing ─────────────────────────────────────────────────────────

function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <SSAO
        radius={0.08}
        intensity={18}
        luminanceInfluence={0.6}
        color={new THREE.Color('#1a1008')}
      />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

// ── Public export ───────────────────────────────────────────────────────────

export function Viewer3D() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a1a' }}>
      <Canvas
        shadows="soft"
        camera={{ fov: 45, near: 0.05, far: 500 }}
        style={{ width: '100%', height: '100%' }}
        gl={{
          alpha: false,
          antialias: false, // SMAA handles AA
          toneMapping: THREE.NoToneMapping, // ToneMapping effect handles this
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => gl.setClearColor('#1a1a1a')}
      >
        <Scene />
        <PostFX />
      </Canvas>
    </div>
  );
}
