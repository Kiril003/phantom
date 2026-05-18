import type { AgentThoughtBudget } from '@shared/types';

export function ThoughtBudget({ budget }: { budget: AgentThoughtBudget }) {
  const used = budget.actions_used;
  const est = Math.max(1, budget.estimated_actions);
  const ratio = Math.min(1.5, used / est);
  const fillPct = Math.min(100, (used / est) * 100);

  const color =
    ratio < 0.7 ? 'var(--signal-ok)' : ratio < 1.0 ? 'var(--signal-warn)' : 'var(--signal-alert)';

  return (
    <div className="flex flex-col gap-0.5" data-testid="thought-budget">
      <div className="flex justify-between font-mono" style={{ fontSize: 'var(--fs-xxs, 10px)', color: 'var(--ink-muted)' }}>
        <span>Thought</span>
        <span>
          {used} / {budget.estimated_actions} actions · {budget.reflections_done} reflections
        </span>
      </div>
      <div
        style={{
          height: 4,
          width: '100%',
          background: 'var(--glass-border)',
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: color,
            transition: 'all 300ms ease',
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>
    </div>
  );
}
