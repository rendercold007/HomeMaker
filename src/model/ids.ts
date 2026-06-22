/**
 * ID generation. Centralized so tests can swap in a deterministic generator.
 */
import type { ID } from './types';

/** Default generator — uses the platform UUID. */
export function newId(): ID {
  // crypto.randomUUID exists in modern browsers and Node 19+.
  return crypto.randomUUID();
}
