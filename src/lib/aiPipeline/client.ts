/**
 * Browser client for the auto-furnish endpoint. POSTs the room + prompt to the
 * Node gateway and returns the parsed placements.
 *
 * The endpoint is mocked in Phase 4 · step 1 (Vite dev middleware locally, a
 * Vercel function in production), but this call site is the real one and will
 * not change when the Python worker comes online behind the gateway.
 */
import type {
  AutoFurnishRequest,
  AutoFurnishResponse,
  GeneratePlanRequest,
  GeneratedPlan,
} from './contract';

export const AUTO_FURNISH_ENDPOINT = '/api/design/auto-furnish';
export const GENERATE_PLAN_ENDPOINT = '/api/design/generate-plan';

export async function requestAutoFurnish(
  req: AutoFurnishRequest,
  signal?: AbortSignal,
): Promise<AutoFurnishResponse> {
  const res = await fetch(AUTO_FURNISH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Auto-furnish failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as AutoFurnishResponse;
}

export async function requestGeneratePlan(
  req: GeneratePlanRequest,
  signal?: AbortSignal,
): Promise<GeneratedPlan> {
  const res = await fetch(GENERATE_PLAN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Plan generation failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GeneratedPlan;
}
