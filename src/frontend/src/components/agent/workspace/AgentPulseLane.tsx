/**
 * AgentPulseLane — phase-21-extend.
 *
 * One slim, always-visible row between the OperatorLayout hero and body
 * grids that consolidates every "what's happening RIGHT NOW" signal the
 * agent emits. Until this commit those signals were scattered:
 *
 *   • substate (thinking/acting/reflecting/...) — only on the StatusBar
 *     pill, easy to miss while staring at the plan tree
 *   • council activity — only the full CouncilStage overlay; nothing in
 *     the OperatorLayout hinted "council is debating right now"
 *   • quality_gate.* events — emitted, never rendered
 *   • last inner monologue line — InnerMonologueStream isn't mounted on
 *     OperatorLayout at all
 *
 * The lane is composed of self-collapsing chips. Each chip only appears
 * when its signal is live, so on idle the lane shrinks to ~28 px and
 * just shows substate=idle. Worst case (acting + council + quality_gate
 * + monologue) the chips reflow under the available 1024 px width with
 * `flex-wrap` — last chips truncate first via `min-w-0`.
 *
 * The colour vocabulary follows the rest of the operator surface:
 *   amber-warm = active / spinning
 *   coral-warm = blocker / strike
 *   green-warm = passed / regenerated
 *
 * Reduced-motion guard: every animation here uses `phantom-pulse`,
 * `phantom-shimmer-soft`, etc. — the global stylesheet already disables
 * those under `prefers-reduced-motion: reduce`, so this file doesn't
 * need its own guard.
 */
import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Gavel,
  Hourglass,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';

/* ─── Helpers ────────────────────────────────────────────────────────── */

const CHIP_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xxs, 11px)',
  fontWeight: 600,
  letterSpacing: 'var(--tracking-wider, 0.06em)',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const SUBSTATE_TONE: Record<
  string,
  { fg: string; bg: string; ring: string; icon: React.ReactNode; label: string }
> = {
  idle: {
    fg: 'var(--ink-muted)',
    bg: 'rgba(40,30,15,0.06)',
    ring: 'rgba(40,30,15,0.12)',
    icon: <Hourglass size={11} strokeWidth={2} />,
    label: 'IDLE',
  },
  thinking: {
    fg: '#8a5e0a',
    bg: 'color-mix(in srgb, #f4af25 16%, transparent)',
    ring: 'color-mix(in srgb, #f4af25 38%, transparent)',
    icon: <Sparkles size={11} strokeWidth={2} />,
    label: 'THINKING',
  },
  acting: {
    fg: '#7a4419',
    bg: 'color-mix(in srgb, #fb923c 16%, transparent)',
    ring: 'color-mix(in srgb, #fb923c 40%, transparent)',
    icon: <Activity size={11} strokeWidth={2.2} />,
    label: 'ACTING',
  },
  reflecting: {
    fg: '#6b4a82',
    bg: 'color-mix(in srgb, #a78bfa 16%, transparent)',
    ring: 'color-mix(in srgb, #a78bfa 40%, transparent)',
    icon: <Eye size={11} strokeWidth={2} />,
    label: 'REFLECTING',
  },
  waiting_user: {
    fg: '#9a3412',
    bg: 'color-mix(in srgb, #fb7185 18%, transparent)',
    ring: 'color-mix(in srgb, #fb7185 44%, transparent)',
    icon: <AlertTriangle size={11} strokeWidth={2.2} />,
    label: 'WAITING YOU',
  },
  paused: {
    fg: 'var(--ink-secondary)',
    bg: 'rgba(40,30,15,0.10)',
    ring: 'rgba(40,30,15,0.24)',
    icon: <Hourglass size={11} strokeWidth={2} />,
    label: 'PAUSED',
  },
};

const REFLECTION_FADE_MS = 8000;

/* ─── Component ──────────────────────────────────────────────────────── */

export function AgentPulseLane() {
  const substate = useAgentStore((s) => s.substate);
  const status = useAgentStore((s) => s.status);
  const reflections = useAgentStore((s) => s.reflections);
  const councilActive = useAgentStore((s) => s.councilActive);
  const councilStatements = useAgentStore((s) => s.councilStatements);
  const qualityGate = useAgentStore((s) => s.qualityGate);
  const promptToUser = useAgentStore((s) => s.promptToUser);
  const events = useAgentStore((s) => s.events);

  // Most recent reflection summary (the pulse-lane shows "just reflected:
  // X" for ~8 s then fades the chip away). We compare against `Date.now`
  // every render rather than via a timer because every WS event re-runs
  // the store and forces a re-render anyway.
  const lastReflection = useMemo(() => {
    if (reflections.length === 0) return null;
    const last = reflections[reflections.length - 1];
    if (!last) return null;
    const ts =
      (last as unknown as { ts?: number | string }).ts ??
      (last as unknown as { at?: number | string }).at;
    let parsed: number | null = null;
    if (typeof ts === 'number') parsed = ts;
    else if (typeof ts === 'string') {
      const n = Date.parse(ts);
      if (!Number.isNaN(n)) parsed = n;
    }
    if (parsed === null) return null;
    if (Date.now() - parsed > REFLECTION_FADE_MS) return null;
    return last;
  }, [reflections]);

  // Inner monologue last line (Phase 9.3b emits these on agent.stream as
  // payloads we already capture into events). We pull the most recent
  // one from the events tail rather than introducing a parallel store
  // subscription — keeps the source of truth single.
  const lastMonologue = useMemo<string | null>(() => {
    for (let i = events.length - 1; i >= Math.max(0, events.length - 30); i--) {
      const ev = events[i];
      if (ev.type === 'plan.step_created') {
        const step = ev.payload?.step as
          | {
              monologue?: { what_i_plan?: string; intent?: string; goal_alignment?: string };
            }
          | undefined;
        const line =
          step?.monologue?.what_i_plan ||
          step?.monologue?.intent ||
          step?.monologue?.goal_alignment;
        if (line) return String(line).trim();
      }
      if (ev.type === 'reflection.completed') {
        const summary = ev.payload?.summary;
        if (summary) return String(summary).trim();
      }
    }
    return null;
  }, [events]);

  const tone = SUBSTATE_TONE[substate] ?? SUBSTATE_TONE.idle;
  const isLive = status === 'running' || status === 'paused' || status === 'awaiting_user';

  // Compute "should show this lane at all" — when truly idle with no
  // monologue and no reflection, the lane collapses to a 4 px breath
  // so it doesn't waste 36 px of vertical real estate.
  const hasContent =
    isLive ||
    councilActive ||
    qualityGate?.active ||
    lastReflection !== null ||
    lastMonologue !== null;

  if (!hasContent) {
    return (
      <div
        aria-hidden
        style={{
          height: 4,
          marginTop: 4,
          marginBottom: 4,
          borderRadius: 4,
          background: 'rgba(40,30,15,0.04)',
        }}
      />
    );
  }

  return (
    <div
      data-testid="agent-pulse-lane"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '6px 12px',
        background: 'var(--glass-card, rgba(255,250,244,0.62))',
        border: '1px solid color-mix(in srgb, ' +
          tone.ring +
          ' 70%, var(--glass-border, rgba(255,255,255,0.55)))',
        borderRadius: 12,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        minHeight: 36,
      }}
    >
      {/* Substate chip — always present so the lane has an anchor. */}
      <span
        style={{
          ...CHIP_BASE,
          color: tone.fg,
          background: tone.bg,
          border: `1px solid ${tone.ring}`,
        }}
        title={`Agent substate: ${substate}`}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: tone.fg,
            animation: isLive ? 'phantom-pulse 1.1s ease-in-out infinite' : 'none',
          }}
        />
        {tone.icon}
        {tone.label}
      </span>

      {/* Quality gate chip — only when the gate is mid-cycle. */}
      {qualityGate?.active && (
        <QualityGateChip gate={qualityGate} />
      )}

      {/* Council chip — only when a round is mid-deliberation. */}
      {councilActive && (
        <span
          style={{
            ...CHIP_BASE,
            color: '#5b5183',
            background: 'color-mix(in srgb, #a78bfa 16%, transparent)',
            border: '1px solid color-mix(in srgb, #a78bfa 38%, transparent)',
          }}
          title="Council deliberation in progress"
        >
          <Gavel size={11} strokeWidth={2.2} />
          COUNCIL
          <span
            style={{
              opacity: 0.74,
              fontWeight: 500,
              letterSpacing: '0.04em',
            }}
          >
            · {councilStatements.length} stmt{councilStatements.length === 1 ? '' : 's'}
          </span>
        </span>
      )}

      {/* Reflections done counter — quiet but useful for "is the agent
          self-correcting?". Visible whenever ≥1 reflection has fired. */}
      {reflections.length > 0 && (
        <span
          style={{
            ...CHIP_BASE,
            color: 'var(--ink-secondary)',
            background: 'rgba(40,30,15,0.05)',
            border: '1px solid rgba(40,30,15,0.10)',
            opacity: lastReflection !== null ? 1 : 0.62,
            transition: 'opacity 600ms ease',
          }}
          title={
            lastReflection !== null
              ? 'Just reflected — see right column.'
              : `${reflections.length} reflection${reflections.length === 1 ? '' : 's'} so far on this task.`
          }
        >
          <Eye size={11} strokeWidth={2} />
          REFLECT × {reflections.length}
        </span>
      )}

      {/* Awaiting user / explicit prompt — coral chip steals attention. */}
      {promptToUser && (
        <span
          style={{
            ...CHIP_BASE,
            color: '#9a3412',
            background: 'color-mix(in srgb, #fb7185 16%, transparent)',
            border: '1px solid color-mix(in srgb, #fb7185 40%, transparent)',
            animation: 'phantom-pulse 1.4s ease-in-out infinite',
          }}
          title={promptToUser}
        >
          <AlertTriangle size={11} strokeWidth={2.2} />
          NEEDS YOU
        </span>
      )}

      {/* Last monologue / reflection line — flex-1 so it consumes leftover
          width and ellipsises to fit. Hidden entirely on idle so the lane
          stays tight when nothing meaningful was just said. */}
      {lastMonologue && isLive && (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: 'var(--ink-secondary)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-serif, var(--font-display))',
            fontSize: 'var(--fs-xs, 12px)',
            opacity: 0.86,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={lastMonologue}
        >
          “{lastMonologue}”
        </span>
      )}
    </div>
  );
}

/* ─── Quality gate chip — its own component because the lifecycle tells
       a small story (revising / regenerated / blocked) and the visuals
       differ enough that an inline conditional would be unreadable. ── */

function QualityGateChip({
  gate,
}: {
  gate: NonNullable<ReturnType<typeof useAgentStore.getState>['qualityGate']>;
}) {
  const isBlocked = gate.blockers.length > 0 && !gate.regenerated;
  const isRegenerated = gate.regenerated;

  if (isRegenerated) {
    // Greeny "passed-with-rewrite" badge. The lane previously had no way
    // to tell the operator "the agent rewrote its own draft until it
    // passed" — that's the literal point of phase-17a.6-revise.
    return (
      <span
        style={{
          ...CHIP_BASE,
          color: '#3f6e2a',
          background: 'color-mix(in srgb, #84cc16 18%, transparent)',
          border: '1px solid color-mix(in srgb, #84cc16 44%, transparent)',
        }}
        title={
          gate.draftExcerpt
            ? `Polished draft (${gate.round} round${gate.round === 1 ? '' : 's'}): ${gate.draftExcerpt}`
            : `Polished draft accepted after ${gate.round} round${gate.round === 1 ? '' : 's'}.`
        }
      >
        <CheckCircle2 size={11} strokeWidth={2.2} />
        POLISHED
        <span style={{ opacity: 0.74, fontWeight: 500, letterSpacing: '0.04em' }}>
          · {gate.round} round{gate.round === 1 ? '' : 's'}
        </span>
      </span>
    );
  }

  if (isBlocked) {
    // Coral "blocker" badge. Surfaces strike count so operator knows
    // when the gate is about to give up (cap=2).
    return (
      <span
        style={{
          ...CHIP_BASE,
          color: '#9a3412',
          background: 'color-mix(in srgb, #fb7185 16%, transparent)',
          border: '1px solid color-mix(in srgb, #fb7185 42%, transparent)',
          animation: 'phantom-pulse 1.6s ease-in-out infinite',
        }}
        title={
          gate.blockers.length === 1
            ? `Blocker: ${gate.blockers[0]}`
            : `${gate.blockers.length} blockers — see right column for the list.`
        }
      >
        <AlertTriangle size={11} strokeWidth={2.2} />
        POLISH BLOCKED
        <span style={{ opacity: 0.74, fontWeight: 500, letterSpacing: '0.04em' }}>
          · strike {gate.strike}/{gate.maxStrikes}
        </span>
      </span>
    );
  }

  // Default: amber "polishing in progress" badge with round counter.
  return (
    <span
      style={{
        ...CHIP_BASE,
        color: '#8a5e0a',
        background: 'color-mix(in srgb, #f4af25 14%, transparent)',
        border: '1px solid color-mix(in srgb, #f4af25 38%, transparent)',
      }}
      title="Quality gate is reviewing the draft."
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: 999,
          background: '#f4af25',
          animation: 'phantom-pulse 1.0s ease-in-out infinite',
        }}
      />
      <ShieldCheck size={11} strokeWidth={2.2} />
      POLISH
      <span style={{ opacity: 0.74, fontWeight: 500, letterSpacing: '0.04em' }}>
        · {Math.max(1, gate.round)}/{gate.maxRounds}
      </span>
    </span>
  );
}

export default AgentPulseLane;
