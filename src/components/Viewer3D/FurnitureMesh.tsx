/**
 * Furniture meshes — each type gets a distinct silhouette so it reads clearly
 * in 3D. All heights and proportions are realistic (cm → m via the CM constant).
 */
import type { Furniture } from '../../model/types';
import { getFurnitureDef } from '../../model/furniture';
import { CM, WALL_H } from './constants';

export function FurnitureMesh({ item }: { item: Furniture }) {
  const def = getFurnitureDef(item.type);
  if (!def) return null;

  const w  = def.widthCm  * CM;
  const d  = def.heightCm * CM;
  const x  = item.x * CM;
  const z  = item.y * CM;
  const rot = (item.rotationDeg * Math.PI) / 180;

  switch (item.type) {
    case 'double_bed':
    case 'single_bed': {
      const frameH = 0.25;
      const mattH  = 0.18;
      const pillowW = item.type === 'double_bed' ? 0.55 : 0.45;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Bed frame */}
          <mesh position={[0, frameH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, frameH, d]} />
            <meshStandardMaterial color="#6b4f3a" roughness={0.7} metalness={0.05} />
          </mesh>
          {/* Headboard */}
          <mesh position={[0, frameH + 0.3, -d / 2 + 0.05]} castShadow>
            <boxGeometry args={[w, 0.6, 0.06]} />
            <meshStandardMaterial color="#5a3e2b" roughness={0.75} />
          </mesh>
          {/* Mattress */}
          <mesh position={[0, frameH + mattH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.04, mattH, d - 0.04]} />
            <meshStandardMaterial color="#f0ece6" roughness={0.95} />
          </mesh>
          {/* Pillows */}
          {[[-pillowW / 2 - 0.05, 0], [pillowW / 2 + 0.05, 0]]
            .slice(0, item.type === 'double_bed' ? 2 : 1)
            .map(([px], pi) => (
              <mesh key={pi} position={[px ?? 0, frameH + mattH + 0.06, -d / 2 + 0.22]} castShadow>
                <boxGeometry args={[pillowW, 0.1, 0.4]} />
                <meshStandardMaterial color="#ffffff" roughness={0.98} />
              </mesh>
            ))}
          {/* Blanket */}
          <mesh position={[0, frameH + mattH + 0.04, d * 0.1]} castShadow>
            <boxGeometry args={[w - 0.06, 0.06, d * 0.55]} />
            <meshStandardMaterial color="#c4a882" roughness={0.9} />
          </mesh>
        </group>
      );
    }

    case 'sofa': {
      const seatH  = 0.42;
      const backH  = 0.45;
      const armW   = 0.12;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Seat base */}
          <mesh position={[0, seatH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, seatH, d * 0.55]} />
            <meshStandardMaterial color="#8b6f5e" roughness={0.85} />
          </mesh>
          {/* Seat cushion */}
          <mesh position={[0, seatH + 0.06, d * 0.02]} castShadow>
            <boxGeometry args={[w - armW * 2 - 0.04, 0.12, d * 0.5]} />
            <meshStandardMaterial color="#a08070" roughness={0.9} />
          </mesh>
          {/* Back */}
          <mesh position={[0, seatH + backH / 2, -d * 0.23]} castShadow>
            <boxGeometry args={[w, backH, d * 0.2]} />
            <meshStandardMaterial color="#8b6f5e" roughness={0.85} />
          </mesh>
          {/* Arms */}
          {([-1, 1] as const).map((side, si) => (
            <mesh key={si} position={[side * (w / 2 - armW / 2), seatH + 0.2, 0]} castShadow>
              <boxGeometry args={[armW, 0.18, d * 0.55]} />
              <meshStandardMaterial color="#7a6050" roughness={0.85} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'dining_table': {
      const tableH = 0.76;
      const legW   = 0.06;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tabletop */}
          <mesh position={[0, tableH, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#a07850" roughness={0.5} metalness={0.05} />
          </mesh>
          {/* Legs */}
          {([-1, 1] as const).flatMap((sx) =>
            ([-1, 1] as const).map((sz, li) => (
              <mesh key={`${sx}${li}`} position={[sx * (w / 2 - legW), tableH / 2, sz * (d / 2 - legW)]} castShadow>
                <boxGeometry args={[legW, tableH, legW]} />
                <meshStandardMaterial color="#8b6535" roughness={0.6} />
              </mesh>
            ))
          )}
        </group>
      );
    }

    case 'wardrobe': {
      const wardH = 2.1;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, wardH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, wardH, d]} />
            <meshStandardMaterial color="#c8b89a" roughness={0.7} />
          </mesh>
          {/* Door lines — thin darker strips to suggest panels */}
          {[w / 4, -w / 4].map((ox, i) => (
            <mesh key={i} position={[ox, wardH / 2, d / 2 + 0.001]} castShadow={false}>
              <boxGeometry args={[0.01, wardH - 0.1, 0.001]} />
              <meshStandardMaterial color="#9a8060" roughness={0.8} />
            </mesh>
          ))}
          {/* Handles */}
          {[w / 4, -w / 4].map((ox, i) => (
            <mesh key={`h${i}`} position={[ox - 0.06, wardH * 0.5, d / 2 + 0.02]} castShadow={false}>
              <boxGeometry args={[0.03, 0.015, 0.015]} />
              <meshStandardMaterial color="#c0a060" roughness={0.3} metalness={0.6} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'tv_unit': {
      const unitH = 0.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, unitH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, unitH, d]} />
            <meshStandardMaterial color="#3d3530" roughness={0.7} />
          </mesh>
          {/* TV screen */}
          <mesh position={[0, unitH + 0.55, -d / 2 + 0.02]} castShadow>
            <boxGeometry args={[w * 0.9, 0.7, 0.04]} />
            <meshStandardMaterial color="#111111" roughness={0.1} metalness={0.4} />
          </mesh>
          {/* Screen face */}
          <mesh position={[0, unitH + 0.55, -d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.86, 0.65, 0.001]} />
            <meshStandardMaterial color="#0a0a1a" roughness={0.05} metalness={0.1} />
          </mesh>
        </group>
      );
    }

    case 'kitchen_counter': {
      const counterH = 0.9;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet body */}
          <mesh position={[0, (counterH - 0.04) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, counterH - 0.04, d]} />
            <meshStandardMaterial color="#e8dfd0" roughness={0.8} />
          </mesh>
          {/* Counter slab */}
          <mesh position={[0, counterH - 0.02, 0]} castShadow>
            <boxGeometry args={[w, 0.04, d + 0.02]} />
            <meshStandardMaterial color="#8a8078" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Sink cutout suggestion — dark rectangle on top */}
          <mesh position={[0, counterH + 0.001, 0]}>
            <boxGeometry args={[w * 0.45, 0.001, d * 0.5]} />
            <meshStandardMaterial color="#5a5a5a" roughness={0.2} metalness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'toilet': {
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tank */}
          <mesh position={[0, 0.38, -d / 2 + 0.12]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.34, 0.2]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.6} />
          </mesh>
          {/* Bowl */}
          <mesh position={[0, 0.22, d * 0.05]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.4, w * 0.38, 0.32, 16]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.55} />
          </mesh>
        </group>
      );
    }

    case 'wash_basin': {
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Pedestal */}
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.1, 0.8, 12]} />
            <meshStandardMaterial color="#f0ece8" roughness={0.6} />
          </mesh>
          {/* Basin */}
          <mesh position={[0, 0.82, 0]} castShadow>
            <cylinderGeometry args={[w * 0.44, w * 0.38, 0.14, 16]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.5} />
          </mesh>
        </group>
      );
    }

    case 'pooja_unit': {
      const unitH = 1.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, unitH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, unitH, d]} />
            <meshStandardMaterial color="#c8a050" roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Arch cutout suggestion — slightly recessed darker face */}
          <mesh position={[0, unitH * 0.55, d / 2 + 0.001]}>
            <boxGeometry args={[w * 0.6, unitH * 0.7, 0.001]} />
            <meshStandardMaterial color="#8b6010" roughness={0.7} />
          </mesh>
          {/* Diya / lamp glow point */}
          <pointLight position={[0, unitH * 0.4, d / 2 + 0.1]} intensity={0.3} color="#ffaa00" distance={1.5} />
        </group>
      );
    }

    case 'fridge': {
      const fh = 1.8;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, fh / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, fh, d]} />
            <meshStandardMaterial color="#d2d6da" roughness={0.35} metalness={0.55} />
          </mesh>
          {/* Door split */}
          <mesh position={[0, fh * 0.5, d / 2 + 0.002]}>
            <boxGeometry args={[w * 0.92, 0.02, 0.004]} />
            <meshStandardMaterial color="#9aa0a6" />
          </mesh>
          {/* Handle */}
          <mesh position={[w / 2 - 0.08, fh * 0.55, d / 2 + 0.03]} castShadow>
            <boxGeometry args={[0.03, 0.5, 0.03]} />
            <meshStandardMaterial color="#5a5e63" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'stove': {
      const sh = 0.9;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Base cabinet */}
          <mesh position={[0, sh / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, sh, d]} />
            <meshStandardMaterial color="#e8dfd0" roughness={0.8} />
          </mesh>
          {/* Cooktop */}
          <mesh position={[0, sh + 0.01, 0]} castShadow>
            <boxGeometry args={[w * 0.96, 0.04, d * 0.96]} />
            <meshStandardMaterial color="#2b2b2b" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* Burners */}
          {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], bi) => (
            <mesh key={bi} position={[sx * w * 0.22, sh + 0.04, sz * d * 0.22]}>
              <cylinderGeometry args={[w * 0.11, w * 0.11, 0.02, 16]} />
              <meshStandardMaterial color="#3a3a3a" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'kitchen_sink': {
      const kh = 0.9;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, (kh - 0.04) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, kh - 0.04, d]} />
            <meshStandardMaterial color="#e8dfd0" roughness={0.8} />
          </mesh>
          {/* Counter slab */}
          <mesh position={[0, kh - 0.02, 0]} castShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#8a8078" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Basin */}
          <mesh position={[0, kh - 0.06, 0]}>
            <boxGeometry args={[w * 0.55, 0.12, d * 0.6]} />
            <meshStandardMaterial color="#c0c4c8" metalness={0.6} roughness={0.25} />
          </mesh>
          {/* Faucet */}
          <mesh position={[0, kh + 0.14, -d * 0.28]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.28, 8]} />
            <meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'kitchen_island': {
      const ih = 0.9;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, (ih - 0.05) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.9, ih - 0.05, d * 0.9]} />
            <meshStandardMaterial color="#c8b89a" roughness={0.7} />
          </mesh>
          {/* Overhanging counter */}
          <mesh position={[0, ih - 0.025, 0]} castShadow>
            <boxGeometry args={[w, 0.05, d]} />
            <meshStandardMaterial color="#7a7068" roughness={0.3} metalness={0.1} />
          </mesh>
        </group>
      );
    }

    case 'chimney': {
      const base = 1.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Hood */}
          <mesh position={[0, base, 0]} castShadow>
            <boxGeometry args={[w, 0.18, d]} />
            <meshStandardMaterial color="#c0c4c8" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Duct */}
          <mesh position={[0, base + 0.4, -d * 0.1]} castShadow>
            <boxGeometry args={[w * 0.35, 0.6, d * 0.4]} />
            <meshStandardMaterial color="#b0b4b8" metalness={0.5} roughness={0.35} />
          </mesh>
        </group>
      );
    }

    case 'chair': {
      const seatH = 0.45;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Seat */}
          <mesh position={[0, seatH, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.06, d]} />
            <meshStandardMaterial color="#8b6f5e" roughness={0.8} />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, seatH + 0.25, -d / 2 + 0.03]} castShadow>
            <boxGeometry args={[w, 0.5, 0.05]} />
            <meshStandardMaterial color="#7a6050" roughness={0.8} />
          </mesh>
          {/* Legs */}
          {([-1, 1] as const).flatMap((sx) =>
            ([-1, 1] as const).map((sz, li) => (
              <mesh key={`${sx}${li}`} position={[sx * (w / 2 - 0.04), seatH / 2, sz * (d / 2 - 0.04)]} castShadow>
                <boxGeometry args={[0.04, seatH, 0.04]} />
                <meshStandardMaterial color="#5a3e2b" roughness={0.7} />
              </mesh>
            )),
          )}
        </group>
      );
    }

    case 'coffee_table': {
      const th = 0.4;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, th, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.05, d]} />
            <meshStandardMaterial color="#a07850" roughness={0.5} metalness={0.05} />
          </mesh>
          {([-1, 1] as const).flatMap((sx) =>
            ([-1, 1] as const).map((sz, li) => (
              <mesh key={`${sx}${li}`} position={[sx * (w / 2 - 0.05), th / 2, sz * (d / 2 - 0.05)]} castShadow>
                <boxGeometry args={[0.05, th, 0.05]} />
                <meshStandardMaterial color="#8b6535" roughness={0.6} />
              </mesh>
            )),
          )}
        </group>
      );
    }

    case 'side_table': {
      const th = 0.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, th, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#9a7b5a" roughness={0.6} />
          </mesh>
          <mesh position={[0, th / 2, 0]} castShadow>
            <boxGeometry args={[w * 0.25, th, d * 0.25]} />
            <meshStandardMaterial color="#80654a" roughness={0.7} />
          </mesh>
        </group>
      );
    }

    case 'desk': {
      const dh = 0.75;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, dh, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#9a7b5a" roughness={0.6} />
          </mesh>
          {/* Side panels */}
          {([-1, 1] as const).map((sx, si) => (
            <mesh key={si} position={[sx * (w / 2 - 0.02), dh / 2, 0]} castShadow>
              <boxGeometry args={[0.04, dh, d * 0.9]} />
              <meshStandardMaterial color="#80654a" roughness={0.7} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'bookshelf': {
      const bh = 1.8;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          <mesh position={[0, bh / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bh, d]} />
            <meshStandardMaterial color="#6b4f3a" roughness={0.75} />
          </mesh>
          {/* Shelf lines on the front face */}
          {[0.3, 0.7, 1.1, 1.5].map((sy, si) => (
            <mesh key={si} position={[0, sy, d / 2 + 0.002]}>
              <boxGeometry args={[w * 0.9, 0.04, 0.006]} />
              <meshStandardMaterial color="#3d2e20" />
            </mesh>
          ))}
        </group>
      );
    }

    case 'vanity': {
      const vh = 0.85;
      const basinR = Math.min(w, d) * 0.28;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Cabinet */}
          <mesh position={[0, (vh - 0.04) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, vh - 0.04, d]} />
            <meshStandardMaterial color="#a98a6a" roughness={0.7} />
          </mesh>
          {/* Counter */}
          <mesh position={[0, vh - 0.02, 0]} castShadow>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color="#8a8078" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Basin */}
          <mesh position={[0, vh + 0.04, 0]} castShadow>
            <cylinderGeometry args={[basinR, basinR * 0.8, 0.12, 20]} />
            <meshStandardMaterial color="#f5f2ee" roughness={0.4} />
          </mesh>
          {/* Mirror on the wall behind */}
          <mesh position={[0, vh + 0.55, -d / 2 + 0.01]}>
            <boxGeometry args={[w * 0.7, 0.7, 0.02]} />
            <meshStandardMaterial color="#9fc0d4" roughness={0.05} metalness={0.5} />
          </mesh>
        </group>
      );
    }

    case 'shower': {
      const gh = 2.0; // glass height
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tray */}
          <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.1, d]} />
            <meshStandardMaterial color="#dfe4e8" roughness={0.4} metalness={0.1} />
          </mesh>
          {/* Glass partition (front + one side, like a corner stall) */}
          <mesh position={[0, gh / 2, d / 2 - 0.02]}>
            <boxGeometry args={[w, gh, 0.02]} />
            <meshPhysicalMaterial color="#bcd6e6" transparent opacity={0.18} roughness={0.02} transmission={0.85} thickness={0.02} />
          </mesh>
          <mesh position={[w / 2 - 0.02, gh / 2, 0]}>
            <boxGeometry args={[0.02, gh, d]} />
            <meshPhysicalMaterial color="#bcd6e6" transparent opacity={0.18} roughness={0.02} transmission={0.85} thickness={0.02} />
          </mesh>
          {/* Shower head on the back wall */}
          <mesh position={[-w / 2 + 0.12, gh - 0.25, -d / 2 + 0.12]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 0.03, 16]} />
            <meshStandardMaterial color="#c0c4c8" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'bathtub': {
      const bth = 0.55;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Tub body */}
          <mesh position={[0, bth / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, bth, d]} />
            <meshStandardMaterial color="#f3f5f7" roughness={0.3} metalness={0.05} />
          </mesh>
          {/* Inner basin recess */}
          <mesh position={[0, bth - 0.04, 0]}>
            <boxGeometry args={[w * 0.85, 0.1, d * 0.7]} />
            <meshStandardMaterial color="#dbe6ee" roughness={0.2} metalness={0.1} />
          </mesh>
          {/* Faucet */}
          <mesh position={[-w / 2 + 0.12, bth + 0.12, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.24, 8]} />
            <meshStandardMaterial color="#9aa0a6" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      );
    }

    case 'mirror': {
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Frame */}
          <mesh position={[0, 1.5, 0]} castShadow>
            <boxGeometry args={[w, 0.7, Math.max(d, 0.04)]} />
            <meshStandardMaterial color="#6b5b4a" roughness={0.6} />
          </mesh>
          {/* Glass */}
          <mesh position={[0, 1.5, d / 2 + 0.001]}>
            <boxGeometry args={[w * 0.9, 0.62, 0.005]} />
            <meshStandardMaterial color="#9fc0d4" roughness={0.05} metalness={0.6} />
          </mesh>
        </group>
      );
    }

    case 'towel_rail': {
      const rh = 1.1;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Rail */}
          <mesh position={[0, rh, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, w, 10]} />
            <meshStandardMaterial color="#c0c4c8" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Draped towel */}
          <mesh position={[0, rh - 0.25, d / 2]} castShadow>
            <boxGeometry args={[w * 0.7, 0.5, 0.04]} />
            <meshStandardMaterial color="#e8e2d8" roughness={0.95} />
          </mesh>
        </group>
      );
    }

    case 'geyser': {
      const gy = 1.8; // wall-mounted height
      const r = Math.min(w, d) * 0.5;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Horizontal storage cylinder */}
          <mesh position={[0, gy, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[r, r, Math.max(w, d), 20]} />
            <meshStandardMaterial color="#eef0f2" roughness={0.4} metalness={0.2} />
          </mesh>
        </group>
      );
    }

    case 'washing_machine': {
      const wm = 0.85;
      const doorR = Math.min(w, wm) * 0.3;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {/* Body */}
          <mesh position={[0, wm / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, wm, d]} />
            <meshStandardMaterial color="#eef0f2" roughness={0.4} metalness={0.2} />
          </mesh>
          {/* Front-load door */}
          <mesh position={[0, wm * 0.5, d / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[doorR, doorR, 0.04, 24]} />
            <meshPhysicalMaterial color="#3a4a52" transparent opacity={0.55} roughness={0.1} metalness={0.3} />
          </mesh>
          {/* Control panel */}
          <mesh position={[0, wm - 0.06, d / 2 + 0.001]}>
            <boxGeometry args={[w * 0.9, 0.08, 0.005]} />
            <meshStandardMaterial color="#2b2b2b" roughness={0.5} />
          </mesh>
        </group>
      );
    }

    case 'staircase': {
      const n = 12;
      const stepH = WALL_H / n;   // rises one full storey
      const stepRun = d / n;
      return (
        <group position={[x, 0, z]} rotation={[0, -rot, 0]}>
          {Array.from({ length: n }, (_, i) => (
            <mesh
              key={i}
              position={[0, ((i + 1) * stepH) / 2, -d / 2 + (i + 0.5) * stepRun]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[w, (i + 1) * stepH, stepRun]} />
              <meshStandardMaterial color="#b89878" roughness={0.7} />
            </mesh>
          ))}
        </group>
      );
    }

    default: {
      // Generic box fallback for unknown types
      return (
        <mesh position={[x, 0.3, z]} rotation={[0, -rot, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.6, d]} />
          <meshStandardMaterial color="#b0a898" roughness={0.8} />
        </mesh>
      );
    }
  }
}
