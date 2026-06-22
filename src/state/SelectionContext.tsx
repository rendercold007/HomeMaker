/**
 * SelectionContext — the current selection.
 *
 * Separate context so selecting/deselecting doesn't re-render unrelated tool
 * UI. A selection targets either a wall or a point (Phase 1).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ID } from '../model/types';

export type SelectionKind = 'wall' | 'point';

export interface Selection {
  kind: SelectionKind;
  id: ID;
}

interface SelectionContextValue {
  selection: Selection | null;
  select: (sel: Selection) => void;
  clear: () => void;
  isSelected: (kind: SelectionKind, id: ID) => boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const select = useCallback((sel: Selection) => setSelection(sel), []);
  const clear = useCallback(() => setSelection(null), []);
  const isSelected = useCallback(
    (kind: SelectionKind, id: ID) =>
      selection !== null && selection.kind === kind && selection.id === id,
    [selection],
  );

  const value = useMemo<SelectionContextValue>(
    () => ({ selection, select, clear, isSelected }),
    [selection, select, clear, isSelected],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within a SelectionProvider');
  return ctx;
}
