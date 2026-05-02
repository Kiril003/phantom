/**
 * AgentTimeline — vertical, time-ordered log of recent agent activity.
 *
 * Phase 21 redesign — filter bar + temporal fade.
 *
 * Sources (live, no mocks):
 *   - agentStore.recentActions  → action.start / action.completed
 *   - agentStore.observations   → result / error / reflection
 *   - agentStore.reflections    → reflection verdicts
 *
 * Features:
 *   - Three streams merged + sorted by timestamp, newest pinned at top.
 *   - Filter chips: All / Actions / Observations / Reflections — multi-
 *     select, persisted in component state. The header shows the live
 *     count of filtered-out entries.
 *   - Temporal fade: each entry's opacity ramps down with age — fresh
 *     events ride at full strength, older ones recede so the eye lands on
 *     "now". Cap softened to MAX_KEPT = 200 (well above the prior 12) so
 *     scrolling reveals real history; older than that drops off.
 *   - "Live" pulse indicator on the header when entries are arriving
 *     (latest entry < 5s old).
 *   - Reduced-motion: skips the live pulse + transitions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Brain,
  CheckCircle2,
  Loader2,
  Filter,
} from 'lucide-react';
import type {
  AgentObservation,
  AgentPlanStep,
  AgentReflectionResult,
} from '@shared/types';

export const MAX_KEPT = 200;
const LIVE_WINDOW_MS = 5_000;
const FADE_FULL_MS = 30_000;
const FADE_FLOOR_MS = 15 * 60_000;
const MIN_OPACITY = 0.45;

type RecentAction = AgentPlanStep & {
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
};

type EntryKind = 'action' | 'observation' | 'reflection';

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

/** Opacity ramp — fresh entries 1.0, old entries floor at MIN_OPACITY. */
function ageOpacity(now: number, ts: number): number {
  if (ts === 0) return 0.7; // unknown timestamps stay slightly muted
  const age = Math.max(0, now - ts);
  if (age < FADE_FULL_MS) return 1;
  if (age >= FADE_FLOOR_MS) return MIN_OPACITY;
  // linear ramp 1.0 → MIN_OPACITY between FADE_FULL_MS and FADE_FLOOR_MS
  const t = (age - FADE_FULL_MS) / (FADE_FLOOR_MS - FADE_FULL_MS);
  return 1 - t * (1 - MIN_OPACITY);
}

export function AgentTimeline({ recentActions, observations, reflections }: Props) {
  // Filter state — all on by default. Toggling a chip removes that kind.
  const [enabled, setEnabled] = useState<Record<EntryKind, boolean>>({
    action: true,
    observation: true,
    reflection: true,
  });

  // "now" tick used for the temporal fade. Update every 15s — cheap, and the
  // ramp is gradual enough that finer ticks add no signal.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const allEntries = useMemo<Entry[]>(() => {
    const merged: Entry[] = [];
    recentActions.forEach((a) =>
      merged.push({ kind: 'action', ts: safeTs(a.ts), idx: a.step_idx, step: a }),
    );
    observations.forEach((o, i) =>
      merged.push({ kind: 'observation', ts: safeTs(o.ts), idx: i, obs: o }),
    );
    const synthBase = Date.now();
    reflections.forEach((r, i) =>
      merged.push({
        kind: 'reflection',
        ts: synthBase - (reflections.length - i) * 250,
        idx: i,
        ref: r,
      }),
    );
    merged.sort((a, b) => b.ts - a.ts);
    return merged.slice(0, MAX_KEPT);
  }, [recentActions, observations, reflections]);

  const visibleEntries = useMemo(
    () => allEntries.filter((e) => enabled[e.kind]),
    [allEntries, enabled],
  );

  const counts = useMemo(() => {
    const c: Record<EntryKind, number> = { action: 0, observation: 0, reflection: 0 };
    for (const e of allEntries) c[e.kind] += 1;
    return c;
  }, [allEntries]);

  const hiddenCount = allEntries.length - visibleEntries.length;
  const live =
    allEntries.length > 0 &&
    Date.now() - allEntries[0].ts < LIVE_WINDOW_MS &&
    !reducedMotion;

  // Auto-stick to top when the newest entry changes — but only if the user
  // hasn't scrolled away. Reading scrollTop on the list element keeps the
  // affordance intuitive: pull down to read history, jump back up to follow.
  const listRef = useRef<HTMLOListElement | null>(null);
  const lastTopRef = useRef<number>(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const newest = allEntries[0]?.ts ?? 0;
    if (newest === lastTopRef.current) return;
    lastTopRef.current = newest;
    if (el.scrollTop < 24) el.scrollTop = 0;
  }, [allEntries]);

  const toggle = (k: EntryKind) =>
    setEnabled((prev) => ({ ...prev, [k]: !prev[k] }));

  if (allEntries.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="agent-timeline">
        <Header live={false} hiddenCount={0} counts={counts} enabled={enabled} onToggle={toggle} />
        <div
          className="flex flex-col items-center justify-center flex-1"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
          data-testid="agent-timeline-empty"
        >
          <Activity size={20} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: 6 }} />
          <span style={{ letterSpacing: 'var(--tracking-wider)', fontFamily: 'var(--font-mono)' }}>
            Timeline idle
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="agent-timeline">
      <Header
        live={live}
        hiddenCount={hiddenCount}
        counts={counts}
        enabled={enabled}
        onToggle={toggle}
      />
      <ol
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 list-none pr-1"
        style={{ paddingLeft: 0 }}
        data-testid="agent-timeline-list"
      >
        {visibleEntries.map((e) => (
          <TimelineRow
            key={`${e.kind}-${e.idx}-${e.ts}`}
            entry={e}
            opacity={ageOpacity(now, e.ts)}
          />
        ))}
        {visibleEntries.length === 0 && (
          <li
            style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              padding: '12px 8px',
              textAlign: 'center',
            }}
          >
            All entry kinds filtered — toggle a chip to see history.
          </li>
        )}
      </ol>
    </div>
  );
}

function Header({
  live,
  hiddenCount,
  counts,
  enabled,
  onToggle,
}: {
  live: boolean;
  hiddenCount: number;
  counts: Record<EntryKind, number>;
  enabled: Record<EntryKind, boolean>;
  onToggle: (k: EntryKind) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 mb-2 px-1" data-testid="agent-timeline-header">
      <div
        className="flex items-center gap-2"
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
        {live && (
          <span
            className="font-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--signal-ok, #16a34a) 18%, transparent)',
              color: 'var(--signal-ok, #16a34a)',
              fontSize: 'var(--fs-xxs, 10px)',
              fontWeight: 700,
              letterSpacing: '0.16em',
            }}
            data-testid="timeline-live-badge"
          >
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: 999,
                background: 'var(--signal-ok, #16a34a)',
                animation: 'phantom-pulse 1s ease-in-out infinite',
              }}
            />
            LIVE
          </span>
        )}
        <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>
          {hiddenCount > 0 ? `+${hiddenCount} hidden` : `${counts.action + counts.observation + counts.reflection}`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Filter size={10} color="var(--ink-muted)" strokeWidth={2} />
        <FilterChip
          label="actions"
          count={counts.action}
          on={enabled.action}
          onClick={() => onToggle('action')}
        />
        <FilterChip
          label="obs"
          count={counts.observation}
          on={enabled.observation}
          onClick={() => onToggle('observation')}
        />
        <FilterChip
          label="reflect"
          count={counts.reflection}
          on={enabled.reflection}
          onClick={() => onToggle('reflection')}
        />
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`timeline-filter-${label}`}
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        minHeight: 22,
        borderRadius: 999,
        border: on
          ? '1px solid color-mix(in srgb, var(--primary, #f4af25) 50%, transparent)'
          : '1px solid rgba(0,0,0,0.10)',
        background: on
          ? 'color-mix(in srgb, var(--primary, #f4af25) 22%, transparent)'
          : 'rgba(255,255,255,0.45)',
        color: on ? 'var(--primary-shadow, #8a5e0a)' : 'var(--ink-muted)',
        fontSize: 'var(--fs-xxs, 10px)',
        fontWeight: 700,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 'var(--fs-xxs, 10px)',
          opacity: 0.7,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function TimelineRow({ entry, opacity }: { entry: Entry; opacity: number }) {
  const meta = rowMeta(entry);
  return (
    <li
      data-testid={`timeline-row-${entry.kind}`}
      data-age-opacity={opacity.toFixed(2)}
      className="flex items-start gap-2 px-2 py-1.5"
      style={{
        minHeight: 44,
        borderRadius: 10,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        listStyle: 'none',
        opacity,
        transition: 'opacity 320ms ease',
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
