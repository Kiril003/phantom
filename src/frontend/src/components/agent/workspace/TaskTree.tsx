import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentSubGoal, AgentSubGoalStatus, AgentPlanStep, AgentAuditEntry } from '@shared/types';
import { ActionCard } from './ActionCard';

const STATUS_COLOR: Record<AgentSubGoalStatus, string> = {
  pending: 'var(--ink-faint)',
  active:  'var(--accent)',
  done:    'var(--signal-ok)',
  failed:  'var(--signal-alert)',
  skipped: 'var(--ink-muted)',
};

interface Props {
  subGoals: AgentSubGoal[];
  recentActions: (AgentPlanStep & { result?: { ok: boolean; error?: string | null; elapsed_ms?: number } })[];
  auditMap?: Map<number, AgentAuditEntry>;
}

export function TaskTree({ subGoals, recentActions, auditMap }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const actionsBySubGoal = useMemo(() => {
    const map = new Map<string, typeof recentActions>();
    recentActions.forEach((a) => {
      if (!a.sub_goal_id) return;
      const list = map.get(a.sub_goal_id) ?? [];
      list.push(a);
      map.set(a.sub_goal_id, list);
    });
    return map;
  }, [recentActions]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (subGoals.length === 0) {
    return (
      <div
        className="font-mono"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
      >
        Awaiting strategic plan…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="task-tree">
      {subGoals.map((sg) => {
        const isCollapsed = collapsed.has(sg.id);
        const actions = actionsBySubGoal.get(sg.id) ?? [];
        const color = STATUS_COLOR[sg.status];
        return (
          <div
            key={sg.id}
            data-testid={`sub-goal-${sg.status}`}
            style={{
              border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
              borderRadius: 12,
              padding: 12,
              background: 'var(--glass-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => toggle(sg.id)}
              className="flex items-center gap-2 w-full text-left"
              style={{ minHeight: 28 }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: color,
                  boxShadow: sg.status === 'active' ? `0 0 8px ${color}` : 'none',
                }}
              />
              <span style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}>
                {sg.description}
              </span>
              <span
                className="font-mono ml-auto"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)' }}
              >
                {sg.actions_used}/{sg.expected_actions}
              </span>
            </button>
            {!isCollapsed && (
              <div className="mt-2 flex flex-col gap-2">
                {sg.acceptance_criteria && (
                  <div
                    className="px-2 py-1"
                    style={{
                      color: 'var(--ink-muted)',
                      fontSize: 'var(--fs-xs)',
                      borderLeft: `2px solid ${color}`,
                    }}
                  >
                    Acceptance: {sg.acceptance_criteria}
                  </div>
                )}
                {actions.length === 0 && sg.status !== 'pending' && (
                  <div style={{ color: 'var(--ink-faint)', fontSize: 'var(--fs-xs)' }}>
                    No actions yet
                  </div>
                )}
                {actions.map((a) => {
                  const audit = auditMap?.get(a.step_idx);
                  return (
                    <ActionCard
                      key={a.step_idx}
                      step={a}
                      result={a.result ?? (audit ? { ok: audit.result.ok, error: audit.result.error, elapsed_ms: audit.elapsed_ms } : undefined)}
                      auditEntryId={audit?.id}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
