import type { Plan } from '../model/types';

export type ViewType = 'interior' | 'exterior';
export type Quality  = 'quick' | 'hd';

export interface RenderResult {
  url: string;
  prompt: string;
}

export interface RenderOptions {
  view?: ViewType;
  quality?: Quality;
  /** PNG data URL of the 2D floor plan — structural reference for the render. */
  image?: string | null;
  /** Specific room or angle to render (e.g. "Living Room", "front facade"). */
  scene?: string;
}

export async function renderPlan(plan: Plan, opts: RenderOptions = {}): Promise<RenderResult> {
  const { view = 'interior', quality = 'quick', image, scene } = opts;
  const res = await fetch('/api/render', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ plan, view, quality, image: image ?? undefined, scene }),
  });

  const json = await res.json() as { url?: string; prompt?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return { url: json.url, prompt: json.prompt ?? '' };
}
