import type { Plan } from '../model/types';

const PREFIX    = 'hm:plan:';
const INDEX_KEY = 'hm:index';

export interface PlanMeta {
  id: string;
  name: string;
  savedAt: number;
}

export function listPlans(): PlanMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as PlanMeta[];
  } catch {
    return [];
  }
}

export function savePlan(plan: Plan): void {
  const meta: PlanMeta = { id: plan.id, name: plan.name, savedAt: Date.now() };
  localStorage.setItem(PREFIX + plan.id, JSON.stringify(plan));

  const index = listPlans();
  const i = index.findIndex((m) => m.id === plan.id);
  if (i >= 0) index[i] = meta;
  else index.unshift(meta);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function loadPlan(id: string): Plan | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as Plan) : null;
  } catch {
    return null;
  }
}

export function deletePlan(id: string): void {
  localStorage.removeItem(PREFIX + id);
  const index = listPlans().filter((m) => m.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}
