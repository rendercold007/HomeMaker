/**
 * App shell — Phase 1: the hands-on 2D editor.
 *
 * Composes the three separate contexts (Plan / Tool / Selection — kept apart so
 * unrelated changes don't re-render the canvas) around the editor layout:
 * Toolbar on top, canvas in the center, info panel on the right.
 */
import { PlanProvider } from './state/PlanContext';
import { ToolProvider } from './state/ToolContext';
import { SelectionProvider } from './state/SelectionContext';
import { Toolbar } from './components/Toolbar/Toolbar';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { InfoPanel } from './components/Panels/InfoPanel';

export default function App() {
  return (
    <PlanProvider>
      <ToolProvider>
        <SelectionProvider>
          <div className="flex h-screen w-screen flex-col bg-white text-slate-900">
            <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-2">
              <h1 className="text-base font-semibold">HomeMaker</h1>
              <span className="text-xs text-slate-400">Phase 1 · 2D editor</span>
            </header>
            <Toolbar />
            <div className="flex min-h-0 flex-1">
              <main className="min-w-0 flex-1">
                <CanvasStage />
              </main>
              <InfoPanel />
            </div>
          </div>
        </SelectionProvider>
      </ToolProvider>
    </PlanProvider>
  );
}
