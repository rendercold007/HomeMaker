/**
 * Renders one furniture item as a real GLB model (Tier 2 #4).
 *
 * Loaded once via drei's `useGLTF` (cached across items of the same type),
 * cloned per item, then auto-fitted to the catalog footprint and dropped onto
 * the floor by `computeFitTransform`. Only reached for types listed in
 * FURNITURE_ASSETS; everything else — and any load failure — uses the procedural
 * `FurnitureMesh` instead (see FurnitureItem).
 */
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Furniture } from '../../model/types';
import { getFurnitureDef } from '../../model/furniture';
import { CM } from './constants';
import { FURNITURE_ASSETS, computeFitTransform } from './furnitureAssets';

export function GltfFurniture({ item }: { item: Furniture }) {
  const asset = FURNITURE_ASSETS[item.type];
  // asset is guaranteed present: FurnitureItem only mounts this for known types.
  const { scene } = useGLTF(asset.url);

  const { node, fit } = useMemo(() => {
    const node = scene.clone(true);
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const bounds = new THREE.Box3().setFromObject(node);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);

    const def = getFurnitureDef(item.type);
    const footprint = { w: (def?.widthCm ?? 100) * CM, d: (def?.heightCm ?? 100) * CM };
    const fit = computeFitTransform(
      {
        sizeX: size.x, sizeY: size.y, sizeZ: size.z,
        centerX: center.x, centerZ: center.z, minY: bounds.min.y,
      },
      asset,
      footprint,
    );
    return { node, fit };
  }, [scene, asset, item.type]);

  const x = item.x * CM;
  const z = item.y * CM;
  const rot = (item.rotationDeg * Math.PI) / 180;
  const yaw = ((asset.yawDeg ?? 0) * Math.PI) / 180;

  return (
    <group position={[x, 0, z]} rotation={[0, -(rot + yaw), 0]}>
      <primitive
        object={node}
        position={[fit.offsetX, fit.offsetY, fit.offsetZ]}
        scale={fit.scale}
      />
    </group>
  );
}
