/**
 * Phase 9.4c audit G3 — live inner-monologue stream.
 *
 * Backend emits on `inner_monologue.stream` (agent/monologue_emitter.py)
 * but had no frontend consumer before 9.4c. This panel subscribes to the
 * channel and renders a rolling log of PHANTOM's thinking — plan steps,
 * reflections, proactive decisions, emotion shifts. Scope is deliberately
 * narrow: read-only, capped at MAX_EVENTS in memory, collapsible so the
 * operator can hide it when debugging something else.
 */
import { useEffect, useState } from 'react';
import { wsClient } from '../../../services/websocket';

const MAX_EVENTS = 100;

type MonologueKind = 'plan' | 'reflection' | 'proactive' | 'emotion_shift';

interface MonologueEvent {
  kind: MonologueKind;
  source: string;
  monologue: Record<string, unknown>;
  ts: string;
  task_id: string | null;
}

const KIND_COLORS: Record<MonologueKind, string> = {
  plan: '#06b6d4',      // cyan
  reflection: '#a3a3a3', // gray
  proactive: '#f59e0b',  // amber
  emotion_shift: '#10b981', // green
};

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function shortLabel(event: MonologueEvent): string {
  const m = event.monologue;
  if (typeof m.what_i_plan === 'string' && m.what_i_plan) return m.what_i_plan;
  if (typeof m.summary === 'string' && m.summary) return m.summary;
  if (typeof m.decision === 'string' && m.decision) return m.decision;
  if (typeof m.note === 'string' && m.note) return m.note;
  if (typeof m.what_i_see === 'string' && m.what_i_see) return m.what_i_see;
  return event.kind.toUpperCase();
}

export function InnerMonologueStream() {
  const [events, setEvents] = useState<MonologueEvent[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const off = wsClient.on('inner_monologue.stream', (msg) => {
      const data = msg.data as unknown as MonologueEvent;
      setEvents((prev) => {
        const next = prev.concat(data);
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    });
    return off;
  }, []);

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-black overflow-hidden font-mono"
      data-testid="inner-monologue-stream"
    >
      <div
        className="flex-1 px-3 py-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-none"
        role="log"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <div className="text-[10px] text-neutral-700 italic">
            [SYS_LOG] Listening for agent kernel events...
          </div>
        ) : (
          events.slice().reverse().map((ev, i) => {
            const idx = events.length - 1 - i;
            const isOpen = expanded === idx;
            return (
              <div
                key={`${ev.ts}-${idx}`}
                className="flex flex-col border-l border-white/[0.03] pl-2 mb-0.5"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : idx)}
                  className="flex items-start gap-2 text-left group"
                >
                  <span className="text-[9px] text-neutral-600 tabular shrink-0 mt-0.5">
                    {formatClock(ev.ts)}
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase shrink-0 mt-0.5"
                    style={{ color: KIND_COLORS[ev.kind] || 'inherit' }}
                  >
                    {ev.kind.slice(0, 4)}
                  </span>
                  <span className="text-[11px] text-neutral-400 leading-tight group-hover:text-white transition-colors">
                    {shortLabel(ev)}
                  </span>
                </button>
                {isOpen && (
                  <pre
                    className="mt-1 mb-1 px-2 py-1 bg-white/[0.03] rounded text-[10px] text-neutral-500 overflow-x-auto"
                  >
                    {JSON.stringify(ev.monologue, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
