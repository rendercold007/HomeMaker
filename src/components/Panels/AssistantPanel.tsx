/**
 * AssistantPanel — the chat shell (Phase 4 · chat → editable plan).
 *
 * One conversation, not a row of buttons. The first message GENERATES a whole
 * floor plan; after that, every message EDITS the existing plan by chat ("make
 * the living room bigger", "add a study", "remove the coffee table"). The panel
 * auto-routes on whether the active floor has rooms yet, so the user never picks
 * a mode — they just talk.
 *
 * Same boundary rule as the rest of the AI pipeline (CLAUDE.md → "The AI
 * backend"): every worker result re-enters through the store as ONE commit, so
 * 2D, 3D, and undo/redo update from the same Plan. Generate replaces the floor;
 * edit folds a patch (local ops, or a structural `replaceFloor` re-flow) as a
 * single undo step. Recent (prompt, summary) turns are replayed to the worker so
 * follow-ups like "make it bigger" / "the other bedroom" resolve. The worker is
 * required (generate + edit); see src/lib/aiPipeline/client.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { usePlan, useActiveFloor } from '../../state/store';
import { requestEditPlan, requestGeneratePlan } from '../../lib/aiPipeline/client';
import { applyGeneratedPlan } from '../../lib/aiPipeline/applyPlan';
import { applyEditPatch } from '../../lib/aiPipeline/applyEditPatch';
import type { EditPlanRequest, EditTurn, GeneratePlanRequest } from '../../lib/aiPipeline/contract';
import { serializeFloor } from '../../lib/aiPipeline/contract';

// How many recent turns to send back to the worker for "make it bigger"-style
// reference resolution. The worker caps too; this just bounds the payload.
const MAX_HISTORY = 8;

/** A line in the conversation. `warnings` hang off the assistant's reply. */
type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; warnings?: string[]; tone?: 'normal' | 'error' };

export function AssistantPanel() {
  const { plan, commit } = usePlan();
  const { activeFloorId } = useActiveFloor();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // The edit conversation so far (prompt + the recap we got back), replayed to
  // the worker so follow-ups resolve against prior turns. Reset on a fresh plan.
  const [history, setHistory] = useState<EditTurn[]>([]);

  const activeFloor = plan.floors.find((f) => f.id === activeFloorId);
  // First message generates; once rooms exist, every message edits.
  const hasPlan = (activeFloor?.rooms.length ?? 0) > 0;

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    const editing = hasPlan && !!activeFloor; // snapshot before the commit flips it

    try {
      if (editing) {
        const req: EditPlanRequest = {
          prompt: text,
          floor: serializeFloor(activeFloor!),
          history: history.slice(-MAX_HISTORY),
        };
        const res = await requestEditPlan(req);
        // Only commit when there's an actual change — a clarifying question or a
        // "couldn't do that" reply has an empty patch and must not push an undo step.
        if (res.patch.length > 0) {
          commit((current) => applyEditPatch(current, activeFloorId, res));
        }
        setMessages((m) => [...m, { role: 'assistant', text: res.summary, warnings: res.warnings }]);
        setHistory((h) => [...h, { prompt: text, summary: res.summary }]);
      } else {
        const req: GeneratePlanRequest = {
          prompt: text,
          plot: { widthCm: plan.plot.widthCm, depthCm: plan.plot.depthCm },
        };
        const res = await requestGeneratePlan(req);
        commit((current) => applyGeneratedPlan(current, activeFloorId, res));
        setHistory([]); // a fresh plan starts a fresh edit conversation
        const n = res.plan.rooms.length;
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text:
              `Here's your floor plan — ${n} ${n === 1 ? 'room' : 'rooms'}. ` +
              'Want to customize it? Tell me what to change — e.g. "make the living ' +
              'room bigger", "add a study", or "remove the coffee table".',
          },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setMessages((m) => [
        ...m,
        { role: 'assistant', tone: 'error', text: `Sorry — ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <aside className="flex h-full w-full flex-col text-sm text-slate-200">
      <div className="border-b border-white/5 p-3">
        <h2 className="font-semibold text-slate-100">AI Assistant</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
          {hasPlan
            ? 'Tell me what to change — and I’ll edit the plan live.'
            : 'Describe a home and I’ll draw the floor plan. Then we customize it together.'}
        </p>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="space-y-2 text-[11px] leading-snug text-slate-500">
            <p>Try something like:</p>
            <ul className="space-y-1">
              {['A 2BHK apartment with a big living room', 'A studio with a kitchen and bathroom'].map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => setInput(ex)}
                    className="rounded border border-white/10 bg-white/5 px-2 py-1 text-left text-slate-300 transition hover:bg-white/10"
                  >
                    &ldquo;{ex}&rdquo;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg rounded-br-sm bg-indigo-600 px-2.5 py-1.5 text-xs text-white">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-1">
              <p
                className={`max-w-[90%] rounded-lg rounded-bl-sm px-2.5 py-1.5 text-xs ${
                  m.tone === 'error'
                    ? 'bg-red-500/10 text-red-300'
                    : 'bg-white/5 text-slate-200'
                }`}
              >
                {m.text}
              </p>
              {m.warnings?.map((w, k) => (
                <p key={k} className="max-w-[90%] px-1 text-[11px] text-amber-300/90">
                  ⚠ {w}
                </p>
              ))}
            </div>
          ),
        )}

        {loading && (
          <div className="flex">
            <p className="rounded-lg rounded-bl-sm bg-white/5 px-2.5 py-1.5 text-xs text-slate-400">
              {hasPlan ? 'Editing…' : 'Drawing your plan…'}
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-white/5 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={hasPlan ? 'e.g. add a window to the kitchen' : 'e.g. A 2BHK apartment'}
          className="w-full resize-none rounded-md border border-white/10 bg-white/5 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || input.trim().length === 0}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Working…' : hasPlan ? 'Send' : '🏠 Generate floor plan'}
        </button>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Enter to send · Shift+Enter for a new line. Each change is one undo step — switch to 3D to walk it.
        </p>
      </div>
    </aside>
  );
}
