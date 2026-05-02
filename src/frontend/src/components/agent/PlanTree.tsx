/**
 * PlanTree — recursive sub-goal/action tree for the OPERATOR screen.
 *
 * Phase 21 redesign — living capsules.
 *
 * Visual model: each strategic sub-goal is a *capsule* — a full-width pill
 * with an internal progress-fill driven by actions_used / expected_actions.
 * Active capsule breathes (capsule-breathe) and has an inner light shimmer
 * (capsule-shimmer); done capsules deepen into bronze with an inset shadow
 * ("глибшає"); failed capsules carry a coral flash; pending stay as ghost
 * outlines. The tree spine flows downward while a task is running.
 *
 * Live actions (recentActions) attach as compact leaves under their parent
 * sub_goal_id branch when expanded.
 *
 * Constraints:
 *   - Tree depth limited to MAX_DEPTH = 5; deeper nodes auto-collapse.
 *   - Touch target ≥ 44px on every interactive row.
 *   - All decorative motion respects prefers-reduced-motion (CSS @media gate
 *     in globals.css disables animation classes; component skips JS-driven
 *     props as well).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  CircleDot,
  Check,
  X,
  CircleDashed,
} from 'lucide-react';
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
  /** True when the parent task is still running — drives spine-flow. */
  taskActive?: boolean;
}

const STATUS_DOT: Record<AgentSubGoalStatus, string> = {
  pending: 'rgba(0,0,0,0.18)',
  active: 'var(--primary, #f4af25)',
  done: 'var(--primary-deep, #b07a10)',
  failed: 'var(--signal-alert, #ef4444)',
  skipped: 'var(--ink-muted, #8a7f72)',
};

export function PlanTree({
  subGoals,
  recentActions,
  activeSubGoalId,
  taskActive = false,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
  const overallPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

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
      {/* Header — step counter + overall pct */}
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
        <span className="ml-auto flex items-center gap-2" style={{ color: 'var(--ink-muted)' }}>
          <span data-testid="plan-tree-progress">
            {doneSteps}/{totalSteps}
            {activeIdx >= 0 ? ` · @${activeIdx + 1}` : ''}
          </span>
          <span
            aria-hidden
            style={{
              width: 32,
              height: 4,
              borderRadius: 2,
              background: 'rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${overallPct}%`,
                height: '100%',
                background:
                  'linear-gradient(90deg, var(--primary, #f4af25), var(--primary-deep, #b07a10))',
                transition: reducedMotion ? 'none' : 'width 320ms ease',
              }}
            />
          </span>
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ position: 'relative' }}>
        {/* Spine — flows downward when task is active. */}
        <div
          aria-hidden
          className={taskActive && !reducedMotion ? 'animate-spine-flow' : undefined}
          style={{
            position: 'absolute',
            left: 9,
            top: 8,
            bottom: 8,
            width: 1.5,
            background:
              taskActive
                ? 'repeating-linear-gradient(180deg, color-mix(in srgb, var(--primary, #f4af25) 50%, transparent) 0px, color-mix(in srgb, var(--primary, #f4af25) 50%, transparent) 6px, color-mix(in srgb, var(--primary, #f4af25) 10%, transparent) 6px, color-mix(in srgb, var(--primary, #f4af25) 10%, transparent) 14px)'
                : 'linear-gradient(180deg, color-mix(in srgb, var(--primary, #f4af25) 35%, transparent), color-mix(in srgb, var(--primary, #f4af25) 10%, transparent))',
            pointerEvents: 'none',
          }}
        />
        <ol className="flex flex-col gap-2 list-none" style={{ paddingLeft: 0 }}>
          {subGoals.map((sg, idx) => {
            const isActive = activeSubGoalId
              ? sg.id === activeSubGoalId
              : sg.status === 'active';
            const actions = actionsBySubGoal.get(sg.id) ?? [];
            const isCollapsed = collapsed.has(sg.id) || idx >= MAX_DEPTH;
            return (
              <SubGoalCapsule
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

interface CapsuleProps {
  index: number;
  subGoal: AgentSubGoal;
  actions: RecentAction[];
  isActive: boolean;
  isCollapsed: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
}

function SubGoalCapsule({
  index,
  subGoal,
  actions,
  isActive,
  isCollapsed,
  reducedMotion,
  onToggle,
}: CapsuleProps) {
  const dot = STATUS_DOT[subGoal.status];
  // activity ratio drives the inner progress-fill width.
  const used = Math.max(0, subGoal.actions_used);
  const expected = Math.max(1, subGoal.expected_actions);
  const fillPct =
    subGoal.status === 'done'
      ? 100
      : subGoal.status === 'pending'
        ? 0
        : Math.min(100, Math.round((used / expected) * 100));

  // Visuals per status — gradient fill, border, ink colour.
  const isDone = subGoal.status === 'done';
  const isFailed = subGoal.status === 'failed';
  const isPending = subGoal.status === 'pending';

  const fillBg = isDone
    ? 'linear-gradient(90deg, color-mix(in srgb, var(--primary-deep, #b07a10) 45%, transparent), color-mix(in srgb, var(--primary-shadow, #8a5e0a) 50%, transparent))'
    : isFailed
      ? 'linear-gradient(90deg, color-mix(in srgb, var(--signal-alert, #ef4444) 26%, transparent), color-mix(in srgb, var(--coral-deep, #b9201f) 26%, transparent))'
      : isActive
        ? 'linear-gradient(90deg, color-mix(in srgb, var(--primary, #f4af25) 32%, transparent) 0%, color-mix(in srgb, var(--orange, #fb923c) 24%, transparent) 50%, color-mix(in srgb, var(--primary, #f4af25) 32%, transparent) 100%)'
        : 'linear-gradient(90deg, color-mix(in srgb, var(--primary, #f4af25) 18%, transparent), color-mix(in srgb, var(--primary, #f4af25) 8%, transparent))';

  const capsuleBorder = isActive
    ? 'color-mix(in srgb, var(--primary, #f4af25) 50%, transparent)'
    : isDone
      ? 'color-mix(in srgb, var(--primary-deep, #b07a10) 36%, transparent)'
      : isFailed
        ? 'color-mix(in srgb, var(--signal-alert, #ef4444) 40%, transparent)'
        : isPending
          ? 'rgba(0,0,0,0.08)'
          : 'rgba(0,0,0,0.10)';

  const capsuleShadow = isDone
    ? 'inset 0 1px 2px rgba(120,70,10,0.20), 0 1px 2px rgba(120,70,10,0.04)'
    : isActive
      ? undefined // capsule-breathe drives shadow
      : 'var(--shadow-sm, 0 2px 8px rgba(120,70,10,0.04))';

  const inkColour = isPending ? 'var(--ink-muted)' : 'var(--ink-primary)';

  return (
    <li
      data-testid={`plan-tree-node-${subGoal.status}`}
      style={{ position: 'relative', listStyle: 'none' }}
    >
      <div className="flex items-start gap-2.5">
        {/* Spine dot */}
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            border: `2px solid ${dot}`,
            background: isDone ? dot : 'var(--surface-raised, #fdf6e9)',
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
              isActive && !reducedMotion
                ? 'phantom-pulse 1.4s ease-in-out infinite'
                : 'none',
          }}
        >
          {isDone && <Check size={9} strokeWidth={3} color="white" />}
          {isFailed && <X size={9} strokeWidth={3} color="white" />}
          {subGoal.status === 'skipped' && (
            <CircleDashed size={9} strokeWidth={2.4} color="var(--ink-muted)" />
          )}
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

        {/* The capsule itself */}
        <button
          type="button"
          onClick={onToggle}
          className={
            isActive && !reducedMotion ? 'flex-1 text-left animate-capsule-breathe' : 'flex-1 text-left'
          }
          style={{
            position: 'relative',
            minHeight: 44,
            padding: '8px 12px',
            borderRadius: 999, // capsule
            background: 'rgba(255,255,255,0.55)',
            border: `1px solid ${capsuleBorder}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            cursor: 'pointer',
            overflow: 'hidden',
            boxShadow: capsuleShadow,
          }}
          aria-expanded={!isCollapsed}
          aria-label={`Sub-goal ${index + 1}: ${subGoal.description}`}
        >
          {/* Inner progress fill — width driven by actions_used / expected. */}
          <span
            aria-hidden
            className={
              isActive && !reducedMotion ? 'animate-capsule-shimmer' : undefined
            }
            style={{
              position: 'absolute',
              inset: 0,
              width: `${fillPct}%`,
              background:
                isActive && !reducedMotion
                  ? `${fillBg}, linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)`
                  : fillBg,
              backgroundSize: isActive && !reducedMotion ? '200% 100%, 200% 100%' : '100% 100%',
              transition: reducedMotion ? 'none' : 'width 380ms ease',
              pointerEvents: 'none',
            }}
            data-testid="capsule-fill"
            data-fill-pct={fillPct}
          />

          {/* Foreground content sits above the fill */}
          <div className="flex items-center gap-2" style={{ position: 'relative' }}>
            <span
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--fs-xxs, 11px)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span
              style={{
                color: inkColour,
                fontSize: 'var(--fs-sm)',
                fontWeight: isActive ? 600 : isDone ? 500 : 400,
                lineHeight: 1.3,
                flex: 1,
                textDecoration: subGoal.status === 'skipped' ? 'line-through' : 'none',
              }}
            >
              {subGoal.description}
            </span>
            <span
              className="font-mono"
              style={{
                color: isDone ? 'var(--primary-deep, #b07a10)' : 'var(--ink-muted)',
                fontSize: 'var(--fs-xxs, 11px)',
                fontWeight: 600,
                flexShrink: 0,
              }}
              data-testid="capsule-ratio"
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
                position: 'relative',
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
