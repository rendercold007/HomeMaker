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
  useReducer,
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

/**
 * Undo history as past / present / future. Kept in a single reducer so every
 * transition is a PURE, non-mutating function of the previous state — which is
 * what makes it safe under React.StrictMode's double-invocation of reducers.
 * (The previous ref-mutating version popped history twice per undo in dev,
 * eventually yielding an undefined plan and crashing the editor.)
 */
interface History {
  past: Plan[];
  present: Plan;
  future: Plan[];
}

type HistoryAction =
  | { type: 'commit'; next: Plan | PlanProducer }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; plan: Plan };

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'commit': {
      const resolved =
        typeof action.next === 'function'
          ? (action.next as PlanProducer)(state.present)
          : action.next;
      if (resolved === state.present) return state; // no-op, skip history
      const past = [...state.past, state.present];
      if (past.length > MAX_HISTORY) past.shift();
      return { past, present: resolved, future: [] };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    case 'reset':
      return { past: [], present: action.plan, future: [] };
  }
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    historyReducer,
    undefined,
    (): History => ({ past: [], present: createInitialPlan(), future: [] }),
  );

  const commit = useCallback(
    (next: Plan | PlanProducer) => dispatch({ type: 'commit', next }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((plan: Plan) => dispatch({ type: 'reset', plan }), []);

  const value = useMemo<PlanContextValue>(
    () => ({
      plan: state.present,
      commit,
      undo,
      redo,
      reset,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, commit, undo, redo, reset],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within a PlanProvider');
  return ctx;
}
