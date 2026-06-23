import { defineConfig, type Plugin } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as T); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function buildableZone(plot: {
  widthCm: number; depthCm: number;
  entrance: string;
  setbacks: { front: number; rear: number; left: number; right: number };
}) {
  const { widthCm, depthCm, entrance, setbacks: { front: f, rear: r, left: l, right: rt } } = plot;
  switch (entrance) {
    case 'N': return { xMin: l,  xMax: widthCm - rt, yMin: f,  yMax: depthCm - r  };
    case 'S': return { xMin: rt, xMax: widthCm - l,  yMin: r,  yMax: depthCm - f  };
    case 'E': return { xMin: r,  xMax: widthCm - f,  yMin: l,  yMax: depthCm - rt };
    case 'W': return { xMin: f,  xMax: widthCm - r,  yMin: rt, yMax: depthCm - l  };
    default:  return { xMin: l,  xMax: widthCm - rt, yMin: f,  yMax: depthCm - r  };
  }
}

type RoomType =
  | 'living' | 'master_bedroom' | 'bedroom' | 'kitchen'
  | 'bathroom' | 'pooja' | 'dining' | 'study' | 'parking' | 'store' | 'utility';

const VALID_TYPES = new Set<RoomType>([
  'living', 'master_bedroom', 'bedroom', 'kitchen', 'bathroom',
  'pooja', 'dining', 'study', 'parking', 'store', 'utility',
]);
const VALID_SIZES = new Set(['small', 'medium', 'large']);

function aiProxyPlugin(): Plugin {
  let env: Record<string, string> = {};

  return {
    name: 'ai-proxy',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '');
    },

    configureServer(server) {
      // ── POST /api/generate ────────────────────────────────────────────────
      // Phase 1: Gemini chooses rooms (name/type/size — no coordinates).
      // Phase 2: Layout algorithm places them deterministically.
      server.middlewares.use('/api/generate', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
        try {
          const body = await readBody<{
            prompt: string;
            plot: import('./src/model/types').Plot;
            vastu: import('./src/model/types').VastuConfig;
          }>(req);

          const apiKey = env.OPENROUTER_API_KEY;
          if (!apiKey) {
            sendJson(res, 500, { error: 'OPENROUTER_API_KEY is not configured. Add it to .env.local.' });
            return;
          }

          const { default: OpenAI }                            = await import('openai');
          const { GENERATE_SYSTEM_PROMPT, buildGeneratePrompt } = await import('./api/_prompts');
          const { extractJson }                                = await import('./api/_shared');
          const { generateLayout }                             = await import('./api/_layout');

          const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
          const completion = await client.chat.completions.create({
            model:       env.GEMINI_MODEL ?? 'google/gemini-3.1-flash-image',
            max_tokens:  2000,
            temperature: 0.4,
            messages: [
              { role: 'system', content: GENERATE_SYSTEM_PROMPT },
              { role: 'user',   content: buildGeneratePrompt(body) },
            ],
          });

          const text    = completion.choices[0]?.message?.content ?? '';
          const jsonStr = extractJson(text);
          console.log('\n[/api/generate]', completion.choices[0]?.finish_reason, '|', text.slice(0, 200));

          if (!jsonStr) {
            sendJson(res, 500, { error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) });
            return;
          }

          let parsed: { name?: string; rooms?: unknown[] };
          try { parsed = JSON.parse(jsonStr); }
          catch { sendJson(res, 500, { error: 'Failed to parse model JSON.' }); return; }

          const specs = (Array.isArray(parsed.rooms) ? parsed.rooms : [])
            .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
            .filter(r => VALID_TYPES.has(r.type as RoomType) && VALID_SIZES.has(r.size as string))
            .map(r => ({
              name: String(r.name ?? r.type),
              type: r.type as RoomType,
              size: r.size as 'small' | 'medium' | 'large',
            }));

          if (!specs.length) {
            sendJson(res, 500, { error: 'Model returned no valid room specs. Raw: ' + jsonStr.slice(0, 300) });
            return;
          }

          const { plot, vastu } = body;
          const rooms = generateLayout(buildableZone(plot), specs, plot.entrance as 'N'|'S'|'E'|'W');
          sendJson(res, 200, { id: 'plan-ai', name: typeof parsed.name === 'string' ? parsed.name : 'AI Generated Plan', plot, vastu, rooms });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /api/render ──────────────────────────────────────────────────
      // Image generation via OpenRouter chat-completions + image modality.
      // OpenRouter has no /images endpoint; images come back as base64 data URLs
      // in choices[].message.images[].image_url.url.
      server.middlewares.use('/api/render', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
        try {
          const body = await readBody<{
            plan: import('./src/model/types').Plan;
            view?: 'interior' | 'exterior';
            quality?: 'quick' | 'hd';
            image?: string;
          }>(req);

          const apiKey = env.OPENROUTER_API_KEY;
          if (!apiKey) {
            sendJson(res, 500, { error: 'OPENROUTER_API_KEY is not configured. Add it to .env.local.' });
            return;
          }

          const { default: OpenAI } = await import('openai');
          const { plan, view = 'interior', quality = 'quick', image } = body;

          const MODEL: Record<string, string> = {
            quick: 'google/gemini-3.1-flash-image',
            hd:    'google/gemini-3-pro-image',
          };

          const hasFloorPlan = typeof image === 'string' && image.startsWith('data:image');
          const rooms    = plan.floors[0]?.rooms ?? [];
          const roomList = rooms.map((r: { name: string }) => r.name).join(', ');
          const plotW    = (plan.plot.widthCm / 100).toFixed(1);
          const plotD    = (plan.plot.depthCm / 100).toFixed(1);
          const facing   = ({ N:'north', S:'south', E:'east', W:'west' } as Record<string, string>)[plan.plot.entrance] ?? 'north';
          const vastuNote = plan.vastu.mode !== 'off' ? 'Vastu Shastra compliant, ' : '';
          const planRef   = hasFloorPlan ? 'Use the attached 2D floor plan as the exact structural reference — keep the same room positions, proportions, and adjacencies shown in the plan. ' : '';

          const prompt = view === 'interior'
            ? `${planRef}Generate a photorealistic interior architectural render of a modern Indian residential home. Rooms: ${roomList}. ${plotW}m × ${plotD}m ${facing}-facing plot. ${vastuNote}warm Indian interior design, marble flooring in living areas, warm ambient lighting, wooden accents, decorative jali screens, traditional Indian artwork on walls, lush indoor plants. Ultra-realistic, professional architectural photography, 8K detail, dramatic lighting.`
            : `${planRef}Generate a photorealistic exterior render of a modern Indian residential house. ${plotW}m × ${plotD}m plot, ${facing}-facing entrance. ${vastuNote}contemporary Indian architecture, warm sandstone and white render finish, traditional carved details, terracotta roof accents, landscaped front garden with jasmine and marigold, paved driveway. Golden hour lighting, professional architectural photography, ultra-detailed, 8K.`;

          const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
          if (hasFloorPlan) content.push({ type: 'image_url', image_url: { url: image } });

          const client   = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
          const completion = await client.chat.completions.create({
            model: MODEL[quality] ?? MODEL.quick,
            messages: [{ role: 'user', content }],
            modalities: ['image', 'text'],
          } as unknown as Parameters<typeof client.chat.completions.create>[0]) as {
            choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
          };

          const url = completion.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          if (!url) { sendJson(res, 500, { error: 'Model returned no image. Try again or switch quality.' }); return; }

          console.log('\n[/api/render]', view, quality, '| image bytes:', url.length);
          sendJson(res, 200, { url, prompt });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /api/assist ──────────────────────────────────────────────────
      server.middlewares.use('/api/assist', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
        try {
          const body = await readBody<{
            plan: import('./src/model/types').Plan;
            message: string;
          }>(req);

          const apiKey = env.OPENROUTER_API_KEY;
          if (!apiKey) {
            sendJson(res, 500, { error: 'OPENROUTER_API_KEY is not configured. Add it to .env.local.' });
            return;
          }

          const { default: OpenAI }                           = await import('openai');
          const { ASSIST_SYSTEM_PROMPT, buildAssistPrompt }   = await import('./api/_prompts');
          const { extractJson }                               = await import('./api/_shared');

          const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
          const completion = await client.chat.completions.create({
            model:       env.GEMINI_MODEL ?? 'google/gemini-3.1-flash-image',
            max_tokens:  8000,
            temperature: 0.4,
            messages: [
              { role: 'system', content: ASSIST_SYSTEM_PROMPT },
              { role: 'user',   content: buildAssistPrompt(body) },
            ],
          });

          const text    = completion.choices[0]?.message?.content ?? '';
          const jsonStr = extractJson(text);
          console.log('\n[/api/assist]', completion.choices[0]?.finish_reason, '|', text.slice(0, 200));

          if (!jsonStr) {
            sendJson(res, 500, { error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) });
            return;
          }

          sendJson(res, 200, jsonStr);
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
