/**
 * Post-processing stack, in render order: N8AO (ambient occlusion) → Bloom (soft
 * highlight/daylight glow) → ACES filmic tone-mapping (HDR→LDR roll-off) →
 * Vignette (photographic framing) → SMAA (final anti-aliasing). Together these
 * make the render read as a photographed interior rather than a flat viewport.
 *
 * AO note: we use N8AO, not the legacy SSAO effect. The old SSAO silently does
 * nothing unless the EffectComposer also runs a NormalPass (it logged
 * "Please enable the NormalPass…" and produced zero occlusion). N8AO derives
 * normals from depth itself, so it just works, and its multi-bounce-ish look
 * with denoise is far closer to a real contact shadow in creases and where
 * furniture meets the floor.
 */
import { EffectComposer, N8AO, Bloom, ToneMapping, Vignette, SMAA } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      {/* Ambient occlusion — grounds furniture and darkens creases/corners.
          aoRadius in world units (metres); denoise keeps it smooth, not crunchy. */}
      <N8AO
        color="#1a1008"
        aoRadius={0.6}
        distanceFalloff={1.0}
        intensity={2.2}
        aoSamples={16}
        denoiseSamples={8}
        denoiseRadius={12}
        halfRes
      />
      {/* Soft glow on bright highlights / daylight through openings — the cozy
          "photographic interior" feel. High threshold so only hot spots bloom. */}
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.3} intensity={0.5} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* Gentle darkening toward the frame edges — focuses the eye on the room. */}
      <Vignette offset={0.32} darkness={0.45} />
      <SMAA />
    </EffectComposer>
  );
}
