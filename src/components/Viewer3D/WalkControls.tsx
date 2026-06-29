/**
 * First-person "walkthrough" controls: pointer-lock to look, WASD/arrows to
 * move at a fixed eye height. Mounted only in walk mode (Viewer3D); orbit mode
 * uses OrbitControls instead, so the two never both claim the camera.
 *
 * Movement is horizontal only — the camera is pinned to `baseY + EYE_H` every
 * frame, so you glide along the floor rather than fly. Walls block movement
 * (circle-vs-segment, with sliding); doorways are left open so you can move
 * between rooms. Windows still block (there's glass). Stairs aren't climbed —
 * the walk is pinned to the ground floor for now.
 */
import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { resolveCollisions, type WallCollider } from './walkCollision';

/** Eye height above the floor (m) and walking speed (m/s). */
const EYE_H = 1.6;
const SPEED = 3.2;

export function WalkControls({ spawnX, spawnZ, baseY = 0, bounds, colliders, frozen = false }: {
  spawnX: number;
  spawnZ: number;
  baseY?: number;
  /** Building extent (m) the walker is soft-clamped within. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Wall segments that block movement (doorways already removed). */
  colliders: WallCollider[];
  /** When true (path-traced render), hold the camera perfectly still: no
   *  movement, no look, no pointer-lock — so the tracer converges on a fixed
   *  interior shot composed from wherever the walker is standing. */
  frozen?: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const keys = useRef<Record<string, boolean>>({});

  // Stand the camera at eye height on entry, looking horizontally into the room.
  useEffect(() => {
    camera.position.set(spawnX, baseY + EYE_H, spawnZ);
    camera.lookAt(spawnX, baseY + EYE_H, spawnZ - 1);
  }, [camera, spawnX, spawnZ, baseY]);

  // Track held keys at the window level (pointer lock keeps focus on the canvas).
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.current = {};
    };
  }, []);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (frozen) return; // hold the composed shot still for the path tracer
    const k = keys.current;
    const fwd = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    const str = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);

    if (fwd !== 0 || str !== 0) {
      camera.getWorldDirection(forward.current);
      forward.current.y = 0;
      forward.current.normalize();
      right.current.crossVectors(forward.current, camera.up).normalize();
      const boost = k['ShiftLeft'] || k['ShiftRight'] ? 2 : 1;
      const step = SPEED * boost * Math.min(delta, 0.05); // cap for tab-out hitches

      let px = camera.position.x + forward.current.x * fwd * step + right.current.x * str * step;
      let pz = camera.position.z + forward.current.z * fwd * step + right.current.z * str * step;

      // Resolve wall collisions (slides along walls), then clamp to the footprint.
      [px, pz] = resolveCollisions(px, pz, colliders);
      const m = 0.3;
      camera.position.x = THREE.MathUtils.clamp(px, bounds.minX + m, bounds.maxX - m);
      camera.position.z = THREE.MathUtils.clamp(pz, bounds.minZ + m, bounds.maxZ - m);
    }
    camera.position.y = baseY + EYE_H; // pinned to eye height every frame
  });

  // While frozen, drop pointer-lock entirely so a stray click can't grab the
  // cursor and rotate the camera mid-render (which would reset accumulation).
  return frozen ? null : <PointerLockControls makeDefault />;
}
