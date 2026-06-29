/**
 * Procedural PBR floor materials (canvas-generated — no external asset files).
 *
 * Flat-shaded floors are the single biggest "this is a CAD model, not a home"
 * tell. Each surface kind here gets an albedo map (the visible pattern), a bump
 * map (surface relief so light catches plank seams / grout grooves) and a
 * roughness map (so sheen varies across the surface) — the three channels that
 * read as a real material under our HDR + soft-shadow lighting.
 *
 * Textures are generated once and cached per kind (generation is the expensive
 * part); the lightweight per-room material spec is cached per room type. When we
 * later source real PBR maps (PolyHaven et al.), swap `makeFloorTextures` for a
 * loader keyed by the same `FloorKind` — nothing else changes.
 *
 * Relief is delivered as a **normalMap**, not a bumpMap. The path tracer (render
 * mode) honours normalMap but silently ignores bumpMap — so a bump-only surface
 * renders dead flat in the photoreal view. We author a height (greyscale) canvas
 * as before, then convert it to a tangent-space normal map that reads correctly
 * in both the rasteriser and the path tracer.
 */
import * as THREE from 'three';
import type { RoomType } from '../../model/types';
import { roomTypeColor } from '../../model/roomTypes';

type FloorKind = 'wood' | 'tile' | 'concrete';

/** Which physical material covers each room type's floor. */
function floorKindForType(type: RoomType): FloorKind {
  switch (type) {
    case 'kitchen':
    case 'bathroom':
    case 'utility':
      return 'tile';
    case 'parking':
      return 'concrete';
    default:
      return 'wood'; // living, bedroom, dining, study, pooja, other
  }
}

/** Real-world size (metres) that one texture image spans before it repeats. */
const PATCH_M: Record<FloorKind, number> = { wood: 2.0, tile: 1.2, concrete: 3.0 };
const WALL_PATCH_M = 1.5;

const TEX = 512; // canvas resolution per patch

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  return [c, c.getContext('2d')!];
}

/** A hex colour nudged randomly by ±amt per channel, as an rgb() string. */
function jitter(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const nudge = (ch: number) =>
    Math.max(0, Math.min(255, ch + Math.round((Math.random() - 0.5) * amt)));
  const r = nudge((n >> 16) & 255);
  const g = nudge((n >> 8) & 255);
  const b = nudge(n & 255);
  return `rgb(${r},${g},${b})`;
}

interface FloorTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** Per-surface normal strength (x = y) for the material's normalScale. */
  normalScale: number;
}

/** Strength baked into the normal map when converting from height; per-surface
 *  intensity is then tuned via normalScale on the material. */
const NORMAL_BAKE_STRENGTH = 2.5;

/**
 * Convert a greyscale height canvas to a tangent-space normal map (Sobel-ish
 * central differences on the red channel, wrapped at the edges so it tiles).
 * Output is data, not colour — the caller sets NoColorSpace.
 */
function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width, h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d')!;
  const dst = octx.createImageData(w, h);
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      dst.data[i]     = ((dx / len) * 0.5 + 0.5) * 255;
      dst.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      dst.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

/** Horizontal wood planks with staggered ends, grain streaks and seam grooves. */
function makeWood(): FloorTextures {
  const [albedo, a] = makeCanvas();
  const [bump, b] = makeCanvas();
  const [rough, r] = makeCanvas();
  const plankH = TEX / 7; // ~0.28 m planks in a 2 m patch

  b.fillStyle = '#808080'; b.fillRect(0, 0, TEX, TEX);     // mid = flat
  r.fillStyle = '#9a9a9a'; r.fillRect(0, 0, TEX, TEX);     // fairly matte wood

  for (let row = 0, y = 0; y < TEX; row++, y += plankH) {
    const base = ['#b9895a', '#a9774a', '#c0915f', '#a06a40'][row % 4]!;
    a.fillStyle = jitter(base, 24);
    a.fillRect(0, y, TEX, plankH);
    // Grain: faint darker streaks along the plank.
    for (let i = 0; i < 40; i++) {
      a.strokeStyle = `rgba(60,40,25,${0.04 + Math.random() * 0.06})`;
      a.lineWidth = 1;
      const gy = y + Math.random() * plankH;
      a.beginPath(); a.moveTo(0, gy); a.lineTo(TEX, gy + (Math.random() - 0.5) * 6); a.stroke();
    }
    // Plank-end seams, staggered per row so it reads as a real floor.
    const offset = (row % 2) * (TEX / 2);
    for (let x = offset; x <= TEX + offset; x += TEX) {
      const sx = x % TEX;
      a.fillStyle = 'rgba(40,25,15,0.55)';
      a.fillRect(sx, y, 2, plankH);
      b.fillStyle = '#404040'; b.fillRect(sx - 1, y, 3, plankH); // recessed seam
    }
    // Long seam (groove) between plank rows.
    a.fillStyle = 'rgba(40,25,15,0.5)'; a.fillRect(0, y, TEX, 2);
    b.fillStyle = '#383838'; b.fillRect(0, y - 1, TEX, 3);
    // Slight per-plank sheen variation.
    r.fillStyle = `rgba(${130 + Math.random() * 50},0,0,0.25)`;
    r.fillRect(0, y, TEX, plankH);
  }
  return finalize(albedo, bump, rough, PATCH_M.wood, 1.0);
}

/** Square tiles with recessed grout lines and faint per-tile shade variation. */
function makeTile(): FloorTextures {
  const [albedo, a] = makeCanvas();
  const [bump, b] = makeCanvas();
  const [rough, r] = makeCanvas();
  const n = 3; // 3 tiles per 1.2 m patch → ~0.4 m tiles
  const size = TEX / n;
  const grout = 8;

  a.fillStyle = '#8f877a'; a.fillRect(0, 0, TEX, TEX); // grout colour shows in gaps
  b.fillStyle = '#303030'; b.fillRect(0, 0, TEX, TEX); // grout recessed
  r.fillStyle = '#b0b0b0'; r.fillRect(0, 0, TEX, TEX); // grout rougher
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ix * size + grout / 2;
      const y = iy * size + grout / 2;
      const w = size - grout;
      a.fillStyle = jitter('#d8d2c6', 14); a.fillRect(x, y, w, w);
      b.fillStyle = '#b0b0b0'; b.fillRect(x, y, w, w); // tile face raised
      r.fillStyle = '#5a5a5a'; r.fillRect(x, y, w, w); // glossy tile face
    }
  }
  return finalize(albedo, bump, rough, PATCH_M.tile, 0.8);
}

/** Troweled concrete: tonal blotches over a mid grey, very subtle relief. */
function makeConcrete(): FloorTextures {
  const [albedo, a] = makeCanvas();
  const [bump, b] = makeCanvas();
  const [rough, r] = makeCanvas();
  a.fillStyle = '#9a988f'; a.fillRect(0, 0, TEX, TEX);
  b.fillStyle = '#808080'; b.fillRect(0, 0, TEX, TEX);
  r.fillStyle = '#c0c0c0'; r.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * TEX, y = Math.random() * TEX, rad = 2 + Math.random() * 26;
    const shade = Math.random() < 0.5 ? 0 : 255;
    a.fillStyle = `rgba(${shade},${shade},${shade},0.04)`;
    a.beginPath(); a.arc(x, y, rad, 0, Math.PI * 2); a.fill();
  }
  return finalize(albedo, bump, rough, PATCH_M.concrete, 0.4);
}

/** Painted plaster: warm off-white with soft mottling and fine orange-peel relief. */
function makeWall(): FloorTextures {
  const [albedo, a] = makeCanvas();
  const [bump, b] = makeCanvas();
  const [rough, r] = makeCanvas();
  a.fillStyle = '#ece7de'; a.fillRect(0, 0, TEX, TEX);
  b.fillStyle = '#808080'; b.fillRect(0, 0, TEX, TEX);
  r.fillStyle = '#e6e6e6'; r.fillRect(0, 0, TEX, TEX); // matte paint
  // Soft tonal mottle — large faint blobs so the wall isn't a dead flat colour.
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * TEX, y = Math.random() * TEX, rad = 12 + Math.random() * 70;
    const lighten = Math.random() < 0.5;
    a.fillStyle = `rgba(${lighten ? 255 : 150},${lighten ? 250 : 140},${lighten ? 240 : 130},0.03)`;
    a.beginPath(); a.arc(x, y, rad, 0, Math.PI * 2); a.fill();
  }
  // Fine orange-peel speckle in the bump only (keeps albedo clean).
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * TEX, y = Math.random() * TEX;
    const v = 110 + Math.floor(Math.random() * 90);
    b.fillStyle = `rgb(${v},${v},${v})`;
    b.fillRect(x, y, 1.4, 1.4);
  }
  return finalize(albedo, bump, rough, WALL_PATCH_M, 0.35);
}

function finalize(
  albedo: HTMLCanvasElement,
  height: HTMLCanvasElement,
  rough: HTMLCanvasElement,
  patchM: number,
  normalScale: number,
): FloorTextures {
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace; // albedo is colour
  // Height → tangent-space normals (works in both rasteriser and path tracer).
  const normalMap = new THREE.CanvasTexture(heightToNormal(height, NORMAL_BAKE_STRENGTH));
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / patchM, 1 / patchM); // ShapeGeometry UVs are in metres
    t.anisotropy = 4;
  }
  // Normals & roughness are data, not colour.
  normalMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  return { map, normalMap, roughnessMap, normalScale };
}

const texCache = new Map<FloorKind, FloorTextures>();
function getFloorTextures(kind: FloorKind): FloorTextures {
  let t = texCache.get(kind);
  if (!t) {
    t = kind === 'wood' ? makeWood() : kind === 'tile' ? makeTile() : makeConcrete();
    texCache.set(kind, t);
  }
  return t;
}

/** A ready-to-render PBR surface: shared textures + per-surface shading params. */
export interface PbrSurfaceSpec {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Tangent-space normal strength (honoured by both renderers). */
  normalScale: THREE.Vector2;
  /** Faint tint (mostly white) so the texture's true colour shows through. */
  color: THREE.Color;
  roughness: number;
  metalness: number;
}

const specCache = new Map<RoomType, PbrSurfaceSpec>();

/**
 * Cached PBR floor spec for a room type. Shared textures + a faint room tint so
 * the floor reads as a real material while rooms stay subtly distinguishable.
 */
export function floorMaterialForType(type: RoomType): PbrSurfaceSpec {
  let spec = specCache.get(type);
  if (!spec) {
    const kind = floorKindForType(type);
    const tex = getFloorTextures(kind);
    // Mostly white (let the texture's true colour through) with a hint of the
    // room tone — keeps the realism while preserving a little room legibility.
    const color = new THREE.Color('#ffffff').lerp(new THREE.Color(roomTypeColor(type)), 0.18);
    spec = {
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(tex.normalScale, tex.normalScale),
      color,
      roughness: kind === 'tile' ? 0.35 : kind === 'concrete' ? 0.85 : 0.6,
      metalness: 0.0,
    };
    specCache.set(type, spec);
  }
  return spec;
}

let wallSpec: PbrSurfaceSpec | null = null;

/** Cached painted-plaster wall material spec (shared by every wall segment). */
export function wallMaterial(): PbrSurfaceSpec {
  if (!wallSpec) {
    const tex = makeWall();
    wallSpec = {
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(tex.normalScale, tex.normalScale),
      color: new THREE.Color('#ece7de'),
      roughness: 0.93,
      metalness: 0.0,
    };
  }
  return wallSpec;
}
