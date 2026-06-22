import { useEffect, useRef, useState } from 'react';
import { usePlan } from '../../state/PlanContext';
import { assistPlan } from '../../ai/assist';

interface Message { role: 'user' | 'assistant' | 'error'; text: string }

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

const SUGGESTIONS = [
  'Add a pooja room in NE',
  'Make the master bedroom larger',
  'Add a bathroom near bedroom 2',
  'Swap kitchen and dining room',
];

export function ChatPanel() {
  const { plan, reset } = usePlan();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'I can edit your floor plan. Try: "add a bathroom near the kitchen" or "make the living room larger".' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const updated = await assistPlan(plan, text);
      reset(updated);
      setMessages((m) => [...m, { role: 'assistant', text: '✓ Plan updated successfully.' }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-600/30 text-purple-400">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xs font-semibold text-slate-200">AI Chat</h2>
          <p className="text-[10px] text-slate-600">Edit your plan in plain English</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white'
                : msg.role === 'error'
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : 'border border-white/5 text-slate-300'
            }`} style={msg.role === 'assistant' ? { background: 'rgba(255,255,255,0.05)' } : {}}>
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-white/5 px-3 py-2 text-xs text-slate-500" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <Spinner /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={loading}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400 transition hover:border-indigo-500/50 hover:text-indigo-400 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-white/5 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Describe a change… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-indigo-600 text-white shadow shadow-indigo-500/30 transition hover:bg-indigo-500 active:scale-95 disabled:opacity-40"
          >
            {loading ? <Spinner /> : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3.105 3.105a.75.75 0 0 1 .95-.087l13 8a.75.75 0 0 1 0 1.264l-13 8a.75.75 0 0 1-1.07-.822l1.5-6L4.5 10l-.015-.06-1.5-6a.75.75 0 0 1 .12-.835z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
