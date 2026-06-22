/**
 * AI generation pipeline.
 *
 * The AI outputs simple room rectangles {name, x, y, w, h}.
 * rectRoomsToFloor() converts those to a proper wall-graph Floor with
 * shared walls and correct room names — no cycle-detection ambiguity.
 */
import type { Floor, Opening, Plan, Plot, VastuConfig } from '../model/types';
import { GenerationResultSchema } from './schema';
import type { GenerationResult } from './schema';

export interface GenerateParams {
  prompt: string;
  plot: Plot;
  vastu: VastuConfig;
}

// ---------------------------------------------------------------------------
// Rectangle → wall graph converter
// ---------------------------------------------------------------------------

interface RectRoom { name: string; x: number; y: number; w: number; h: number }

function rectRoomsToFloor(rectRooms: RectRoom[], floorId: string): Floor {
  let pCount = 0, wCount = 0;
  const points: Floor['points'] = [];
  const walls: Floor['walls'] = [];

  // Point registry — snaps to existing point within 5 cm.
  const pointRegistry: Array<{ id: string; x: number; y: number }> = [];
  function getOrCreatePoint(x: number, y: number): string {
    const rx = Math.round(x), ry = Math.round(y);
    const existing = pointRegistry.find((p) => Math.hypot(p.x - rx, p.y - ry) <= 5);
    if (existing) return existing.id;
    const id = `p${++pCount}`;
    pointRegistry.push({ id, x: rx, y: ry });
    points.push({ id, x: rx, y: ry });
    return id;
  }

  // Wall registry — reuses wall if both endpoints already match.
  const wallByPair = new Map<string, string>();
  function getOrCreateWall(a: string, b: string, thickness: number): string {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (wallByPair.has(key)) return wallByPair.get(key)!;
    const id = `w${++wCount}`;
    walls.push({ id, a, b, thickness });
    wallByPair.set(key, id);
    return id;
  }

  const rooms: Floor['rooms'] = [];

  for (const rect of rectRooms) {
    const { name, x, y, w, h } = rect;

    // 4 corners (clockwise from top-left).
    const pTL = getOrCreatePoint(x,     y);
    const pTR = getOrCreatePoint(x + w, y);
    const pBR = getOrCreatePoint(x + w, y + h);
    const pBL = getOrCreatePoint(x,     y + h);

    // 4 walls. thickness=15 for all; shared interior walls created once and reused.
    const wTop    = getOrCreateWall(pTL, pTR, 15);
    const wRight  = getOrCreateWall(pTR, pBR, 15);
    const wBottom = getOrCreateWall(pBR, pBL, 15);
    const wLeft   = getOrCreateWall(pBL, pTL, 15);

    rooms.push({
      id: `room-${name.toLowerCase().replace(/\s+/g, '-')}-${rooms.length}`,
      wallIds: [wTop, wRight, wBottom, wLeft],
      name,
      areaCm2: Math.round(w * h),
    });
  }

  // Auto-place a door opening on the first wall of each room.
  const openings: Opening[] = rooms.flatMap((room, i) => {
    const wallId = room.wallIds[0];
    if (!wallId) return [];
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) return [];
    const pa = points.find((p) => p.id === wall.a);
    const pb = points.find((p) => p.id === wall.b);
    if (!pa || !pb) return [];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len < 100) return []; // wall too short for a door
    return [{
      id: `o-door-${i}`,
      wallId,
      kind: 'door' as const,
      offset: Math.round(len / 2 - 45), // centred
      width: 90,
    }];
  });

  return { id: floorId, level: 0, points, walls, openings, rooms, furniture: [] };
}

// ---------------------------------------------------------------------------
// Build a full Plan from the AI's GenerationResult
// ---------------------------------------------------------------------------

function buildPlan(result: GenerationResult): Plan {
  const floor = rectRoomsToFloor(result.rooms, 'f0');
  return {
    id: result.id,
    name: result.name,
    units: 'cm',
    plot: result.plot,
    vastu: result.vastu,
    floors: [floor],
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generatePlan(params: GenerateParams): Promise<Plan> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('Server returned non-JSON response.');
  }

  if (!res.ok) {
    const errMsg = (json as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  const result = GenerationResultSchema.parse(json);
  console.log('[generate] rooms from AI:', result.rooms.map((r) => `${r.name} (${r.w}×${r.h})`));

  return buildPlan(result);
}
