/**
 * PlanTree — recursive sub-goal/action tree for the OPERATOR screen.
 *
 * Sunrise redesign (phase-5-R1-FE-OPERATOR-1).
 *
 * Visual model: each strategic sub-goal is a top-level branch. Live actions
 * (recentActions) attach as leaves to their parent sub_goal_id. The
 * component is fully data-driven from agentStore — no mocks.
 *
 * Constraints:
 *   - Tree depth limited to MAX_DEPTH = 5; deeper nodes auto-collapse and
 *     surface a "+N deeper" affordance.
 *   - Touch target ≥ 44px on every interactive row.
 *   - Reduced-motion safe: ring pulse + step glow are skipped when the OS
 *     reports prefers-reduced-motion.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, CircleDot, Check, X } from 'lucide-react';
import type {
  AgentPlanStep,
  AgentSubGoal,
  AgentSubGoalStatus,
} from '@shared/types';

export const MAX_DEPTH = 5;

type RecentAction = AgentPlanStep & {
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
  audit_entry_id?: number;
};

interface Props {
  subGoals: AgentSubGoal[];
  recentActions: RecentAction[];
  /** When set, this sub-goal is the currently active one (highlight). */
  activeSubGoalId?: string | null;
}

const STATUS_DOT: Record<AgentSubGoalStatus, string> = {
  pending: 'rgba(0,0,0,0.15)',
  active:  'var(--primary, #f4af25)',
  done:    'var(--signal-ok, #16a34a)',
  failed:  'var(--signal-alert, #ef4444)',
  skipped: 'var(--ink-muted, #8a7f72)',
};

const STATUS_BG: Record<AgentSubGoalStatus, string> = {
  pending: 'transparent',
  active:  'color-mix(in srgb, var(--primary, #f4af25) 14%, transparent)',
  done:    'color-mix(in srgb, var(--signal-ok, #16a34a) 8%, transparent)',
  failed:  'color-mix(in srgb, var(--signal-alert, #ef4444) 10%, transparent)',
  skipped: 'transparent',
};

const STATUS_BORDER: Record<AgentSubGoalStatus, string> = {
  pending: 'rgba(0,0,0,0.06)',
  active:  'color-mix(in srgb, var(--primary, #f4af25) 40%, transparent)',
  done:    'color-mix(in srgb, var(--signal-ok, #16a34a) 24%, transparent)',
  failed:  'color-mix(in srgb, var(--signal-alert, #ef4444) 30%, transparent)',
  skipped: 'rgba(0,0,0,0.06)',
};

export function PlanTree({ subGoals, recentActions, activeSubGoalId }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reducedMotion, setReducedMotion] = useState(false);

  // Reduced-motion observer (per CLAUDE.md rule 9 — anim = info, opt-out cleanly).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Bucket actions by parent sub_goal so leaves render under their branch.
  const actionsBySubGoal = useMemo(() => {
    const map = new Map<string, RecentAction[]>();
    for (const a of recentActions) {
      const key = a.sub_goal_id ?? '__orphan__';
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [recentActions]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalSteps = subGoals.length;
  const doneSteps = subGoals.filter((sg) => sg.status === 'done').length;
  const activeIdx = subGoals.findIndex((sg) => sg.status === 'active');

  if (totalSteps === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
        data-testid="plan-tree-empty"
      >
        <GitBranch size={20} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: 6 }} />
        <span style={{ letterSpacing: 'var(--tracking-wider)' }}>
          Awaiting strategic plan…
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="plan-tree">
      {/* Header — step counter */}
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
        <GitBranch size={12} strokeWidth={2} />
        <span>Plan Tree · {totalSteps} steps</span>
        <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>
          {doneSteps}/{totalSteps}
          {activeIdx >= 0 ? ` · @${activeIdx + 1}` : ''}
        </span>
      </div>

      {/* Tree body */}
      <div
        className="flex-1 min-h-0 overflow-y-auto pr-1"
        style={{ position: 'relative' }}
      >
        {/* spine */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 9,
            top: 8,
            bottom: 8,
            width: 1.5,
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--primary, #f4af25) 35%, transparent), color-mix(in srgb, var(--primary, #f4af25) 10%, transparent))',
            pointerEvents: 'none',
          }}
        />
        <ol className="flex flex-col gap-1.5 list-none" style={{ paddingLeft: 0 }}>
          {subGoals.map((sg, idx) => {
            const isActive = activeSubGoalId
              ? sg.id === activeSubGoalId
              : sg.status === 'active';
            const actions = actionsBySubGoal.get(sg.id) ?? [];
            const isCollapsed = collapsed.has(sg.id) || idx >= MAX_DEPTH;
            return (
              <SubGoalNode
                key={sg.id}
                index={idx}
                subGoal={sg}
                actions={actions}
                isActive={isActive}
                isCollapsed={isCollapsed}
                reducedMotion={reducedMotion}
                onToggle={() => toggle(sg.id)}
              />
            );
          })}
        </ol>
        {totalSteps > MAX_DEPTH && (
          <div
            className="mt-2 ml-6 px-2 py-1"
            style={{
              fontSize: 'var(--fs-xxs, 11px)',
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wider)',
            }}
          >
            +{totalSteps - MAX_DEPTH} deeper · expand to view
          </div>
        )}
      </div>
    </div>
  );
}

interface NodeProps {
  index: number;
  subGoal: AgentSubGoal;
  actions: RecentAction[];
  isActive: boolean;
  isCollapsed: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
}

function SubGoalNode({
  index,
  subGoal,
  actions,
  isActive,
  isCollapsed,
  reducedMotion,
  onToggle,
}: NodeProps) {
  const dot = STATUS_DOT[subGoal.status];
  const bg = STATUS_BG[subGoal.status];
  const border = STATUS_BORDER[subGoal.status];

  return (
    <li
      data-testid={`plan-tree-node-${subGoal.status}`}
      style={{ position: 'relative', listStyle: 'none' }}
    >
      <div className="flex items-start gap-2.5">
        {/* Node dot — pulses while active */}
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            border: `2px solid ${dot}`,
            background: subGoal.status === 'done' ? dot : 'var(--surface-raised, #fdf6e9)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 8,
            zIndex: 1,
            boxShadow:
              isActive && !reducedMotion
                ? `0 0 0 4px color-mix(in srgb, var(--primary, #f4af25) 22%, transparent)`
                : 'none',
            animation:
              isActive && !reducedMotion ? 'phantom-pulse 1.4s ease-in-out infinite' : 'none',
          }}
        >
          {subGoal.status === 'done' && <Check size={9} strokeWidth={3} color="white" />}
          {subGoal.status === 'failed' && <X size={9} strokeWidth={3} color="white" />}
          {isActive && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: dot,
              }}
            />
          )}
        </span>

        {/* Branch card */}
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left"
          style={{
            minHeight: 44,
            padding: '6px 10px',
            borderRadius: 10,
            background: bg,
            border: `1px solid ${border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            cursor: 'pointer',
          }}
          aria-expanded={!isCollapsed}
          aria-label={`Sub-goal ${index + 1}: ${subGoal.description}`}
        >
          <div className="flex items-center gap-2">
            <span
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--fs-xxs, 11px)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span
              style={{
                color:
                  subGoal.status === 'pending' ? 'var(--ink-muted)' : 'var(--ink-primary)',
                fontSize: 'var(--fs-sm)',
                fontWeight: isActive ? 600 : 400,
                lineHeight: 1.3,
                flex: 1,
              }}
            >
              {subGoal.description}
            </span>
            <span
              className="font-mono"
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--fs-xxs, 11px)',
                flexShrink: 0,
              }}
            >
              {subGoal.actions_used}/{subGoal.expected_actions}
            </span>
            {actions.length > 0 ? (
              isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />
            ) : null}
          </div>
          {subGoal.acceptance_criteria && !isCollapsed && (
            <div
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--fs-xxs, 11px)',
                marginTop: 4,
                paddingLeft: 8,
                borderLeft: `2px solid ${dot}`,
              }}
            >
              {subGoal.acceptance_criteria}
            </div>
          )}
        </button>
      </div>

      {/* Action leaves */}
      {!isCollapsed && actions.length > 0 && (
        <ul
          className="flex flex-col gap-1 list-none"
          style={{ paddingLeft: 28, marginTop: 4 }}
        >
          {actions.slice(-MAX_DEPTH).map((a) => (
            <ActionLeaf key={a.step_idx} step={a} />
          ))}
          {actions.length > MAX_DEPTH && (
            <li
              style={{
                fontSize: 'var(--fs-xxs, 11px)',
                color: 'var(--ink-muted)',
                fontFamily: 'var(--font-mono)',
                paddingLeft: 6,
              }}
            >
              +{actions.length - MAX_DEPTH} earlier
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ActionLeaf({ step }: { step: RecentAction }) {
  const ok = step.result?.ok;
  const pending = step.result === undefined;
  const colour = pending
    ? 'var(--primary, #f4af25)'
    : ok
      ? 'var(--signal-ok, #16a34a)'
      : 'var(--signal-alert, #ef4444)';
  return (
    <li
      className="flex items-center gap-2 px-2 py-1"
      data-testid="plan-tree-leaf"
      style={{
        minHeight: 28,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.45)',
        border: '1px solid rgba(255,255,255,0.55)',
      }}
    >
      <CircleDot size={10} color={colour} strokeWidth={2.4} />
      <span
        className="font-mono"
        style={{
          fontSize: 'var(--fs-xxs, 11px)',
          color: 'var(--primary-shadow, #8a5e0a)',
          padding: '1px 6px',
          borderRadius: 4,
          background: 'color-mix(in srgb, var(--primary, #f4af25) 14%, transparent)',
          flexShrink: 0,
        }}
      >
        {step.action}
      </span>
      <span
        className="truncate"
        style={{
          color: 'var(--ink-secondary)',
          fontSize: 'var(--fs-xxs, 11px)',
          flex: 1,
        }}
        title={step.intent}
      >
        {step.intent || '—'}
      </span>
      {step.result?.elapsed_ms != null && (
        <span
          className="font-mono"
          style={{ color: 'var(--ink-faint)', fontSize: 'var(--fs-xxs, 11px)', flexShrink: 0 }}
        >
          {step.result.elapsed_ms}ms
        </span>
      )}
    </li>
  );
}
