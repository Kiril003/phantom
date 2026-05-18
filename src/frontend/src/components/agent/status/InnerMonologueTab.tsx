import type { AgentInnerMonologue } from '@shared/types';

const RIPCORD = (label: string, value?: string) =>
  value ? (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)', letterSpacing: 'var(--tracking-wider)' }}
      >
        {label}
      </span>
      <span style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}>{value}</span>
    </div>
  ) : null;

export function InnerMonologueTab({ monologue }: { monologue: AgentInnerMonologue }) {
  return (
    <div className="flex flex-col gap-3 mt-3" style={{ borderTop: '1px solid var(--line-subtle)', paddingTop: 12 }}>
      {RIPCORD('WHAT I SEE', monologue.what_i_see)}
      {RIPCORD('WHAT I PLAN', monologue.what_i_plan)}
      {RIPCORD('WHY THIS WORKS', monologue.why_this_works)}
      {RIPCORD('WHAT COULD FAIL', monologue.what_could_fail)}
      {monologue.objection && (
        <div
          className="px-2 py-1.5"
          style={{
            background: 'color-mix(in srgb, var(--signal-warn) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--signal-warn) 32%, transparent)',
            borderRadius: 8,
          }}
        >
          <div
            className="font-mono"
            style={{ color: 'var(--signal-warn)', fontSize: 'var(--fs-xxs)', letterSpacing: 'var(--tracking-wider)' }}
          >
            DEVIL&apos;S BUDDY OBJECTION
          </div>
          <div style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}>{monologue.objection}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="font-mono"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)' }}
        >
          CONFIDENCE
        </span>
        <div
          style={{
            flex: 1,
            height: 3,
            background: 'var(--glass-border)',
            borderRadius: 9999,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.round(Math.max(0, Math.min(1, monologue.confidence)) * 100)}%`,
              background: 'var(--signal-info)',
            }}
          />
        </div>
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)' }}>
          {(monologue.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
