/**
 * Strip-based floor plan layout engine.
 *
 * Gemini decides WHAT rooms to include and their relative sizes.
 * This algorithm decides WHERE each room goes — guaranteeing no overlaps,
 * full space coverage, and Vastu-aligned placement.
 *
 * Strategy: divide the buildable zone into 3 horizontal strips (front/middle/back),
 * assign each room type to a strip, then lay rooms side-by-side within each strip
 * sorted by their east/west Vastu preference.
 */

export type RoomType =
  | 'living' | 'master_bedroom' | 'bedroom' | 'kitchen'
  | 'bathroom' | 'pooja' | 'dining' | 'study' | 'parking' | 'store' | 'utility';

export interface RoomSpec {
  name: string;
  type: RoomType;
  size: 'small' | 'medium' | 'large';
}

export interface PlacedRoom {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Rect { x: number; y: number; w: number; h: number }

// Minimum room dimensions in cm (based on real Indian construction norms)
const MIN_DIMS: Record<RoomType, { w: number; h: number }> = {
  living:          { w: 380, h: 320 },
  master_bedroom:  { w: 350, h: 330 },
  bedroom:         { w: 280, h: 270 },
  dining:          { w: 280, h: 250 },
  kitchen:         { w: 220, h: 200 },
  bathroom:        { w: 130, h: 150 },
  pooja:           { w: 130, h: 130 },
  study:           { w: 220, h: 200 },
  parking:         { w: 300, h: 550 },
  store:           { w: 130, h: 130 },
  utility:         { w: 150, h: 130 },
};

const SIZE_MULT: Record<string, number> = { small: 1.0, medium: 1.25, large: 1.55 };

function dims(spec: RoomSpec): { w: number; h: number } {
  const base = MIN_DIMS[spec.type] ?? { w: 200, h: 200 };
  const m = SIZE_MULT[spec.size] ?? 1.0;
  return { w: Math.round(base.w * m), h: Math.round(base.h * m) };
}

// Which strip each room type belongs to
type Strip = 'front' | 'middle' | 'back';
const STRIP_ORDER: Strip[] = ['front', 'middle', 'back'];

const ROOM_STRIP: Record<RoomType, Strip> = {
  living:          'front',
  pooja:           'front',
  study:           'front',
  parking:         'front',
  dining:          'middle',
  kitchen:         'middle',
  utility:         'middle',
  store:           'middle',
  master_bedroom:  'back',
  bedroom:         'back',
  bathroom:        'back',
};

// East/West Vastu preference — determines left-to-right order within a strip
// W = west side (left for N entrance), E = east side (right for N entrance)
type EWPref = 'W' | 'C' | 'E';
const EW_ORDER: Record<EWPref, number> = { W: 0, C: 1, E: 2 };

const EW_PREF: Record<RoomType, EWPref> = {
  living:          'C',
  pooja:           'E',  // NE
  study:           'E',  // NE
  parking:         'W',  // NW
  dining:          'C',
  kitchen:         'E',  // SE
  utility:         'W',
  store:           'W',
  master_bedroom:  'W',  // SW
  bedroom:         'C',
  bathroom:        'W',  // NW / W
};

// North/South preference — used when strips are vertical (E/W entrance)
type NSPref = 'N' | 'C' | 'S';
const NS_ORDER: Record<NSPref, number> = { N: 0, C: 1, S: 2 };

const NS_PREF: Record<RoomType, NSPref> = {
  living:          'N',
  pooja:           'N',  // NE
  study:           'N',  // NE
  parking:         'N',  // NW
  dining:          'C',
  kitchen:         'S',  // SE
  utility:         'S',
  store:           'S',
  master_bedroom:  'S',  // SW
  bedroom:         'S',
  bathroom:        'N',  // NW
};

function layoutRow(rect: Rect, specs: RoomSpec[]): PlacedRoom[] {
  if (!specs.length) return [];
  const minWidths = specs.map(s => dims(s).w);
  const totalMinW = minWidths.reduce((a, b) => a + b, 0);
  const rooms: PlacedRoom[] = [];
  let x = rect.x;
  for (let i = 0; i < specs.length; i++) {
    const isLast = i === specs.length - 1;
    const w = isLast
      ? Math.round(rect.x + rect.w - x)
      : Math.round((minWidths[i] / totalMinW) * rect.w);
    rooms.push({ name: specs[i].name, x, y: rect.y, w, h: rect.h });
    x += w;
  }
  return rooms;
}

function layoutCol(rect: Rect, specs: RoomSpec[]): PlacedRoom[] {
  if (!specs.length) return [];
  const minHeights = specs.map(s => dims(s).h);
  const totalMinH = minHeights.reduce((a, b) => a + b, 0);
  const rooms: PlacedRoom[] = [];
  let y = rect.y;
  for (let i = 0; i < specs.length; i++) {
    const isLast = i === specs.length - 1;
    const h = isLast
      ? Math.round(rect.y + rect.h - y)
      : Math.round((minHeights[i] / totalMinH) * rect.h);
    rooms.push({ name: specs[i].name, x: rect.x, y, w: rect.w, h });
    y += h;
  }
  return rooms;
}

function scaleToFill(minValues: number[], totalAvailable: number): number[] {
  const total = minValues.reduce((a, b) => a + b, 0);
  if (total <= 0) return minValues;
  const scaled = minValues.map((v, i) =>
    i === minValues.length - 1
      ? totalAvailable - minValues.slice(0, i).reduce((a, b) => a + Math.round((b / total) * totalAvailable), 0)
      : Math.round((v / total) * totalAvailable)
  );
  return scaled;
}

export function generateLayout(
  buildable: { xMin: number; xMax: number; yMin: number; yMax: number },
  specs: RoomSpec[],
  entrance: 'N' | 'S' | 'E' | 'W' = 'N'
): PlacedRoom[] {
  const { xMin, xMax, yMin, yMax } = buildable;
  const bw = xMax - xMin;
  const bh = yMax - yMin;

  // Assign rooms to strips
  const stripRooms: Record<Strip, RoomSpec[]> = { front: [], middle: [], back: [] };
  for (const spec of specs) {
    const strip = ROOM_STRIP[spec.type] ?? 'back';
    stripRooms[strip].push(spec);
  }

  const activeStrips = STRIP_ORDER.filter(s => stripRooms[s].length > 0);
  if (activeStrips.length === 0) return [];

  const isHorizontal = entrance === 'N' || entrance === 'S';

  if (isHorizontal) {
    // Strips are horizontal bands stacked top-to-bottom
    // N entrance: front=top, back=bottom
    // S entrance: front=bottom, back=top (reverse display order)

    const stripMinH = activeStrips.map(s =>
      Math.max(...stripRooms[s].map(r => dims(r).h))
    );
    const heights = scaleToFill(stripMinH, bh);

    // For S entrance, display order is reversed (front strip at bottom)
    const displayStrips = entrance === 'S' ? [...activeStrips].reverse() : activeStrips;
    const displayH = entrance === 'S' ? [...heights].reverse() : heights;

    const placed: PlacedRoom[] = [];
    let curY = yMin;
    for (let i = 0; i < displayStrips.length; i++) {
      const strip = displayStrips[i];
      const h = displayH[i];
      // Sort rooms W→C→E. For S entrance, entering from south looking north,
      // east is still absolute east (right = high x), so no reversal needed.
      const sorted = [...stripRooms[strip]].sort(
        (a, b) => (EW_ORDER[EW_PREF[a.type]] ?? 1) - (EW_ORDER[EW_PREF[b.type]] ?? 1)
      );
      placed.push(...layoutRow({ x: xMin, y: curY, w: bw, h }, sorted));
      curY += h;
    }
    return placed;
  } else {
    // Strips are vertical bands (E/W entrance)
    // W entrance: front=left (low x), back=right → display front→middle→back left to right
    // E entrance: front=right (high x), back=left → display back→middle→front left to right

    const stripMinW = activeStrips.map(s =>
      Math.max(...stripRooms[s].map(r => dims(r).w))
    );
    const widths = scaleToFill(stripMinW, bw);

    const displayStrips = entrance === 'E' ? [...activeStrips].reverse() : activeStrips;
    const displayW = entrance === 'E' ? [...widths].reverse() : widths;

    const placed: PlacedRoom[] = [];
    let curX = xMin;
    for (let i = 0; i < displayStrips.length; i++) {
      const strip = displayStrips[i];
      const w = displayW[i];
      const sorted = [...stripRooms[strip]].sort(
        (a, b) => (NS_ORDER[NS_PREF[a.type]] ?? 1) - (NS_ORDER[NS_PREF[b.type]] ?? 1)
      );
      placed.push(...layoutCol({ x: curX, y: yMin, w, h: bh }, sorted));
      curX += w;
    }
    return placed;
  }
}
