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
  useEffect,
  useLayoutEffect,
  Component,
  type ComponentRef,
  type RefObject,
  type ReactNode,
} from 'react';
import { Canvas, useThree, extend } from '@react-three/fiber';
import { OrbitControls, Environment, SoftShadows, ContactShadows } from '@react-three/drei';
import { Pathtracer, usePathtracer } from '@react-three/gpu-pathtracer';
import * as THREE from 'three';
import { usePlan } from '../../state/store';
import type { Floor, Opening } from '../../model/types';
import { computeWallQuads } from '../../model/miter';
import { CM, WALL_H } from './constants';
import { roomRing } from '../../model/roomDetect';
import { WallMesh } from './WallMesh';
import { RoomSlab, CeilingSlab } from './RoomSlab';
import { FurnitureItem } from './FurnitureItem';
import { WalkControls } from './WalkControls';
import { buildColliders } from './walkCollision';
import { PostFX } from './PostFX';

type ViewMode = 'orbit' | 'walk';

extend({ THREE });

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

// Candela for the per-room ceiling lamps used only in path-traced render mode.
// Physical inverse-square falloff, so this is far higher than a rasteriser value.
const RENDER_LIGHT_INTENSITY = 60;

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

function FloorGroup({ floor, yOffset, showCeiling, rendering }: {
  floor: Floor;
  yOffset: number;
  showCeiling: boolean;
  rendering: boolean;
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

  // Render-mode interior lighting. A path tracer is physically correct, so a
  // closed room with no windows gets no daylight and renders black — unlike the
  // rasteriser, which fakes non-occluded ambient. So in render mode we drop a
  // ceiling light into each room (point lights are honoured by the path tracer),
  // guaranteeing every room is lit whether it's open-topped or sealed.
  const roomLights = useMemo(() => {
    if (!rendering) return [];
    return floor.rooms.flatMap((room) => {
      const ring = roomRing(room, floor.points, floor.walls);
      if (ring.length < 3) return [];
      const cx = (ring.reduce((s, p) => s + p.x, 0) / ring.length) * CM;
      const cz = (ring.reduce((s, p) => s + p.y, 0) / ring.length) * CM;
      return [{ id: room.id, x: cx, z: cz }];
    });
  }, [rendering, floor.rooms, floor.points, floor.walls]);

  return (
    <group position={[0, yOffset, 0]}>
      {roomLights.map((l) => (
        <pointLight
          key={`light-${l.id}`}
          position={[l.x, WALL_H * 0.92, l.z]}
          intensity={RENDER_LIGHT_INTENSITY}
          color="#fff2dc"
          distance={0}
          decay={2}
        />
      ))}
      {floor.rooms.map((room) => (
        <RoomSlab key={room.id} room={room} floor={floor} />
      ))}
      {showCeiling && floor.rooms.map((room) => (
        <CeilingSlab key={`ceil-${room.id}`} room={room} floor={floor} />
      ))}
      {floor.walls.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          quad={wallQuads.get(wall.id)}
          pointById={pointById}
          openingsOnWall={openingsByWall.get(wall.id) ?? []}
        />
      ))}
      {floor.furniture.map((item) => (
        <FurnitureItem key={item.id} item={item} />
      ))}
    </group>
  );
}

// ── Path-tracer scene sync ───────────────────────────────────────────────────

/**
 * Forces the path tracer to (re)build its BVH from the *settled* scene. The
 * Pathtracer captures the scene once, in a layout effect, in the same commit
 * that mounts the furniture — so freshly-cloned GLB nodes can be baked before
 * their world matrices are synced, which renders them at raw (giant) scale. We
 * rebuild a frame later, when matrices have settled, and again whenever the plan
 * changes (the tracer doesn't otherwise notice edits). Must live *inside*
 * <Pathtracer> to read its context.
 */
function PathtracerSync({ dep }: { dep: unknown }) {
  const api = usePathtracer();
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        api.update(); // rebuild BVH from current (settled) world matrices
        api.reset();  // restart sample accumulation
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [api, dep]);
  return null;
}

// ── Scene ───────────────────────────────────────────────────────────────────

function Scene({ resetSignal, showCeiling, mode, rendering }: {
  resetSignal: number; showCeiling: boolean; mode: ViewMode; rendering: boolean;
}) {
  const { plan } = usePlan();
  const controlsRef = useRef<OrbitControlsRef>(null);

  // The path tracer outputs a tone-mapped image directly (PostFX is off in
  // render mode), so the renderer itself must tone-map then; in the rasterised
  // view the ToneMapping post effect does it, so the renderer stays linear.
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    gl.toneMapping = rendering ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    // 1.0 in render: ACES already rolls off highlights, and the physical per-room
    // lamps carry the interior, so we don't push exposure (which was clipping
    // sunlit/exterior walls to pure white).
    gl.toneMappingExposure = 1;
  }, [gl, rendering]);

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

  const boundsM = {
    minX: minX * CM, maxX: maxX * CM,
    minZ: minY * CM, maxZ: maxY * CM,
  };

  // Wall colliders for the walkthrough — ground floor only (the walk is pinned
  // there). Doorways are already removed inside buildColliders.
  const groundFloor = floors.find((f) => f.level === 0) ?? floors[0]!;
  const colliders = useMemo(() => buildColliders(groundFloor), [groundFloor]);

  // The renderable world — everything the path tracer should "see". Lights, the
  // HDR environment, ground and the building. The rasteriser-only fakes
  // (SoftShadows, ContactShadows) are skipped in render mode because the path
  // tracer computes real shadows/AO from the same lights.
  const world = (
    <>
      {/* HDR environment for realistic ambient light + reflections. In render
          mode we pull it back: a bright HDRI pouring through windows was washing
          the walls white. The path tracer's GI + the per-room lamps light the
          interior, so the env only needs to add sky tint and reflections. */}
      <Environment preset="apartment" background={false} environmentIntensity={rendering ? 0.85 : 1} />

      {/* Hemisphere fill — warm "sky" from above, cool floor bounce from below.
          A natural ambient gradient so shadowed sides aren't a dead flat tone.
          Cut hard in render mode: flat ambient kills contrast, and the path
          tracer already bounces real light into the shadows (true GI). */}
      <hemisphereLight args={['#fff4e2', '#cdd4e4', rendering ? 0.12 : 0.35]} position={[cx, (maxLevel + 1) * WALL_H, cz]} />

      {/* Soft shadow pass — rasteriser only; the path tracer makes real shadows. */}
      {!rendering && <SoftShadows size={25} samples={16} focus={0.5} />}

      {/* Key light — warm sun coming through windows. Eased back in render mode
          so direct sun on a wall doesn't clip to white under true GI. */}
      <directionalLight
        position={[cx + w * 0.6, 5 + maxLevel * WALL_H, cz - d * 0.4]}
        intensity={rendering ? 1.2 : 1.8}
        color="#fff8e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.001}
      />

      {/* Fill light — cooler, opposite side. Mostly a rasteriser device to lift
          flat shadow sides; in render the GI fills shadows for real, so keep it low. */}
      <directionalLight
        position={[cx - w * 0.5, 3, cz + d * 0.5]}
        intensity={rendering ? 0.15 : 0.4}
        color="#ddeeff"
        castShadow={false}
      />

      {/* Ceiling bounce — fakes light kicking off the ceiling in the rasteriser;
          the path tracer does this for real, so it's nearly off in render mode. */}
      <pointLight position={[cx, (maxLevel + 0.9) * WALL_H, cz]} intensity={rendering ? 0.2 : 0.6} color="#fff5e0" distance={Math.max(w, d) * 2} />

      {/* Ground plane — covers the whole building footprint */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[groundCx, -0.005, groundCz]} receiveShadow>
        <planeGeometry args={[groundW, groundD]} />
        <meshStandardMaterial color="#b8b0a0" roughness={0.9} />
      </mesh>

      {/* Contact shadows baked under the structure — rasteriser only. */}
      {!rendering && (
        <ContactShadows
          position={[groundCx, 0, groundCz]}
          width={groundW}
          height={groundD}
          far={0.5}
          blur={2.5}
          opacity={0.4}
          color="#1a1008"
        />
      )}

      {/* Floors, stacked at their level height */}
      {floors.map((f) => (
        <FloorGroup key={f.id} floor={f} yOffset={f.level * WALL_H} showCeiling={showCeiling} rendering={rendering} />
      ))}
    </>
  );

  return (
    <>
      {/* Camera framing only governs orbit mode; it re-runs on re-entry, giving a
          clean reset when you exit the walkthrough. */}
      {mode === 'orbit' && (
        <CameraRig
          cx={cx} cz={cz} w={w} d={d}
          buildingH={(maxLevel + 1) * WALL_H}
          controlsRef={controlsRef}
          resetSignal={resetSignal}
        />
      )}

      {/* Render mode swaps the rasteriser for an in-browser GPU path tracer that
          progressively converges to a photoreal image (global illumination, real
          soft shadows + reflections) from the exact same scene. */}
      {rendering ? (
        <Pathtracer enabled minSamples={3} bounces={4} renderPriority={1}>
          {world}
          <PathtracerSync dep={plan} />
        </Pathtracer>
      ) : (
        world
      )}

      {/* Orbit (dollhouse) vs walk (first-person) — exactly one owns the camera.
          Target is owned by CameraRig (set imperatively on frame/reset) so the
          two don't fight; no `target` prop on OrbitControls. */}
      {mode === 'orbit' ? (
        <OrbitControls ref={controlsRef} makeDefault minDistance={1} maxDistance={80} />
      ) : (
        <WalkControls spawnX={cx} spawnZ={cz} baseY={0} bounds={boundsM} colliders={colliders} frozen={rendering} />
      )}
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
  const [showCeiling, setShowCeiling] = useState(false);
  const [mode, setMode] = useState<ViewMode>('orbit');
  // Photoreal path-traced render. Only meaningful in orbit mode; entering walk
  // turns it off so the first-person view stays interactive.
  const [rendering, setRendering] = useState(false);

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
        <Scene resetSignal={resetSignal} showCeiling={showCeiling} mode={mode} rendering={rendering} />
        {!rendering && <PostFX />}
      </Canvas>

      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        {(
          <button
            type="button"
            onClick={() => setRendering((r) => !r)}
            title={
              mode === 'walk'
                ? 'Photoreal path-traced render from where you are standing — an eye-level interior shot. Stand still and converge; press Esc first to release the cursor, then click Render.'
                : 'Photoreal path-traced render of the current view (global illumination, real shadows + reflections). Converges over a few seconds; orbit to refine. Tip: enter Walk through for an interior eye-level shot.'
            }
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              color: rendering ? '#fff' : '#e2e8f0',
              background: rendering ? 'rgba(63,63,70,0.95)' : 'rgba(30,41,59,0.85)',
              border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}
          >
            {rendering ? '● Rendering' : 'Render'}
          </button>
        )}
        <button
          type="button"
          onClick={() => { setRendering(false); setMode((m) => (m === 'walk' ? 'orbit' : 'walk')); }}
          title="Toggle first-person walkthrough (click the view to look, WASD to move)"
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            color: '#e2e8f0',
            background: mode === 'walk' ? 'rgba(63,63,70,0.95)' : 'rgba(30,41,59,0.85)',
            border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
            cursor: 'pointer', backdropFilter: 'blur(4px)',
          }}
        >
          {mode === 'walk' ? 'Exit walk' : 'Walk through'}
        </button>
        <button
          type="button"
          onClick={() => setShowCeiling((c) => !c)}
          title="Show or hide room ceilings (hidden by default so you can see in)"
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            color: '#e2e8f0',
            background: showCeiling ? 'rgba(63,63,70,0.95)' : 'rgba(30,41,59,0.85)',
            border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
            cursor: 'pointer', backdropFilter: 'blur(4px)',
          }}
        >
          {showCeiling ? 'Ceiling: on' : 'Ceiling: off'}
        </button>
        <button
          type="button"
          onClick={() => setResetSignal((n) => n + 1)}
          title="Reset camera to frame the whole plan"
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            color: '#e2e8f0', background: 'rgba(30,41,59,0.85)',
            border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
            cursor: 'pointer', backdropFilter: 'blur(4px)',
          }}
        >
          Reset view
        </button>
      </div>

      {mode === 'walk' && !rendering && (
        <div
          style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            padding: '8px 16px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
            color: '#e2e8f0', background: 'rgba(15,23,42,0.8)',
            border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8,
            backdropFilter: 'blur(4px)', pointerEvents: 'none',
          }}
        >
          Click to look around · <strong>W A S D</strong> / arrows to move · <strong>Shift</strong> to run · <strong>Esc</strong> to release the cursor
        </div>
      )}
    </div>
    </Viewer3DErrorBoundary>
  );
}
