import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

interface Room { name: string }
interface Floor { rooms: Room[] }
interface Plot { widthCm: number; depthCm: number; entrance: string }
interface VastuConfig { mode: string }
interface Plan { plot: Plot; vastu: VastuConfig; floors: Floor[] }

type ViewType = 'interior' | 'exterior';
type Quality  = 'quick' | 'hd';

// OpenRouter image-output models (chat-completions + modalities, NOT /images).
const MODEL: Record<Quality, string> = {
  quick: 'google/gemini-3.1-flash-image',
  hd:    'google/gemini-3-pro-image',
};

// Response shape: choices[].message.images[].image_url.url (base64 data URL).
// This field is an OpenRouter extension absent from the OpenAI SDK types.
interface ImageMessage {
  images?: Array<{ image_url?: { url?: string } }>;
}

function buildPrompt(plan: Plan, view: ViewType, hasFloorPlan: boolean, scene?: string): string {
  const { plot, vastu, floors } = plan;
  const rooms = floors[0]?.rooms ?? [];
  const roomList = rooms.map(r => r.name).join(', ');
  const plotW = (plot.widthCm / 100).toFixed(1);
  const plotD = (plot.depthCm / 100).toFixed(1);
  const vastuNote = vastu.mode !== 'off' ? 'Vastu Shastra compliant, ' : '';
  const facing = ({ N: 'north', S: 'south', E: 'east', W: 'west' } as Record<string, string>)[plot.entrance] ?? 'north';

  // When a floor-plan image is attached, instruct the model to follow it.
  const planRef = hasFloorPlan
    ? `Use the attached 2D floor plan as the exact structural reference — keep the same room positions, proportions, and adjacencies shown in the plan. `
    : '';

  if (view === 'interior') {
    const focus = scene
      ? `Show the ${scene}, viewed from inside the room at standing eye level. `
      : '';
    return (
      `${planRef}Generate a photorealistic interior architectural render of a modern Indian residential home. ` +
      `${focus}Rooms in the home: ${roomList}. ${plotW}m × ${plotD}m ${facing}-facing plot. ` +
      `${vastuNote}warm Indian interior design, marble flooring in living areas, ` +
      `warm ambient lighting, wooden accents, decorative jali screens, ` +
      `traditional Indian artwork on walls, lush indoor plants. ` +
      `Ultra-realistic, professional architectural photography, 8K detail, dramatic lighting.`
    );
  }

  const angle = scene
    ? `Show the ${scene}. `
    : '';
  return (
    `${planRef}Generate a photorealistic exterior render of a modern Indian residential house. ` +
    `${angle}${plotW}m × ${plotD}m plot, ${facing}-facing entrance. ` +
    `${vastuNote}contemporary Indian architecture, warm sandstone and white render finish, ` +
    `traditional carved details, terracotta roof accents, landscaped front garden ` +
    `with jasmine and marigold, paved driveway. ` +
    `Golden hour lighting, professional architectural photography, ultra-detailed, 8K.`
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });

  try {
    const { plan, view = 'interior', quality = 'quick', image, scene } = req.body as {
      plan: Plan;
      view?: ViewType;
      quality?: Quality;
      image?: string;  // PNG data URL of the 2D floor plan
      scene?: string;  // specific room / angle to render
    };

    if (!plan) return res.status(400).json({ error: 'plan is required.' });

    const hasFloorPlan = typeof image === 'string' && image.startsWith('data:image');
    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
    const prompt = buildPrompt(plan, view, hasFloorPlan, scene);

    // Multimodal message: text prompt + (optionally) the floor-plan image so the
    // render follows the actual layout instead of inventing one.
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    if (hasFloorPlan) {
      content.push({ type: 'image_url', image_url: { url: image } });
    }

    // `modalities: ['image','text']` and multimodal content parts are OpenRouter
    // extensions not present in the OpenAI SDK param types — cast the body.
    const completion = await client.chat.completions.create({
      model: MODEL[quality] ?? MODEL.quick,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    } as unknown as Parameters<typeof client.chat.completions.create>[0]) as {
      choices?: Array<{ message?: ImageMessage }>;
    };

    const message = completion.choices?.[0]?.message;
    const url = message?.images?.[0]?.image_url?.url;
    if (!url) {
      return res.status(500).json({ error: 'Model returned no image. Try again or switch quality.' });
    }

    return res.status(200).json({ url, prompt });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
