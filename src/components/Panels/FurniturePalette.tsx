/**
 * FurniturePalette — left sidebar listing furniture items for placement.
 *
 * Clicking an item activates the 'furniture' tool and sets the active type.
 * The active item stays highlighted so the user knows what's being placed.
 */
import { useTool } from '../../state/ToolContext';
import { FURNITURE_CATALOG } from '../../model/furniture';

export function FurniturePalette() {
  const { tool, setTool, activeFurnitureType, setActiveFurnitureType } = useTool();

  function activate(type: string) {
    setActiveFurnitureType(type);
    setTool('furniture');
  }

  function cancel() {
    setActiveFurnitureType(null);
    setTool('select');
  }

  return (
    <aside className="flex h-full w-44 flex-col gap-2 overflow-y-auto bg-slate-50 p-2 text-sm">
      <h2 className="font-semibold text-slate-700">Furniture</h2>

      {tool === 'furniture' && activeFurnitureType && (
        <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
          Click canvas to place
          <button
            type="button"
            onClick={cancel}
            className="ml-1 underline hover:text-blue-900"
          >
            (cancel)
          </button>
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {FURNITURE_CATALOG.map((def) => {
          const active = tool === 'furniture' && activeFurnitureType === def.type;
          return (
            <li key={def.type}>
              <button
                type="button"
                onClick={() => activate(def.type)}
                className={[
                  'w-full rounded px-2 py-1.5 text-left transition',
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-slate-300"
                    style={{ backgroundColor: active ? '#fff' : def.color }}
                  />
                  <span className="text-xs font-medium">{def.label}</span>
                </div>
                <div className="ml-5 text-xs opacity-60">
                  {def.widthCm}×{def.heightCm} cm
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
