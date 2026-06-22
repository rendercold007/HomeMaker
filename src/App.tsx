/**
 * App shell — Phase 4: AI generation + hands-on 2D editor.
 *
 * Left sidebar tabs between Generate (AI) and Furniture palette.
 * Right sidebar stacks InfoPanel above VastuPanel.
 */
import { useState } from 'react';
import { PlanProvider } from './state/PlanContext';
import { ToolProvider } from './state/ToolContext';
import { SelectionProvider } from './state/SelectionContext';
import { Toolbar } from './components/Toolbar/Toolbar';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { FurniturePalette } from './components/Panels/FurniturePalette';
import { InfoPanel } from './components/Panels/InfoPanel';
import { VastuPanel } from './components/Panels/VastuPanel';
import { GeneratePanel } from './components/Panels/GeneratePanel';

type LeftTab = 'generate' | 'furniture';

function LeftSidebar() {
  const [tab, setTab] = useState<LeftTab>('generate');

  return (
    <div className="flex flex-none flex-col border-r border-slate-200">
      {/* Tab strip */}
      <div className="flex border-b border-slate-200 bg-white text-xs">
        {(['generate', 'furniture'] as LeftTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1.5 font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'generate' ? 'AI' : 'Palette'}
          </button>
        ))}
      </div>
      {tab === 'generate' ? <GeneratePanel /> : <FurniturePalette />}
    </div>
  );
}

export default function App() {
  return (
    <PlanProvider>
      <ToolProvider>
        <SelectionProvider>
          <div className="flex h-screen w-screen flex-col bg-white text-slate-900">
            <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-2">
              <h1 className="text-base font-semibold">HomeMaker</h1>
              <span className="text-xs text-slate-400">Phase 4 · AI Generation</span>
            </header>
            <Toolbar />
            <div className="flex min-h-0 flex-1">
              <LeftSidebar />
              <main className="min-w-0 flex-1">
                <CanvasStage />
              </main>
              <div className="flex min-h-0 flex-col">
                <InfoPanel />
                <VastuPanel />
              </div>
            </div>
          </div>
        </SelectionProvider>
      </ToolProvider>
    </PlanProvider>
  );
}
