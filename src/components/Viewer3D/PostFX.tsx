/**
 * Post-processing stack: SSAO for contact darkening, SMAA anti-aliasing, and
 * ACES filmic tone-mapping so the render reads as a photographic interior.
 */
import { EffectComposer, SSAO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

export function PostFX() {
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
