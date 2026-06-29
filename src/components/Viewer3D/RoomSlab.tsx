/**
 * Room floor slab — fills a detected room's true boundary ring as a flat slab
 * and labels it with the room name.
 */
import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor } from '../../model/types';
import { roomRing } from '../../model/roomDetect';
import { CM, WALL_H } from './constants';
import { floorMaterialForType } from './materials';

/** Build the room's boundary ring as a THREE.Shape (cm → m, plan-y → -z). */
function ringShape(ring: { x: number; y: number }[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0]!.x * CM, -ring[0]!.y * CM);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i]!.x * CM, -ring[i]!.y * CM);
  shape.closePath();
  return shape;
}

export function RoomSlab({ room, floor }: {
  room: Floor['rooms'][number];
  floor: Floor;
}) {
  // True boundary ring (handles concave / L-shaped rooms), shared with the 2D
  // layer so the 3D floor matches the plan exactly.
  const ring = useMemo(
    () => roomRing(room, floor.points, floor.walls),
    [room, floor.points, floor.walls],
  );
  if (ring.length < 3) return null;

  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;

  // Plan y → world z (matches the wall mapping: shape-y is negated, then the
  // mesh's -90° X rotation flips it back so floor and walls share a frame).
  const shape = ringShape(ring);

  const mat = floorMaterialForType(room.type);

  return (
    <group>
      {/* Floor with a procedural PBR material (wood / tile / concrete by room
          type): albedo + normal map (plank seams, grout grooves) + varied
          roughness, so it reads as a real surface in both the rasteriser and the
          path tracer (which ignores bumpMap — hence a real normalMap). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          map={mat.map}
          normalMap={mat.normalMap}
          normalScale={mat.normalScale}
          roughnessMap={mat.roughnessMap}
          color={mat.color}
          roughness={mat.roughness}
          metalness={mat.metalness}
        />
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

/**
 * Room ceiling slab — the room's boundary ring filled at wall height, facing
 * down into the room. Rendered only when ceilings are toggled on (they'd hide
 * the dollhouse view otherwise); pays off in the first-person walkthrough.
 */
export function CeilingSlab({ room, floor }: {
  room: Floor['rooms'][number];
  floor: Floor;
}) {
  const ring = useMemo(
    () => roomRing(room, floor.points, floor.walls),
    [room, floor.points, floor.walls],
  );
  if (ring.length < 3) return null;
  const shape = ringShape(ring);

  // Same orientation as the floor slab, raised to wall height; DoubleSide so it
  // lights correctly when viewed from below.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]} receiveShadow castShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#f4f1ea" roughness={0.95} metalness={0.0} side={THREE.DoubleSide} />
    </mesh>
  );
}
