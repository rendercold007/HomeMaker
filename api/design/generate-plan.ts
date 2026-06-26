/**
 * Production floor-plan generation endpoint (Vercel serverless function).
 *
 * Forwards to the Python worker (LLM + layout generator) at `${WORKER_URL}/generate-plan`.
 * Unlike auto-furnish there is no mock fallback — generating a plan needs the
 * worker, so if it's unreachable we report that. Wire shape:
 * src/lib/aiPipeline/contract.ts (GeneratedPlan). See docs/BackenAndAI.md.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM_TIMEOUT_MS = 30_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const base = process.env.WORKER_URL?.replace(/\/$/, '');
  if (!base) {
    res.status(503).json({ error: 'AI worker not configured (set WORKER_URL).' });
    return;
  }

  try {
    const upstream = await fetch(`${base}/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), // don't hang on a stuck worker
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    // Surface the upstream failure so a misconfigured WORKER_URL is diagnosable.
    console.error('[generate-plan] worker request failed:', err);
    res.status(503).json({ error: 'AI worker unreachable.' });
  }
}
