import type { Plan } from '../model/types';

export type ViewType = 'interior' | 'exterior';
export type Quality  = 'quick' | 'hd';

export interface RenderResult {
  url: string;
  prompt: string;
}

/**
 * @param image - optional PNG data URL of the 2D floor plan, used as a
 *                structural reference so the render matches the actual layout.
 */
export async function renderPlan(
  plan: Plan,
  view: ViewType = 'interior',
  quality: Quality = 'quick',
  image?: string | null,
): Promise<RenderResult> {
  const res = await fetch('/api/render', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ plan, view, quality, image: image ?? undefined }),
  });

  const json = await res.json() as { url?: string; prompt?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return { url: json.url, prompt: json.prompt ?? '' };
}
