import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { GENERATE_SYSTEM_PROMPT, buildGeneratePrompt } from './_prompts.js';
import { extractJson } from './_shared.js';
import { generateLayout } from './_layout.js';
import type { RoomSpec, RoomType } from './_layout.js';

const VALID_TYPES = new Set<RoomType>([
  'living', 'master_bedroom', 'bedroom', 'kitchen', 'bathroom',
  'pooja', 'dining', 'study', 'parking', 'store', 'utility',
]);
const VALID_SIZES = new Set(['small', 'medium', 'large']);

interface Setbacks { front: number; rear: number; left: number; right: number }
interface Plot { widthCm: number; depthCm: number; shape: string; entrance: 'N'|'S'|'E'|'W'; setbacks: Setbacks }
interface VastuConfig { mode: string }

function buildableZone(plot: Plot) {
  const { widthCm, depthCm, entrance, setbacks: { front: f, rear: r, left: l, right: rt } } = plot;
  switch (entrance) {
    case 'N': return { xMin: l, xMax: widthCm - rt, yMin: f, yMax: depthCm - r };
    case 'S': return { xMin: rt, xMax: widthCm - l, yMin: r, yMax: depthCm - f };
    case 'E': return { xMin: r, xMax: widthCm - f, yMin: l, yMax: depthCm - rt };
    case 'W': return { xMin: f, xMax: widthCm - r, yMin: rt, yMax: depthCm - l };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });

  try {
    const body = req.body as { prompt: string; plot: Plot; vastu: VastuConfig };
    const { plot, vastu } = body;

    // Phase 1: Gemini decides which rooms to include and their relative sizes
    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
    const completion = await client.chat.completions.create({
      model: process.env.GEMINI_MODEL ?? 'google/gemini-3.1-flash-image',
      max_tokens: 2000,
      temperature: 0.4,
      messages: [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        { role: 'user',   content: buildGeneratePrompt(body) },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? '';
    const jsonStr = extractJson(text);
    if (!jsonStr) {
      return res.status(500).json({ error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) });
    }

    let parsed: { name?: string; rooms?: unknown[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'Failed to parse model JSON. Raw: ' + jsonStr.slice(0, 300) });
    }

    // Validate and filter room specs
    const rawRooms = Array.isArray(parsed.rooms) ? parsed.rooms : [];
    const specs: RoomSpec[] = rawRooms
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .filter(r => VALID_TYPES.has(r.type as RoomType) && VALID_SIZES.has(r.size as string))
      .map(r => ({
        name: String(r.name ?? r.type),
        type: r.type as RoomType,
        size: r.size as 'small' | 'medium' | 'large',
      }));

    if (specs.length === 0) {
      return res.status(500).json({ error: 'Model returned no valid room specs. Raw: ' + jsonStr.slice(0, 300) });
    }

    // Phase 2: Layout algorithm places rooms — guaranteed no overlaps, fills space
    const buildable = buildableZone(plot);
    const rooms = generateLayout(buildable, specs, plot.entrance);

    const result = {
      id: 'plan-ai',
      name: typeof parsed.name === 'string' ? parsed.name : 'AI Generated Plan',
      plot,
      vastu,
      rooms,
    };

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
