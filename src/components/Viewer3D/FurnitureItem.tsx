/**
 * Picks how to render one furniture item (Tier 2 #4):
 *   - a real GLB model if its type is in FURNITURE_ASSETS, else
 *   - the hand-built procedural mesh (FurnitureMesh).
 *
 * Two safety nets keep the GLB path from ever breaking the scene: <Suspense>
 * shows the procedural mesh while the model streams in, and the error boundary
 * falls back to it permanently if the file is missing or fails to parse. So an
 * empty/incomplete manifest renders exactly like the all-procedural version.
 */
import { Component, Suspense, type ReactNode } from 'react';
import type { Furniture } from '../../model/types';
import { FurnitureMesh } from './FurnitureMesh';
import { GltfFurniture } from './GltfFurniture';
import { hasAsset } from './furnitureAssets';

class AssetBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Swallowed on purpose — a missing/broken GLB just falls back to the
    // procedural mesh; it must never blank the 3D view.
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function FurnitureItem({ item }: { item: Furniture }) {
  const procedural = <FurnitureMesh item={item} />;
  if (!hasAsset(item.type)) return procedural;
  return (
    <AssetBoundary fallback={procedural}>
      <Suspense fallback={procedural}>
        <GltfFurniture item={item} />
      </Suspense>
    </AssetBoundary>
  );
}
