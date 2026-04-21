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
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { wsClient } from '../../services/websocket';

const MAX_EVENTS = 50;

type MonologueKind = 'plan' | 'reflection' | 'proactive' | 'emotion_shift';

interface MonologueEvent {
  kind: MonologueKind;
  source: string;
  monologue: Record<string, unknown>;
  ts: string;
  task_id: string | null;
}

const KIND_COLORS: Record<MonologueKind, string> = {
  plan: 'var(--signal-info)',
  reflection: 'var(--ink-primary)',
  proactive: 'var(--signal-warn)',
  emotion_shift: 'var(--signal-success, #4ade80)',
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
  const [open, setOpen] = useState<boolean>(true);
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

  const count = useMemo(() => events.length, [events]);

  return (
    <div
      className="flex flex-col"
      style={{
        borderTop: '1px solid var(--line-subtle)',
        background: 'var(--glass-subtle)',
      }}
      data-testid="inner-monologue-stream"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-5 py-2"
        style={{
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: 'var(--tracking-wider)',
          fontFamily: 'monospace',
        }}
        aria-expanded={open}
        aria-label="Toggle inner monologue stream"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span>INNER MONOLOGUE</span>
        <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>
          {count} event{count === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div
          className="px-5 py-2 flex flex-col gap-1 overflow-y-auto"
          style={{ maxHeight: 240 }}
          role="log"
          aria-live="polite"
        >
          {events.length === 0 ? (
            <div
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--fs-xs)',
                fontStyle: 'italic',
              }}
            >
              No events yet. PHANTOM will speak here as it plans, reflects, or decides.
            </div>
          ) : (
            events.slice().reverse().map((ev, i) => {
              const idx = events.length - 1 - i;
              const isOpen = expanded === idx;
              return (
                <div
                  key={`${ev.ts}-${idx}`}
                  className="flex flex-col gap-0.5"
                  style={{ fontSize: 'var(--fs-xs)' }}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : idx)}
                    className="flex items-center gap-2 text-left"
                    style={{ color: 'var(--ink-primary)' }}
                    data-testid="monologue-entry"
                  >
                    <span
                      className="font-mono"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {formatClock(ev.ts)}
                    </span>
                    <span
                      className="font-mono uppercase"
                      style={{
                        color: KIND_COLORS[ev.kind] || 'var(--ink-primary)',
                        fontSize: 'var(--fs-xxs)',
                        letterSpacing: 'var(--tracking-wider)',
                      }}
                    >
                      {ev.kind}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {shortLabel(ev)}
                    </span>
                  </button>
                  {isOpen && (
                    <pre
                      className="px-2 py-1 font-mono"
                      style={{
                        background: 'var(--surface-base)',
                        borderRadius: 4,
                        fontSize: 'var(--fs-xxs)',
                        color: 'var(--ink-muted)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 180,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(ev.monologue, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
