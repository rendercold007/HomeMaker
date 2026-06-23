// Self-contained prompts for Vercel API functions.
// No imports from src/ to avoid cross-boundary resolution issues.

// ── Generate: Gemini picks WHAT rooms; the layout engine places them ─────────
// Gemini's only job is to decide which rooms belong in this home and their
// relative sizes. No coordinates — those are computed algorithmically.

export const GENERATE_SYSTEM_PROMPT = `You are an Indian home layout assistant.

Given a plot and user request, decide which rooms the home should have.

OUTPUT ONLY a valid JSON object — no markdown, no explanation, no text outside the JSON.

{
  "name": "<short descriptive plan name>",
  "rooms": [
    { "name": "<display name>", "type": "<type>", "size": "<small|medium|large>" }
  ]
}

VALID TYPES (use exactly these strings):
  living, master_bedroom, bedroom, kitchen, bathroom,
  pooja, dining, study, parking, store, utility

SIZE GUIDE:
  large  — primary/main room of that type (e.g. master bedroom, main living room)
  medium — secondary rooms (extra bedrooms, dining, kitchen in a big house)
  small  — service rooms: bathrooms, pooja, store, utility

INDIAN HOME CONVENTIONS:
  1BHK → living(large), bedroom(medium), kitchen(medium), bathroom(small)
  2BHK → living(large), master_bedroom(large), bedroom(medium), kitchen(medium), 2×bathroom(small)
  3BHK → living(large), master_bedroom(large), 2×bedroom(medium), kitchen(medium), 2–3×bathroom(small)
  4BHK → living(large), master_bedroom(large), 3×bedroom(medium), kitchen(large), 3×bathroom(small)

ALWAYS include: living room, kitchen, at least one bathroom.
ADD by default unless the user says otherwise:
  - pooja(small) — standard in Indian homes
  - dining(medium) — if plot area ≥ 80 m²
ADD only if user mentions or plot ≥ 100 m²:
  - parking(large)
ADD if user mentions: study, store, utility`;

export const ASSIST_SYSTEM_PROMPT = `You are an Indian home floor-plan layout generator.

OUTPUT RULE: Respond with ONLY a valid JSON object. No markdown, no explanation, no text before or after the JSON.

═══════════════════════════════════════════════════════════
OUTPUT SCHEMA
═══════════════════════════════════════════════════════════
{
  "id": "plan-ai",
  "name": "<descriptive plan name>",
  "plot": { <copy the plot object from input exactly> },
  "vastu": { "mode": "<copy from input>" },
  "rooms": [
    { "name": "<room name>", "x": <number>, "y": <number>, "w": <number>, "h": <number> },
    ...
  ]
}

rooms[].x = left edge of room in cm (from plot origin, top-left)
rooms[].y = top edge of room in cm
rooms[].w = room width in cm (east direction)
rooms[].h = room height in cm (south direction)

═══════════════════════════════════════════════════════════
COORDINATE SYSTEM
═══════════════════════════════════════════════════════════
- Origin (0,0) is TOP-LEFT corner of the plot.
- x increases RIGHTWARD (East), y increases DOWNWARD (South).
- All values in CENTIMETERS (integers preferred).

═══════════════════════════════════════════════════════════
LAYOUT RULES (CRITICAL)
═══════════════════════════════════════════════════════════
1. Every room must fit strictly within the BUILDABLE ZONE given in the user prompt.
2. Rooms must NOT OVERLAP.
3. Adjacent rooms should share an edge (touching is correct, overlapping is wrong).
4. Keep rooms that the user did not ask to change.
5. Honour Vastu placement: kitchen SE, master bedroom SW, pooja NE, bathroom NW.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

interface Setbacks { front: number; rear: number; left: number; right: number }
interface Plot { widthCm: number; depthCm: number; shape: string; entrance: string; setbacks: Setbacks }
interface VastuConfig { mode: string }

function buildableZone(plot: Plot) {
  const { widthCm, depthCm, entrance, setbacks: { front: f, rear: r, left: l, right: rt } } = plot;
  switch (entrance) {
    case 'N': return { xMin: l, xMax: widthCm - rt, yMin: f, yMax: depthCm - r };
    case 'S': return { xMin: rt, xMax: widthCm - l, yMin: r, yMax: depthCm - f };
    case 'E': return { xMin: r, xMax: widthCm - f, yMin: l, yMax: depthCm - rt };
    case 'W': return { xMin: f, xMax: widthCm - r, yMin: rt, yMax: depthCm - l };
    default:  return { xMin: l, xMax: widthCm - rt, yMin: f, yMax: depthCm - r };
  }
}

export function buildGeneratePrompt(params: { prompt: string; plot: Plot; vastu: VastuConfig }): string {
  const { prompt, plot, vastu } = params;
  const { widthCm, depthCm, shape } = plot;
  const { xMin, xMax, yMin, yMax } = buildableZone(plot);
  const buildableW = xMax - xMin;
  const buildableH = yMax - yMin;
  const plotSqM = ((widthCm / 100) * (depthCm / 100)).toFixed(1);
  const buildableSqM = ((buildableW / 100) * (buildableH / 100)).toFixed(1);

  return `PLOT: ${widthCm} × ${depthCm} cm (${plotSqM} m²), shape: ${shape}, entrance: ${plot.entrance}
BUILDABLE AREA: ${buildableW} × ${buildableH} cm (${buildableSqM} m²)
VASTU MODE: ${vastu.mode}

USER REQUEST:
${prompt}

Output the room list JSON.`;
}

interface Room { id: string; wallIds: string[]; name: string; areaCm2: number }
interface Point { id: string; x: number; y: number }
interface Wall  { id: string; a: string; b: string; thickness: number }
interface Floor { rooms: Room[]; points: Point[]; walls: Wall[] }
interface Plan  { plot: Plot; vastu: VastuConfig; floors: Floor[] }

export function buildAssistPrompt(params: { plan: Plan; message: string }): string {
  const { plan, message } = params;
  const { plot, vastu, floors } = plan;
  const { widthCm, depthCm } = plot;
  const { xMin, xMax, yMin, yMax } = buildableZone(plot);

  const floor = floors[0];
  const pointById = new Map((floor?.points ?? []).map((p) => [p.id, p]));
  const wallById  = new Map((floor?.walls  ?? []).map((w) => [w.id, w]));

  const roomLines = (floor?.rooms ?? []).map((room) => {
    const pts = new Set<string>();
    for (const wid of room.wallIds) {
      const w = wallById.get(wid);
      if (w) { pts.add(w.a); pts.add(w.b); }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pid of pts) {
      const p = pointById.get(pid);
      if (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    }
    if (!isFinite(minX)) return null;
    return `  { "name": "${room.name}", "x": ${Math.round(minX)}, "y": ${Math.round(minY)}, "w": ${Math.round(maxX - minX)}, "h": ${Math.round(maxY - minY)} }`;
  }).filter(Boolean);

  return `PLOT: ${widthCm} × ${depthCm} cm, entrance: ${plot.entrance}
BUILDABLE ZONE: x ∈ [${xMin}, ${xMax}], y ∈ [${yMin}, ${yMax}]
PLOT CENTRE: (${widthCm / 2}, ${depthCm / 2})

VASTU MODE: ${vastu.mode}

CURRENT LAYOUT (room bounding boxes):
${roomLines.length ? roomLines.join('\n') : '  (no rooms yet)'}

USER REQUEST:
${message}

Return the complete modified layout JSON. Keep rooms the user did not mention.`;
}
