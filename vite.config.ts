import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Phase 4 — AI worker endpoints for local dev.
 *
 * `npm run dev` / `npm run preview` run plain Vite (no Vercel functions), so this
 * middleware fronts the AI routes and forwards them to the Python worker
 * (WORKER_URL base, default http://localhost:8000):
 *   POST /api/design/auto-furnish  → {base}/auto-furnish  (furniture only)
 *   POST /api/design/generate-plan → {base}/generate-plan (whole floor plan)
 *   POST /api/design/edit-plan     → {base}/edit-plan     (chat edit → patch)
 * If the worker is offline, auto-furnish falls back to the step-1 mock so the UI
 * still works; plan generation and editing can't be mocked, so they report the
 * worker is down.
 * Production uses the matching Vercel functions in api/design/. Wire shapes:
 * src/lib/aiPipeline/contract.ts.
 */
const WORKER_BASE = (process.env.WORKER_URL ?? 'http://localhost:8000').replace(/\/$/, '');

const ROUTES: Record<string, string> = {
  '/api/design/auto-furnish': '/auto-furnish',
  '/api/design/generate-plan': '/generate-plan',
  '/api/design/edit-plan': '/edit-plan',
};

const MOCK_AUTO_FURNISH = {
  generated_furniture: [
    { asset_id: 'mock_double_bed_001', type: 'double_bed', position: [2.5, 0, 3.0], rotation: [0, 0, 0] },
    { asset_id: 'mock_dresser_001', type: 'wardrobe', position: [1.0, 0, 0.7], rotation: [0, 90, 0] },
  ],
};

const UPSTREAM_TIMEOUT_MS = 30_000; // don't hang the request forever on a stuck worker

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function aiWorkerApi(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url ? ROUTES[req.url] : undefined;
    if (!path) return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const body = await readBody(req);
    res.setHeader('Content-Type', 'application/json');
    try {
      const upstream = await fetch(WORKER_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      res.statusCode = upstream.status;
      res.end(await upstream.text());
    } catch (err) {
      // Surface the upstream failure so a misconfigured WORKER_URL is diagnosable.
      console.error(`[ai-worker-api] ${req.url} → ${WORKER_BASE + path} failed:`, err);
      if (req.url === '/api/design/auto-furnish') {
        res.statusCode = 200; // worker offline → step-1 mock keeps the UI working
        res.end(JSON.stringify(MOCK_AUTO_FURNISH));
      } else {
        res.statusCode = 503; // generate-plan / edit-plan need the worker — can't be mocked
        res.end(JSON.stringify({ error: 'AI worker offline — start the worker to generate or edit a plan.' }));
      }
    }
  };
  return {
    name: 'ai-worker-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [react(), aiWorkerApi()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
