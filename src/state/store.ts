/**
 * The unified Zustand store — the single source of truth for the editor.
 *
 * Konva (2D) and three.js (3D) never talk to each other directly; both read and
 * write this store. It holds three concerns that used to live in separate React
 * contexts:
 *   - the committed `Plan` document, with an undo/redo history of snapshots;
 *   - the active tool and grid settings;
 *   - the current selection.
 *
 * High-frequency transient state (live mouse position, the rubber-band wall, the
 * in-progress drag) must NOT live here — keep it in component refs/local state
 * and call `commit` only on mouseup, exactly as before. Committing on every drag
 * frame would push a snapshot per frame onto the undo stack and thrash the store.
 *
 * Consumers use the `usePlan` / `useTool` / `useSelection` hooks below, which
 * select a narrow slice via `useShallow` so unrelated changes don't re-render.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useCallback } from 'react';
import type { ID, Plan } from '../model/types';
import { createInitialPlan } from '../model/planEdits';

/* ------------------------------- Types --------------------------------- */

/** A pure transition from the current plan to the next. */
export type PlanProducer = (current: Plan) => Plan;

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture';

export interface GridSettings {
  /** Grid spacing in world cm. */
  sizeCm: number;
  /** Whether to draw the grid. */
  visible: boolean;
  /** Whether snapping to the grid is enabled. */
  snap: boolean;
}

export type SelectionKind = 'wall' | 'point' | 'opening' | 'furniture';

export interface Selection {
  kind: SelectionKind;
  id: ID;
}

/* ------------------------------ Store ---------------------------------- */

const MAX_HISTORY = 100;
const DEFAULT_GRID: GridSettings = { sizeCm: 30, visible: true, snap: true };

interface StoreState {
  // Plan history (past / present / future).
  past: Plan[];
  present: Plan;
  future: Plan[];
  // Tool + grid.
  tool: Tool;
  grid: GridSettings;
  activeFurnitureType: string | null;
  // Selection.
  selection: Selection | null;

  // Plan actions.
  commit: (next: Plan | PlanProducer) => void;
  undo: () => void;
  redo: () => void;
  reset: (plan: Plan) => void;

  // Tool actions.
  setTool: (t: Tool) => void;
  setGrid: (next: Partial<GridSettings>) => void;
  setActiveFurnitureType: (type: string | null) => void;

  // Selection actions.
  select: (sel: Selection) => void;
  clearSelection: () => void;
}

export const useStore = create<StoreState>((set) => ({
  past: [],
  present: createInitialPlan(),
  future: [],
  tool: 'select',
  grid: DEFAULT_GRID,
  activeFurnitureType: null,
  selection: null,

  commit: (next) =>
    set((s) => {
      const resolved = typeof next === 'function' ? next(s.present) : next;
      if (resolved === s.present) return {}; // no-op, skip history
      const past = [...s.past, s.present];
      if (past.length > MAX_HISTORY) past.shift();
      return { past, present: resolved, future: [] };
    }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1]!;
      return {
        past: s.past.slice(0, -1),
        present: prev,
        future: [s.present, ...s.future],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0]!;
      return {
        past: [...s.past, s.present],
        present: next,
        future: s.future.slice(1),
      };
    }),

  reset: (plan) => set({ past: [], present: plan, future: [] }),

  setTool: (tool) => set({ tool }),
  setGrid: (next) => set((s) => ({ grid: { ...s.grid, ...next } })),
  setActiveFurnitureType: (activeFurnitureType) => set({ activeFurnitureType }),

  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
}));

/* ------------------------------ Hooks ---------------------------------- */

export interface PlanSlice {
  plan: Plan;
  commit: (next: Plan | PlanProducer) => void;
  undo: () => void;
  redo: () => void;
  reset: (plan: Plan) => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** The committed document plus its undo/redo controls. */
export function usePlan(): PlanSlice {
  return useStore(
    useShallow((s) => ({
      plan: s.present,
      commit: s.commit,
      undo: s.undo,
      redo: s.redo,
      reset: s.reset,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
    })),
  );
}

export interface ToolSlice {
  tool: Tool;
  setTool: (t: Tool) => void;
  grid: GridSettings;
  setGrid: (next: Partial<GridSettings>) => void;
  activeFurnitureType: string | null;
  setActiveFurnitureType: (type: string | null) => void;
}

/** Active tool, grid settings, and the furniture type being placed. */
export function useTool(): ToolSlice {
  return useStore(
    useShallow((s) => ({
      tool: s.tool,
      setTool: s.setTool,
      grid: s.grid,
      setGrid: s.setGrid,
      activeFurnitureType: s.activeFurnitureType,
      setActiveFurnitureType: s.setActiveFurnitureType,
    })),
  );
}

export interface SelectionSlice {
  selection: Selection | null;
  select: (sel: Selection) => void;
  clear: () => void;
  isSelected: (kind: SelectionKind, id: ID) => boolean;
}

/** The current selection and helpers to change it. */
export function useSelection(): SelectionSlice {
  const { selection, select, clear } = useStore(
    useShallow((s) => ({
      selection: s.selection,
      select: s.select,
      clear: s.clearSelection,
    })),
  );
  const isSelected = useCallback(
    (kind: SelectionKind, id: ID) =>
      selection !== null && selection.kind === kind && selection.id === id,
    [selection],
  );
  return { selection, select, clear, isSelected };
}
