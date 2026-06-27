/**
 * 3D view — orchestrates the scene: stacks floors, places lighting, ground,
 * camera rig and post-processing. The wall / room / furniture meshes live in
 * their own modules; this file wires them to the shared Plan via the store.
 *
 * Coordinate mapping: cm ÷ 100 → metres. 2D y → 3D z (depth axis). The 3D view
 * is a pure function of the Plan — no 3D-only state is written back to the model.
 */
import {
  useRef,
  useMemo,
  useState,
  useLayoutEffect,
  Component,
  type ComponentRef,
  type RefObject,
  type ReactNode,
} from 'react';
import { Canvas, useThree, extend } from '@react-three/fiber';
import { OrbitControls, Environment, SoftShadows, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { usePlan } from '../../state/store';
import type { Floor, Opening } from '../../model/types';
import { computeWallQuads } from '../../model/miter';
import { CM, WALL_H } from './constants';
import { makePlasterTexture } from './textures';
import { WallMesh } from './WallMesh';
import { RoomSlab } from './RoomSlab';
import { FurnitureItem } from './FurnitureItem';
import { PostFX } from './PostFX';

extend({ THREE });

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

// ── Camera initialiser ──────────────────────────────────────────────────────

function CameraRig({ cx, cz, w, d, buildingH, controlsRef, resetSignal }: {
  cx: number; cz: number; w: number; d: number; buildingH: number;
  controlsRef: RefObject<OrbitControlsRef>;
  resetSignal: number;
}) {
  const camera = useThree((s) => s.camera);

  // Frame the whole building on mount, whenever its extent changes, and on each
  // explicit "reset view" (resetSignal bump). useLayoutEffect so it lands before
  // paint, after the OrbitControls ref is assigned.
  useLayoutEffect(() => {
    const dist = Math.max(w, d);
    // Lower, pulled-back camera looking at mid-building height so taller
    // (multi-storey) buildings read as an elevation rather than a top-down box.
    const camH = Math.max(dist * 0.55, buildingH * 1.05);
    camera.position.set(cx - dist, camH, cz + dist * 1.2);
    const target = new THREE.Vector3(cx, buildingH * 0.45, cz);
    camera.lookAt(target);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [cx, cz, w, d, buildingH, camera, controlsRef, resetSignal]);

  return null;
}

// ── Per-floor group ──────────────────────────────────────────────────────────

function FloorGroup({ floor, yOffset, wallTex }: {
  floor: Floor;
  yOffset: number;
  wallTex: THREE.CanvasTexture;
}) {
  const pointById = useMemo(
    () => new Map(floor.points.map(p => [p.id, p])),
    [floor.points],
  );
  const wallQuads = useMemo(
    () => computeWallQuads(floor.points, floor.walls),
    [floor.points, floor.walls],
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
    <group position={[0, yOffset, 0]}>
      {floor.rooms.map((room) => (
        <RoomSlab key={room.id} room={room} floor={floor} />
      ))}
      {floor.walls.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          quad={wallQuads.get(wall.id)}
          pointById={pointById}
          openingsOnWall={openingsByWall.get(wall.id) ?? []}
          wallTex={wallTex}
        />
      ))}
      {floor.furniture.map((item) => (
        <FurnitureItem key={item.id} item={item} />
      ))}
    </group>
  );
}

// ── Scene ───────────────────────────────────────────────────────────────────

function Scene({ resetSignal }: { resetSignal: number }) {
  const { plan } = usePlan();
  const wallTex = useMemo(() => makePlasterTexture(), []);
  const controlsRef = useRef<OrbitControlsRef>(null);

  const floors = plan.floors;
  if (floors.length === 0) return null;

  const { widthCm, depthCm } = plan.plot;
  const w  = widthCm * CM;
  const d  = depthCm * CM;
  const cx = w / 2;
  const cz = d / 2;
  const maxLevel = floors.reduce((m, f) => Math.max(m, f.level), 0);

  // Ground is sized to the whole building's extent (the bounding box of every
  // floor's points, unioned with the plot), since walls can be drawn well
  // outside the default plot rectangle.
  const GROUND_MARGIN = 3; // metres of ground around the structure
  let minX = 0, maxX = widthCm, minY = 0, maxY = depthCm;
  for (const f of floors) {
    for (const p of f.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const groundCx = ((minX + maxX) / 2) * CM;
  const groundCz = ((minY + maxY) / 2) * CM;
  const groundW  = (maxX - minX) * CM + GROUND_MARGIN * 2;
  const groundD  = (maxY - minY) * CM + GROUND_MARGIN * 2;

  return (
    <>
      <CameraRig
        cx={cx} cz={cz} w={w} d={d}
        buildingH={(maxLevel + 1) * WALL_H}
        controlsRef={controlsRef}
        resetSignal={resetSignal}
      />

      {/* HDR environment for realistic ambient light + reflections */}
      <Environment preset="apartment" background={false} />

      {/* Soft shadow pass */}
      <SoftShadows size={25} samples={16} focus={0.5} />

      {/* Key light — warm sun coming through windows */}
      <directionalLight
        position={[cx + w * 0.6, 5 + maxLevel * WALL_H, cz - d * 0.4]}
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
      <pointLight position={[cx, (maxLevel + 0.9) * WALL_H, cz]} intensity={0.6} color="#fff5e0" distance={Math.max(w, d) * 2} />

      {/* Ground plane — covers the whole building footprint */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[groundCx, -0.005, groundCz]} receiveShadow>
        <planeGeometry args={[groundW, groundD]} />
        <meshStandardMaterial color="#b8b0a0" roughness={0.9} />
      </mesh>

      {/* Contact shadows baked under the structure */}
      <ContactShadows
        position={[groundCx, 0, groundCz]}
        width={groundW}
        height={groundD}
        far={0.5}
        blur={2.5}
        opacity={0.4}
        color="#1a1008"
      />

      {/* Floors, stacked at their level height */}
      {floors.map((f) => (
        <FloorGroup key={f.id} floor={f} yOffset={f.level * WALL_H} wallTex={wallTex} />
      ))}

      {/* Target is owned by CameraRig (set imperatively on frame/reset) so the
          two don't fight; no `target` prop here. */}
      <OrbitControls ref={controlsRef} makeDefault minDistance={1} maxDistance={80} />
    </>
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
  // Bumping this re-frames the camera (see CameraRig). The button lives outside
  // the Canvas, so it talks to the rig through this signal rather than a ref.
  const [resetSignal, setResetSignal] = useState(0);

  return (
    <Viewer3DErrorBoundary>
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1a1a1a' }}>
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
        <Scene resetSignal={resetSignal} />
        <PostFX />
      </Canvas>

      <button
        type="button"
        onClick={() => setResetSignal((n) => n + 1)}
        title="Reset camera to frame the whole plan"
        style={{
          position: 'absolute', top: 12, right: 12,
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          color: '#e2e8f0', background: 'rgba(30,41,59,0.85)',
          border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
          cursor: 'pointer', backdropFilter: 'blur(4px)',
        }}
      >
        Reset view
      </button>
    </div>
    </Viewer3DErrorBoundary>
  );
}
