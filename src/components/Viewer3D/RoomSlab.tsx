/**
 * Room floor slab — fills a detected room's true boundary ring as a flat slab
 * and labels it with the room name.
 */
import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor } from '../../model/types';
import { roomRing } from '../../model/roomDetect';
import { roomTypeColor } from '../../model/roomTypes';
import { CM } from './constants';

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
  const shape = new THREE.Shape();
  shape.moveTo(ring[0]!.x * CM, -ring[0]!.y * CM);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i]!.x * CM, -ring[i]!.y * CM);
  shape.closePath();

  const color = roomTypeColor(room.type);

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
