// Self-contained prompts for Vercel API functions.
// No imports from src/ to avoid cross-boundary resolution issues.

export const SYSTEM_PROMPT = `You are an Indian home floor-plan layout generator.

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
1. Every room must fit strictly within the BUILDABLE ZONE (given in user prompt).
   Room must satisfy: x >= xMin, x+w <= xMax, y >= yMin, y+h <= yMax.

2. Rooms must NOT OVERLAP. Two rooms overlap if their rectangles intersect.
   Adjacent rooms should share an edge (touching, not overlapping):
   e.g. room A at x=150,w=300 and room B at x=450 — they share the wall at x=450.

3. Rooms must TILE the buildable zone — together they should fill the space
   with no large gaps between them.

4. Every room rectangle must have realistic dimensions:
   - Living room:    w >= 350, h >= 300
   - Bedroom:        w >= 270, h >= 270
   - Master bedroom: w >= 330, h >= 330
   - Kitchen:        w >= 200, h >= 200
   - Bathroom:       w >= 120, h >= 150
   - Pooja room:     w >= 120, h >= 120
   - Parking:        w >= 270, h >= 500

═══════════════════════════════════════════════════════════
VASTU PLACEMENT (centroid relative to plot centre)
═══════════════════════════════════════════════════════════
Plot centre = (widthCm/2, depthCm/2). Compare each room's centre (x+w/2, y+h/2):

  NE = room centre right of plot centre AND above plot centre  → Pooja room, Study
  SE = room centre right AND below centre                      → Kitchen
  SW = room centre left AND below centre                       → Master Bedroom
  NW = room centre left AND above centre                       → Bathroom, Garage
  N  = near top                                                → Living Room
  S  = near bottom                                             → Bedrooms, Dining

Strict mode: follow exactly. Loose mode: adjacent directions acceptable.

═══════════════════════════════════════════════════════════
EXAMPLE — 2-room layout on a 700×500 cm plot, entrance E
Buildable zone: x ∈ [150, 550], y ∈ [90, 410]
═══════════════════════════════════════════════════════════
{
  "id": "plan-ai",
  "name": "Simple 1BHK",
  "plot": {"widthCm":700,"depthCm":500,"shape":"rectangular","entrance":"E",
           "setbacks":{"front":150,"rear":150,"left":90,"right":90}},
  "vastu": {"mode":"loose"},
  "rooms": [
    {"name":"Living Room","x":150,"y":90,"w":200,"h":320},
    {"name":"Bedroom",    "x":350,"y":90,"w":200,"h":200},
    {"name":"Kitchen",    "x":350,"y":290,"w":200,"h":120},
    {"name":"Bathroom",   "x":150,"y":290,"w":120,"h":120}
  ]
}

Note: in the example rooms share edges (Living Room right edge x=350 = Bedroom left edge x=350).

Now generate a complete layout for the user's requirements.`;

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

export function buildUserPrompt(params: { prompt: string; plot: Plot; vastu: VastuConfig }): string {
  const { prompt, plot, vastu } = params;
  const { widthCm, depthCm, shape } = plot;
  const { xMin, xMax, yMin, yMax } = buildableZone(plot);
  const plotSqM = ((widthCm / 100) * (depthCm / 100)).toFixed(1);

  return `PLOT:
  Size: ${widthCm} × ${depthCm} cm (${plotSqM} m²), shape: ${shape}
  Entrance: ${plot.entrance}
  Buildable zone: x ∈ [${xMin}, ${xMax}] (width ${xMax - xMin} cm), y ∈ [${yMin}, ${yMax}] (height ${yMax - yMin} cm)
  Plot centre: (${widthCm / 2}, ${depthCm / 2})

VASTU MODE: ${vastu.mode}

REQUIREMENTS:
${prompt}

Generate the rooms[] array. All rooms must fit inside x ∈ [${xMin}, ${xMax}], y ∈ [${yMin}, ${yMax}].
Adjacent rooms share edges. No overlaps. Fill the space efficiently.`;
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

  return `PLOT:
  Size: ${widthCm} × ${depthCm} cm, entrance: ${plot.entrance}
  Buildable zone: x ∈ [${xMin}, ${xMax}], y ∈ [${yMin}, ${yMax}]
  Plot centre: (${widthCm / 2}, ${depthCm / 2})

VASTU MODE: ${vastu.mode}

CURRENT LAYOUT (approximate room bounding boxes):
${roomLines.length ? roomLines.join('\n') : '  (no rooms yet)'}

USER REQUEST:
${message}

Respond with the complete modified layout as JSON in the same format as usual.
Keep rooms that the user did not ask to change. Honour Vastu placement rules.
All rooms must fit in the buildable zone. No overlaps.`;
}
