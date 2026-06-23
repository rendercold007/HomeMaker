import type { Plan } from '../model/types';

export type ViewType = 'interior' | 'exterior';
export type Quality  = 'quick' | 'hd';

export interface RenderResult {
  url: string;
  prompt: string;
}

export async function renderPlan(
  plan: Plan,
  view: ViewType = 'interior',
  quality: Quality = 'quick',
): Promise<RenderResult> {
  const res = await fetch('/api/render', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ plan, view, quality }),
  });

  const json = await res.json() as { url?: string; prompt?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return { url: json.url, prompt: json.prompt ?? '' };
}
