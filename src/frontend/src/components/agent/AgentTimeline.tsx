/**
 * AgentTimeline — vertical, time-ordered log of recent agent activity.
 *
 * Sunrise redesign (phase-5-R1-FE-OPERATOR-1).
 *
 * Sources (live, no mocks):
 *   - agentStore.recentActions  → action.start / action.completed
 *   - agentStore.observations   → result / error / reflection
 *   - agentStore.reflections    → reflection verdicts
 *
 * The three streams are merged + sorted by timestamp. The newest entry is
 * pinned at the top. The list is capped to MAX_ENTRIES so the layout never
 * pushes off-screen on the 1024×600 panel.
 */
import { useMemo } from 'react';
import { Activity, AlertCircle, Brain, CheckCircle2, Loader2 } from 'lucide-react';
import type {
  AgentObservation,
  AgentPlanStep,
  AgentReflectionResult,
} from '@shared/types';

export const MAX_ENTRIES = 12;

type RecentAction = AgentPlanStep & {
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
};

type Entry =
  | { kind: 'action'; ts: number; idx: number; step: RecentAction }
  | { kind: 'observation'; ts: number; idx: number; obs: AgentObservation }
  | { kind: 'reflection'; ts: number; idx: number; ref: AgentReflectionResult };

interface Props {
  recentActions: RecentAction[];
  observations: AgentObservation[];
  reflections: AgentReflectionResult[];
}

function clock(iso: string | undefined | number): string {
  if (iso === undefined || iso === null) return '--:--';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function safeTs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function AgentTimeline({ recentActions, observations, reflections }: Props) {
  const entries = useMemo<Entry[]>(() => {
    const merged: Entry[] = [];
    recentActions.forEach((a) =>
      merged.push({ kind: 'action', ts: safeTs(a.ts), idx: a.step_idx, step: a }),
    );
    observations.forEach((o, i) =>
      merged.push({ kind: 'observation', ts: safeTs(o.ts), idx: i, obs: o }),
    );
    // Reflections don't carry a per-result timestamp, so we order them by
    // arrival (array index → synthetic ts based on now - offset). This keeps
    // them visually grouped at the bottom of recent activity, not the top.
    const now = Date.now();
    reflections.forEach((r, i) =>
      merged.push({
        kind: 'reflection',
        ts: now - (reflections.length - i) * 250,
        idx: i,
        ref: r,
      }),
    );
    merged.sort((a, b) => b.ts - a.ts);
    return merged.slice(0, MAX_ENTRIES);
  }, [recentActions, observations, reflections]);

  if (entries.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
        data-testid="agent-timeline-empty"
      >
        <Activity size={20} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: 6 }} />
        <span style={{ letterSpacing: 'var(--tracking-wider)', fontFamily: 'var(--font-mono)' }}>
          Timeline idle
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="agent-timeline">
      <div
        className="flex items-center gap-2 mb-2 px-1"
        style={{
          color: 'var(--primary-shadow, #8a5e0a)',
          fontSize: 'var(--fs-xxs, 11px)',
          fontWeight: 700,
          letterSpacing: 'var(--tracking-wider)',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <Activity size={12} strokeWidth={2} />
        <span>Timeline</span>
        <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>
          {entries.length} event{entries.length === 1 ? '' : 's'}
        </span>
      </div>
      <ol
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 list-none pr-1"
        style={{ paddingLeft: 0 }}
      >
        {entries.map((e) => (
          <TimelineRow key={`${e.kind}-${e.idx}-${e.ts}`} entry={e} />
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({ entry }: { entry: Entry }) {
  const meta = rowMeta(entry);
  return (
    <li
      data-testid={`timeline-row-${entry.kind}`}
      className="flex items-start gap-2 px-2 py-1.5"
      style={{
        minHeight: 44,
        borderRadius: 10,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        listStyle: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.5)',
          color: meta.tone,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-mono"
            style={{
              fontSize: 'var(--fs-xxs, 11px)',
              fontWeight: 600,
              color: 'var(--ink-muted)',
              flexShrink: 0,
            }}
          >
            {meta.time}
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: 'var(--fs-xxs, 11px)',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'color-mix(in srgb, var(--primary, #f4af25) 16%, transparent)',
              color: 'var(--primary-shadow, #8a5e0a)',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {meta.tag}
          </span>
        </div>
        <div
          className="truncate"
          style={{
            color: 'var(--ink-secondary)',
            fontSize: 'var(--fs-xs)',
            marginTop: 2,
          }}
          title={meta.text}
        >
          {meta.text}
        </div>
      </div>
    </li>
  );
}

function rowMeta(entry: Entry): {
  icon: JSX.Element;
  bg: string;
  border: string;
  tone: string;
  tag: string;
  text: string;
  time: string;
} {
  if (entry.kind === 'action') {
    const ok = entry.step.result?.ok;
    const pending = entry.step.result === undefined;
    const tone = pending
      ? 'var(--primary, #f4af25)'
      : ok
        ? 'var(--signal-ok, #16a34a)'
        : 'var(--signal-alert, #ef4444)';
    const icon = pending ? (
      <Loader2 size={14} className="animate-spin" />
    ) : ok ? (
      <CheckCircle2 size={14} />
    ) : (
      <AlertCircle size={14} />
    );
    return {
      icon,
      bg: pending
        ? 'color-mix(in srgb, var(--primary, #f4af25) 10%, transparent)'
        : 'rgba(255,255,255,0.45)',
      border: 'rgba(255,255,255,0.55)',
      tone,
      tag: entry.step.action,
      text: entry.step.intent || '—',
      time: clock(entry.step.ts),
    };
  }
  if (entry.kind === 'observation') {
    const isError = entry.obs.type === 'error';
    return {
      icon: isError ? <AlertCircle size={14} /> : <Activity size={14} />,
      bg: isError
        ? 'color-mix(in srgb, var(--signal-alert, #ef4444) 8%, transparent)'
        : 'rgba(255,255,255,0.45)',
      border: isError
        ? 'color-mix(in srgb, var(--signal-alert, #ef4444) 24%, transparent)'
        : 'rgba(255,255,255,0.55)',
      tone: isError ? 'var(--signal-alert, #ef4444)' : 'var(--signal-info, #2563eb)',
      tag: entry.obs.type,
      text: entry.obs.content || entry.obs.source,
      time: clock(entry.obs.ts),
    };
  }
  // reflection
  return {
    icon: <Brain size={14} />,
    bg: 'color-mix(in srgb, var(--primary, #f4af25) 10%, transparent)',
    border: 'color-mix(in srgb, var(--primary, #f4af25) 28%, transparent)',
    tone: 'var(--primary-deep, #b07a10)',
    tag: entry.ref.verdict,
    text: entry.ref.summary || entry.ref.recommendations || 'reflection',
    time: clock(undefined),
  };
}
