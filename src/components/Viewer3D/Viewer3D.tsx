/**
 * 3D view — extrudes the 2D wall graph with door gaps and window glass.
 * Coordinate mapping: cm ÷ 100 → metres. 2D y → 3D z (depth axis).
 *
 * Visual approach: PBR materials + HDR environment + post-processing (SSAO,
 * SMAA, tone-mapping) so the result reads as an architectural interior render
 * rather than a technical model.
 */
import { useRef, useMemo, Component, type ReactNode } from 'react';
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
import type { Floor, Opening, Furniture } from '../../model/types';
import { getFurnitureDef } from '../../model/furniture';

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

// ── Furniture meshes ────────────────────────────────────────────────────────
// Each type gets a distinct silhouette so it reads clearly in 3D.
// All heights and proportions are realistic (cm → m via CM constant).

function FurnitureMesh({ item }: { item: Furniture }) {
  const def = getFurnitureDef(item.type);
  if (!def) return null;

  const w  = def.widthCm  * CM;
  const d  = def.heightCm * CM;
  const x  = item.x * CM;
  const z  = item.y * CM;
  const rot = (item.rotationDeg * Math.PI) / 180;

  switch (item.type) {
    case 'double_bed':
    case 'single_bed': {
      const frameH = 0.25;
      const mattH  = 0.18;
      const pillowW = item.type === 'double_bed' ? 0.55 : 0.45;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Bed frame */}
          <mesh position={[0, frameH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, frameH, d]} />
            <meshStandardMaterial color="#6b4f3a" roughness={0.7} metalness={0.05} />
          </mesh>
          {/* Headboard */}
          <mesh position={[0, frameH + 0.3, -d / 2 + 0.05]} castShadow>
            <boxGeometry args={[w, 0.6, 0.06]} />
            <meshStandardMaterial color="#5a3e2b" roughness={0.75} />
          </mesh>
          {/* Mattress */}
          <mesh position={[0, frameH + mattH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.04, mattH, d - 0.04]} />
            <meshStandardMaterial color="#f0ece6" roughness={0.95} />
          </mesh>
          {/* Pillows */}
          {[[-pillowW / 2 - 0.05, 0], [pillowW / 2 + 0.05, 0]]
            .slice(0, item.type === 'double_bed' ? 2 : 1)
            .map(([px], pi) => (
              <mesh key={pi} position={[px ?? 0, frameH + mattH + 0.06, -d / 2 + 0.22]} castShadow>
                <boxGeometry args={[pillowW, 0.1, 0.4]} />
                <meshStandardMaterial color="#ffffff" roughness={0.98} />
              </mesh>
            ))}
          {/* Blanket */}
          <mesh position={[0, frameH + mattH + 0.04, d * 0.1]} castShadow>
            <boxGeometry args={[w - 0.06, 0.06, d * 0.55]} />
            <meshStandardMaterial color="#c4a882" roughness={0.9} />
          </mesh>
        </group>
      );
    }

    case 'sofa': {
      const seatH  = 0.42;
      const backH  = 0.45;
      const armW   = 0.12;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Seat base */}
          <mesh position={[0, seatH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, seatH, d * 0.55]} />
            <meshStandardMaterial color="#8b6f5e" roughness={0.85} />
          </mesh>
          {/* Seat cushion */}
          <mesh position={[0, seatH + 0.06, d * 0.02]} castShadow>
            <boxGeometry args={[w - armW * 2 - 0.04, 0.12, d * 0.5]} />
            <meshStandardMaterial color="#a08070" roughness={0.9} />
          </mesh>
          {/* Back */}
          <mesh position={[0, seatH + backH / 2, -d * 0.23]} castShadow>
            <boxGeometry args={[w, backH, d * 0.2]} />
            <meshStandardMaterial color="#8b6f5e" roughness={0.85} />
          </mesh>
          {/* Arms */}
          {([-1, 1] as const).map((side, si) => (
            <mesh key={si} position={[side * (w / 2 - armW / 2), seatH + 0.2, 0]} castShadow>
              <boxGeometry args={[armW, 0.18, d * 0.55]} />
              <meshStandardMaterial color="#7a6050" roughness={0.85} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'dining_table': {
      const tableH = 0.76;
      const legW   = 0.06;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tabletop */}
          <mesh position={[0, tableH, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#a07850" roughness={0.5} metalness={0.05} />
          </mesh>
          {/* Legs */}
          {([-1, 1] as const).flatMap((sx) =>
            ([-1, 1] as const).map((sz, li) => (
              <mesh key={`${sx}${li}`} position={[sx * (w / 2 - legW), tableH / 2, sz * (d / 2 - legW)]} castShadow>
                <boxGeometry args={[legW, tableH, legW]} />
                <meshStandardMaterial color="#8b6535" roughness={0.6} />
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'wardrobe': {
      const wardH = 2.1;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, wardH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, wardH, d]} />
            <meshStandardMaterial color="#c8b89a" roughness={0.7} />
          </mesh>
          {/* Door lines — thin darker strips to suggest panels */}
          {[w / 4, -w / 4].map((ox, i) => (
            <mesh key={i} position={[ox, wardH / 2, d / 2 + 0.001]} castShadow={false}>
              <boxGeometry args={[0.01, wardH - 0.1, 0.001]} />
              <meshStandardMaterial color="#9a8060" roughness={0.8} />
            </mesh>
          ))}
          {/* Handles */}
          {[w / 4, -w / 4].map((ox, i) => (
            <mesh key={`h${i}`} position={[ox - 0.06, wardH * 0.5, d / 2 + 0.02]} castShadow={false}>
              <boxGeometry args={[0.03, 0.015, 0.015]} />
              <meshStandardMaterial color="#c0a060" roughness={0.3} metalness={0.6} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'tv_unit': {
      const unitH = 0.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, unitH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, unitH, d]} />
            <meshStandardMaterial color="#3d3530" roughness={0.7} />
          </mesh>
          {/* TV screen */}
          <mesh position={[0, unitH + 0.55, -d / 2 + 0.02]} castShadow>
            <boxGeometry args={[w * 0.9, 0.7, 0.04]} />
            <meshStandardMaterial color="#111111" roughness={0.1} metalness={0.4} />
          </mesh>
          {/* Screen face */}
          <mesh position={[0, unitH + 0.55, -d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.86, 0.65, 0.001]} />
            <meshStandardMaterial color="#0a0a1a" roughness={0.05} metalness={0.1} />
          </mesh>
        </group>
      );
    }

    case 'kitchen_counter': {
      const counterH = 0.9;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet body */}
          <mesh position={[0, (counterH - 0.04) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, counterH - 0.04, d]} />
            <meshStandardMaterial color="#e8dfd0" roughness={0.8} />
          </mesh>
          {/* Counter slab */}
          <mesh position={[0, counterH - 0.02, 0]} castShadow>
            <boxGeometry args={[w, 0.04, d + 0.02]} />
            <meshStandardMaterial color="#8a8078" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Sink cutout suggestion — dark rectangle on top */}
          <mesh position={[0, counterH + 0.001, 0]}>
            <boxGeometry args={[w * 0.45, 0.001, d * 0.5]} />
            <meshStandardMaterial color="#5a5a5a" roughness={0.2} metalness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'toilet': {
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tank */}
          <mesh position={[0, 0.38, -d / 2 + 0.12]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.34, 0.2]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.6} />
          </mesh>
          {/* Bowl */}
          <mesh position={[0, 0.22, d * 0.05]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.4, w * 0.38, 0.32, 16]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.55} />
          </mesh>
        </group>
      );
    }

    case 'wash_basin': {
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Pedestal */}
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.1, 0.8, 12]} />
            <meshStandardMaterial color="#f0ece8" roughness={0.6} />
          </mesh>
          {/* Basin */}
          <mesh position={[0, 0.82, 0]} castShadow>
            <cylinderGeometry args={[w * 0.44, w * 0.38, 0.14, 16]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.5} />
          </mesh>
        </group>
      );
    }

    case 'pooja_unit': {
      const unitH = 1.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, unitH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, unitH, d]} />
            <meshStandardMaterial color="#c8a050" roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Arch cutout suggestion — slightly recessed darker face */}
          <mesh position={[0, unitH * 0.55, d / 2 + 0.001]}>
            <boxGeometry args={[w * 0.6, unitH * 0.7, 0.001]} />
            <meshStandardMaterial color="#8b6010" roughness={0.7} />
          </mesh>
          {/* Diya / lamp glow point */}
          <pointLight position={[0, unitH * 0.4, d / 2 + 0.1]} intensity={0.3} color="#ffaa00" distance={1.5} />
        </group>
      );
    }

    default: {
      // Generic box fallback for unknown types
      return (
        <mesh position={[x, 0.3, z]} rotation={[0, -rot, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.6, d]} />
          <meshStandardMaterial color="#b0a898" roughness={0.8} />
        </mesh>
      );
    }
  }
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

      {/* Furniture */}
      {floor.furniture.map(item => (
        <FurnitureMesh key={item.id} item={item} />
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
        worldDistanceThreshold={20}
        worldDistanceFalloff={5}
        worldProximityThreshold={0.3}
        worldProximityFalloff={0.1}
      />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

// ── Error boundary ──────────────────────────────────────────────────────────

class Viewer3DErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ width: '100%', height: '100%', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#ff6b6b', textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>3D view failed to load</div>
            <div style={{ fontSize: 12, color: '#888', maxWidth: 400 }}>{this.state.error}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Public export ───────────────────────────────────────────────────────────

export function Viewer3D() {
  return (
    <Viewer3DErrorBoundary>
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
    </Viewer3DErrorBoundary>
  );
}
