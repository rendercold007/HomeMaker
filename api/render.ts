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

function buildPrompt(plan: Plan, view: ViewType): string {
  const { plot, vastu, floors } = plan;
  const rooms = floors[0]?.rooms ?? [];
  const roomList = rooms.map(r => r.name).join(', ');
  const plotW = (plot.widthCm / 100).toFixed(1);
  const plotD = (plot.depthCm / 100).toFixed(1);
  const vastuNote = vastu.mode !== 'off' ? 'Vastu Shastra compliant, ' : '';
  const facing = ({ N: 'north', S: 'south', E: 'east', W: 'west' } as Record<string, string>)[plot.entrance] ?? 'north';

  if (view === 'interior') {
    return (
      `Generate a photorealistic interior architectural render of a modern Indian residential home. ` +
      `Rooms: ${roomList}. ${plotW}m × ${plotD}m ${facing}-facing plot. ` +
      `${vastuNote}warm Indian interior design, marble flooring in living areas, ` +
      `warm ambient lighting, wooden accents, decorative jali screens, ` +
      `traditional Indian artwork on walls, lush indoor plants. ` +
      `Ultra-realistic, professional architectural photography, 8K detail, dramatic lighting.`
    );
  }

  return (
    `Generate a photorealistic exterior render of a modern Indian residential house. ` +
    `${plotW}m × ${plotD}m plot, ${facing}-facing entrance. ` +
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
    const { plan, view = 'interior', quality = 'quick' } = req.body as {
      plan: Plan;
      view?: ViewType;
      quality?: Quality;
    };

    if (!plan) return res.status(400).json({ error: 'plan is required.' });

    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
    const prompt = buildPrompt(plan, view);

    const completion = await client.chat.completions.create({
      model: MODEL[quality] ?? MODEL.quick,
      messages: [{ role: 'user', content: prompt }],
      // @ts-expect-error — OpenRouter image-modality extension not in OpenAI SDK types
      modalities: ['image', 'text'],
    });

    const message = completion.choices[0]?.message as ImageMessage | undefined;
    const url = message?.images?.[0]?.image_url?.url;
    if (!url) {
      return res.status(500).json({ error: 'Model returned no image. Try again or switch quality.' });
    }

    return res.status(200).json({ url, prompt });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
