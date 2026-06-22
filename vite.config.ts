import { defineConfig, type Plugin } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Shared helper — buffers the request body and returns parsed JSON.
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

// Shared helper — strips markdown fences and extracts the outermost {...} block.
function extractJson(text: string): string | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  return stripped.slice(start, end + 1);
}

function aiProxyPlugin(): Plugin {
  let env: Record<string, string> = {};

  return {
    name: 'ai-proxy',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '');
    },
    configureServer(server) {
      // ── /api/generate ─────────────────────────────────────────────────────
      server.middlewares.use(
        '/api/generate',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          try {
            const body = await readBody<{
              prompt: string;
              plot: import('./src/model/types').Plot;
              vastu: import('./src/model/types').VastuConfig;
            }>(req);

            const apiKey = env.DEEPSEEK_API_KEY;
            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY is not configured. Add it to .env.local.' }));
              return;
            }

            const { default: OpenAI } = await import('openai');
            const { SYSTEM_PROMPT, buildUserPrompt } = await import('./src/ai/prompts');

            const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
            const completion = await client.chat.completions.create({
              model: env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-chat',
              max_tokens: 8000,
              temperature: 0.3,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: buildUserPrompt(body) },
              ],
            });

            const choice = completion.choices[0];
            const text   = choice?.message?.content ?? '';
            console.log('\n[/api/generate]', choice?.finish_reason, '|', text.slice(0, 300) || '(empty)');

            const jsonStr = extractJson(text);
            if (!jsonStr) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(jsonStr);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          }
        },
      );

      // ── /api/assist ───────────────────────────────────────────────────────
      server.middlewares.use(
        '/api/assist',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          try {
            const body = await readBody<{
              plan: import('./src/model/types').Plan;
              message: string;
            }>(req);

            const apiKey = env.DEEPSEEK_API_KEY;
            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY is not configured. Add it to .env.local.' }));
              return;
            }

            const { default: OpenAI } = await import('openai');
            const { SYSTEM_PROMPT, buildAssistPrompt } = await import('./src/ai/prompts');

            const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
            const completion = await client.chat.completions.create({
              model: env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-chat',
              max_tokens: 8000,
              temperature: 0.4,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: buildAssistPrompt(body) },
              ],
            });

            const choice = completion.choices[0];
            const text   = choice?.message?.content ?? '';
            console.log('\n[/api/assist]', choice?.finish_reason, '|', text.slice(0, 300) || '(empty)');

            const jsonStr = extractJson(text);
            if (!jsonStr) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(jsonStr);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          }
        },
      );
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
