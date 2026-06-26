/**
 * Production auto-furnish endpoint (Vercel serverless function).
 *
 * Forwards the request to the Python worker (LLM + spatial solver, step 3) at
 * WORKER_URL when that env var is set; otherwise returns the step-1 hardcoded
 * mock so the deployed app still works without a worker. Wire shape:
 * src/lib/aiPipeline/contract.ts. See docs/BackenAndAI.md.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM_TIMEOUT_MS = 30_000;

const MOCK_AUTO_FURNISH = {
  generated_furniture: [
    { asset_id: 'mock_double_bed_001', type: 'double_bed', position: [2.5, 0, 3.0], rotation: [0, 0, 0] },
    { asset_id: 'mock_dresser_001', type: 'wardrobe', position: [1.0, 0, 0.7], rotation: [0, 90, 0] },
  ],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const base = process.env.WORKER_URL?.replace(/\/$/, '');
  if (base) {
    try {
      const upstream = await fetch(`${base}/auto-furnish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), // don't hang on a stuck worker
      });
      res.status(upstream.status).json(await upstream.json());
      return;
    } catch (err) {
      // Worker unreachable → log so a misconfigured WORKER_URL is diagnosable, then
      // fall through to the mock so the deployed app keeps working.
      console.error('[auto-furnish] worker request failed, using mock:', err);
    }
  }

  res.status(200).json(MOCK_AUTO_FURNISH);
}
