import type { Plan } from '../model/types';
import { GenerationResultSchema } from './schema';
import { buildPlanFromResult } from './planBuilder';

export async function assistPlan(plan: Plan, message: string): Promise<Plan> {
  const res = await fetch('/api/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, message }),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`);
  }

  const result = GenerationResultSchema.parse(json);
  console.log('[assist] rooms:', result.rooms.map((r) => r.name));

  // Preserve original plot/vastu if AI echoed them; fall back to current plan's.
  return buildPlanFromResult({
    ...result,
    plot:  result.plot  ?? plan.plot,
    vastu: result.vastu ?? plan.vastu,
  });
}
