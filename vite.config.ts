import { defineConfig, type Plugin } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

function aiProxyPlugin(): Plugin {
  // Loaded in configResolved so we have access to the mode and root.
  let env: Record<string, string> = {};

  return {
    name: 'ai-proxy',
    configResolved(config) {
      // loadEnv with '' prefix loads ALL variables (not just VITE_*) from
      // .env, .env.local, .env.[mode], .env.[mode].local
      env = loadEnv(config.mode, config.root, '');
    },
    configureServer(server) {
      server.middlewares.use(
        '/api/generate',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                prompt: string;
                plot: import('./src/model/types').Plot;
                vastu: import('./src/model/types').VastuConfig;
              };

              const apiKey = env.DEEPSEEK_API_KEY;
              if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY is not configured. Add it to .env.local.' }));
                return;
              }

              // Dynamically import so the openai package is never bundled into the browser.
              const { default: OpenAI } = await import('openai');
              const { SYSTEM_PROMPT, buildUserPrompt } = await import('./src/ai/prompts');

              const client = new OpenAI({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1',
              });

              const completion = await client.chat.completions.create({
                model: env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-chat',
                max_tokens: 32000,
                temperature: 0.3,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: buildUserPrompt(body) },
                ],
              });

              const choice = completion.choices[0];
              const text = choice?.message?.content ?? '';

              // Log full response details for debugging.
              console.log('\n[AI response]');
              console.log('  finish_reason:', choice?.finish_reason);
              console.log('  usage:', completion.usage);
              console.log('  content:', text.slice(0, 1000) || '(empty)');
              console.log();

              // Strip markdown fences then grab the outermost {...} block.
              const stripped = text
                .replace(/^```(?:json)?\s*/im, '')
                .replace(/\s*```\s*$/im, '')
                .trim();
              const start = stripped.indexOf('{');
              const end = stripped.lastIndexOf('}');
              if (start === -1 || end === -1) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Model did not return valid JSON. Raw output: ' + text.slice(0, 300),
                }));
                return;
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(stripped.slice(start, end + 1));
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: msg }));
            }
          });
        },
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
