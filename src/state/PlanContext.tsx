/**
 * PlanContext — the committed document.
 *
 * Holds the `Plan` plus an undo/redo history of Plan snapshots. Per CLAUDE.md,
 * this changes ONLY on discrete commits (finishing a wall, ending a drag,
 * deleting). High-frequency transient state (rubber-band wall, in-progress drag)
 * must NOT live here — keep it in component refs/local state and call `commit`
 * on mouseup.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Plan } from '../model/types';
import { createInitialPlan } from '../model/planEdits';

/** A pure transition from the current plan to the next. */
export type PlanProducer = (current: Plan) => Plan;

interface PlanContextValue {
  plan: Plan;
  /**
   * Commit a new plan (or a producer of one) as a single undoable step.
   * A no-op producer (returns the same reference) is ignored so accidental
   * commits don't pollute the undo stack.
   */
  commit: (next: Plan | PlanProducer) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Replace the whole document and clear history (e.g. load / new). */
  reset: (plan: Plan) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

const MAX_HISTORY = 100;

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<Plan>(() => createInitialPlan());
  const past = useRef<Plan[]>([]);
  const future = useRef<Plan[]>([]);
  // Drives re-render when only the history (canUndo/canRedo) changes.
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  const commit = useCallback(
    (next: Plan | PlanProducer) => {
      setPlan((current) => {
        const resolved =
          typeof next === 'function' ? (next as PlanProducer)(current) : next;
        if (resolved === current) return current; // no-op, skip history
        past.current.push(current);
        if (past.current.length > MAX_HISTORY) past.current.shift();
        future.current = [];
        return resolved;
      });
      forceRender();
    },
    [forceRender],
  );

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setPlan((current) => {
      const prev = past.current.pop()!;
      future.current.push(current);
      return prev;
    });
    forceRender();
  }, [forceRender]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPlan((current) => {
      const next = future.current.pop()!;
      past.current.push(current);
      return next;
    });
    forceRender();
  }, [forceRender]);

  const reset = useCallback(
    (next: Plan) => {
      past.current = [];
      future.current = [];
      setPlan(next);
      forceRender();
    },
    [forceRender],
  );

  const value = useMemo<PlanContextValue>(
    () => ({
      plan,
      commit,
      undo,
      redo,
      reset,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    }),
    [plan, commit, undo, redo, reset],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within a PlanProvider');
  return ctx;
}
