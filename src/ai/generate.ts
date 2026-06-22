import type { Plan, Plot, VastuConfig } from '../model/types';
import { GenerationResultSchema } from './schema';
import { buildPlanFromResult } from './planBuilder';

export interface GenerateParams {
  prompt: string;
  plot: Plot;
  vastu: VastuConfig;
}

export async function generatePlan(params: GenerateParams): Promise<Plan> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  let json: unknown;
  try { json = await res.json(); }
  catch { throw new Error('Server returned non-JSON response.'); }

  if (!res.ok) {
    throw new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`);
  }

  const result = GenerationResultSchema.parse(json);
  console.log('[generate] rooms:', result.rooms.map((r) => `${r.name} ${r.w}×${r.h}`));
  return buildPlanFromResult(result);
}
