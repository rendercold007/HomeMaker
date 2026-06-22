/**
 * ToolContext — active tool and grid settings.
 *
 * Kept separate from PlanContext so switching tools never re-renders the canvas
 * geometry, and vice versa.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Tool = 'select' | 'wall';

export interface GridSettings {
  /** Grid spacing in world cm. */
  sizeCm: number;
  /** Whether to draw the grid. */
  visible: boolean;
  /** Whether snapping to the grid is enabled. */
  snap: boolean;
}

interface ToolContextValue {
  tool: Tool;
  setTool: (t: Tool) => void;
  grid: GridSettings;
  setGrid: (next: Partial<GridSettings>) => void;
}

const DEFAULT_GRID: GridSettings = { sizeCm: 30, visible: true, snap: true };

const ToolContext = createContext<ToolContextValue | null>(null);

export function ToolProvider({ children }: { children: ReactNode }) {
  const [tool, setTool] = useState<Tool>('select');
  const [grid, setGridState] = useState<GridSettings>(DEFAULT_GRID);

  const setGrid = useCallback((next: Partial<GridSettings>) => {
    setGridState((g) => ({ ...g, ...next }));
  }, []);

  const value = useMemo<ToolContextValue>(
    () => ({ tool, setTool, grid, setGrid }),
    [tool, grid, setGrid],
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
}

export function useTool(): ToolContextValue {
  const ctx = useContext(ToolContext);
  if (!ctx) throw new Error('useTool must be used within a ToolProvider');
  return ctx;
}
