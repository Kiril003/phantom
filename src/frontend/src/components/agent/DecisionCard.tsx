/**
 * DecisionCard — single "what is PHANTOM thinking now?" card.
 *
 * Sunrise redesign (phase-5-R1-FE-OPERATOR-1).
 *
 * Each card is a snapshot of an in-flight decision: the action the agent is
 * about to take or the reflection it has just produced. The OperatorLayout
 * stacks 3–4 of these on the right rail, newest on top. Source data is the
 * inner monologue of the most recent plan step (already shipped in
 * AgentPlanStep.monologue).
 */
import { useEffect, useState } from 'react';
import {
  Lightbulb,
  ShieldAlert,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { AgentInnerMonologue, AgentReflectionResult } from '@shared/types';

export interface DecisionCardData {
  /** Stable key for keyed lists. */
  id: string;
  /** Short eyebrow label (action name, or reflection tag). */
  eyebrow: string;
  /** Inner monologue captured for this decision (or null for reflections). */
  monologue: AgentInnerMonologue | null;
  /** Reflection verdict if this card represents a reflection. */
  reflection?: AgentReflectionResult;
  /** Iso timestamp for the time chip. */
  ts: string | null;
  /** Whether this is the active in-flight decision (gets the glow ring). */
  active: boolean;
}

interface Props {
  data: DecisionCardData;
}

function clockChip(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function DecisionCard({ data }: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const { eyebrow, monologue, reflection, ts, active } = data;
  const confidence = reflection
    ? reflection.new_confidence
    : (monologue?.confidence ?? 0);
  const confidencePct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const confidenceTone =
    confidencePct >= 70
      ? 'var(--signal-ok, #16a34a)'
      : confidencePct >= 40
        ? 'var(--primary, #f4af25)'
        : 'var(--signal-alert, #ef4444)';

  return (
    <article
      data-testid="decision-card"
      data-active={active ? 'true' : 'false'}
      className="flex flex-col gap-2 p-3"
      style={{
        background: active
          ? 'color-mix(in srgb, var(--primary, #f4af25) 10%, var(--glass-card, rgba(255,255,255,0.7)))'
          : 'var(--glass-card, rgba(255,255,255,0.7))',
        border: active
          ? '1px solid color-mix(in srgb, var(--primary, #f4af25) 40%, transparent)'
          : '1px solid var(--glass-border, rgba(255,255,255,0.55))',
        borderRadius: 14,
        boxShadow: active
          ? '0 4px 18px color-mix(in srgb, var(--primary, #f4af25) 20%, transparent)'
          : 'var(--shadow-sm, 0 2px 8px rgba(120,70,10,0.04))',
        animation:
          active && !reducedMotion ? 'phantom-pulse 2.2s ease-in-out infinite' : 'none',
      }}
    >
      {/* Eyebrow row */}
      <header className="flex items-center gap-2">
        <span
          className="font-mono"
          style={{
            fontSize: 'var(--fs-xxs, 11px)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-wider)',
            color: 'var(--primary-shadow, #8a5e0a)',
            textTransform: 'uppercase',
            padding: '2px 8px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--primary, #f4af25) 18%, transparent)',
          }}
        >
          {eyebrow}
        </span>
        {active && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--fs-xxs, 11px)',
              fontWeight: 600,
              letterSpacing: '0.16em',
              color: 'var(--primary-shadow, #8a5e0a)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: 'var(--primary, #f4af25)',
                animation: reducedMotion ? 'none' : 'phantom-pulse 1s ease-in-out infinite',
              }}
            />
            LIVE
          </span>
        )}
        <span
          className="font-mono ml-auto"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs, 11px)' }}
        >
          {clockChip(ts)}
        </span>
      </header>

      {/* Headline */}
      {monologue?.what_i_plan && (
        <p
          className="leading-snug"
          style={{
            color: 'var(--ink-primary)',
            fontSize: 'var(--fs-sm)',
            margin: 0,
          }}
        >
          {monologue.what_i_plan}
        </p>
      )}
      {!monologue && reflection && (
        <p
          className="leading-snug"
          style={{
            color: 'var(--ink-primary)',
            fontSize: 'var(--fs-sm)',
            margin: 0,
          }}
        >
          {reflection.summary || reflection.recommendations || 'Reflection completed.'}
        </p>
      )}

      {/* Detail rows */}
      <dl className="flex flex-col gap-1.5">
        {monologue?.what_i_see && (
          <DetailRow
            icon={<Target size={11} strokeWidth={2.2} />}
            label="see"
            value={monologue.what_i_see}
          />
        )}
        {monologue?.why_this_works && (
          <DetailRow
            icon={<Lightbulb size={11} strokeWidth={2.2} />}
            label="why"
            value={monologue.why_this_works}
          />
        )}
        {monologue?.what_could_fail && (
          <DetailRow
            icon={<ShieldAlert size={11} strokeWidth={2.2} />}
            label="risk"
            value={monologue.what_could_fail}
            tone="warn"
          />
        )}
        {monologue?.objection && (
          <DetailRow
            icon={<ShieldAlert size={11} strokeWidth={2.2} />}
            label="objection"
            value={monologue.objection}
            tone="warn"
          />
        )}
        {reflection?.recommendations && (
          <DetailRow
            icon={<Lightbulb size={11} strokeWidth={2.2} />}
            label="next"
            value={reflection.recommendations}
          />
        )}
      </dl>

      {/* Confidence bar */}
      <footer className="flex items-center gap-2 mt-1">
        <TrendingUp size={11} strokeWidth={2.2} color={confidenceTone} />
        <span
          className="font-mono"
          style={{
            fontSize: 'var(--fs-xxs, 11px)',
            color: 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-wider)',
          }}
        >
          confidence
        </span>
        <div
          aria-hidden
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: 'rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${confidencePct}%`,
              height: '100%',
              background: confidenceTone,
              transition: reducedMotion ? 'none' : 'width 320ms ease',
            }}
          />
        </div>
        <span
          className="font-mono"
          style={{
            color: confidenceTone,
            fontSize: 'var(--fs-xxs, 11px)',
            fontWeight: 700,
          }}
        >
          {confidencePct}%
        </span>
      </footer>
    </article>
  );
}

function DetailRow({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  tone?: 'default' | 'warn';
}) {
  const colour =
    tone === 'warn' ? 'var(--signal-warn, #f59e0b)' : 'var(--ink-secondary)';
  return (
    <div className="flex items-start gap-2" style={{ minHeight: 18 }}>
      <span
        aria-hidden
        style={{
          width: 18,
          display: 'inline-flex',
          justifyContent: 'center',
          color: colour,
          marginTop: 1,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 'var(--fs-xxs, 11px)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-wider)',
          textTransform: 'uppercase',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: tone === 'warn' ? colour : 'var(--ink-secondary)',
          fontSize: 'var(--fs-xs)',
          lineHeight: 1.4,
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
}
