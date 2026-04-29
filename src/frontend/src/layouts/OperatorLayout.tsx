/**
 * OperatorLayout — sunrise redesign of the agent control panel.
 *
 * phase-5-R1-FE-OPERATOR-1.
 *
 * Layout (1024×600 strict — 4 zones):
 *   ┌──────────────────────── HERO ────────────────────────┐
 *   │ orb · running goal · budget chips                    │
 *   ├──────── PLAN TREE ─────┬───── DECISION STACK ────────┤
 *   │ recursive sub-goals    │ what PHANTOM is thinking    │
 *   │ + action leaves        │ stack of in-flight cards    │
 *   ├────────────── GOAL INPUT ────────────────────────────┤
 *   │ mic · textarea · RUN    timeline below in slim row   │
 *   └──────────────────────────────────────────────────────┘
 *
 * Premium-warm Linear-style aesthetic. All data is live from agentStore.
 * No mocks. Tree depth ≤ MAX_DEPTH (5). Voice mic uses useVoiceRecorder.
 */
import { motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { Activity, Cpu, Sparkles } from 'lucide-react';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { Overlays } from '../components/core/Overlays';
import { GoalInput } from '../components/agent/GoalInput';
import { ControlsBar } from '../components/agent/ControlsBar';
import { InterventionDialog } from '../components/agent/InterventionDialog';
import { PlanTree } from '../components/agent/PlanTree';
import { AgentTimeline } from '../components/agent/AgentTimeline';
import { DecisionCard, type DecisionCardData } from '../components/agent/DecisionCard';
import { useAgentStream } from '../hooks/useAgentStream';
import { useAgentStore } from '../stores/agentStore';
import { EASE_PHANTOM } from '../styles/motion';
import { useState } from 'react';
import type { AgentTaskStatus } from '@shared/types';

const STATUS_PILL: Record<AgentTaskStatus | 'idle', { color: string; label: string }> = {
  idle:           { color: 'var(--ink-faint, #b3a99a)', label: 'IDLE' },
  planning:       { color: 'var(--chart-2, #fb923c)', label: 'PLANNING' },
  running:        { color: 'var(--primary, #f4af25)', label: 'RUNNING' },
  paused:         { color: 'var(--ink-muted, #8a7f72)', label: 'PAUSED' },
  awaiting_user:  { color: 'var(--signal-warn, #f59e0b)', label: 'AWAITING USER' },
  blocked_quota:  { color: 'var(--chart-3, #16a34a)', label: 'BLOCKED · QUOTA' },
  done:           { color: 'var(--signal-ok, #16a34a)', label: 'DONE' },
  failed:         { color: 'var(--signal-alert, #ef4444)', label: 'FAILED' },
  stopped:        { color: 'var(--signal-alert, #ef4444)', label: 'STOPPED' },
};

export default function OperatorLayout() {
  useAgentStream();
  const substate = useAgentStore((s) => s.substate);
  const status = useAgentStore((s) => s.status);
  const currentTask = useAgentStore((s) => s.currentTask);
  const subGoals = useAgentStore((s) => s.subGoals);
  const recentActions = useAgentStore((s) => s.recentActions);
  const observations = useAgentStore((s) => s.observations);
  const reflections = useAgentStore((s) => s.reflections);
  const thoughtBudget = useAgentStore((s) => s.thoughtBudget);
  const llmCallsUsed = useAgentStore((s) => s.llmCallsUsed);
  const llmCallsCap = useAgentStore((s) => s.llmCallsCap);
  const promptToUser = useAgentStore((s) => s.promptToUser);
  const startTask = useAgentStore((s) => s.startTask);
  const intervene = useAgentStore((s) => s.intervene);
  const setPromptToUser = useAgentStore((s) => s.setPromptToUser);

  const [interveneOpen, setInterveneOpen] = useState(false);

  useEffect(() => {
    document.body.setAttribute('data-substate', substate);
    return () => document.body.removeAttribute('data-substate');
  }, [substate]);

  const taskActive =
    currentTask !== null &&
    status !== 'idle' &&
    status !== 'done' &&
    status !== 'failed' &&
    status !== 'stopped';

  const pill = STATUS_PILL[status] ?? STATUS_PILL.idle;
  const activeSubGoal = subGoals.find((sg) => sg.status === 'active') ?? null;

  // Decision stack — newest 4 plan-step monologues, top is "live" if task running.
  const decisionCards = useMemo<DecisionCardData[]>(() => {
    const cards: DecisionCardData[] = [];
    const recents = [...recentActions]
      .slice(-6)
      .reverse(); // newest first
    recents.forEach((step, i) => {
      cards.push({
        id: `step-${step.step_idx}`,
        eyebrow: step.action,
        monologue: step.monologue ?? null,
        ts: step.ts,
        active: i === 0 && taskActive,
      });
    });
    // Append the most recent reflection as a final card so the operator sees
    // the latest verdict alongside the in-flight action.
    const lastReflection = reflections[reflections.length - 1];
    if (lastReflection) {
      cards.push({
        id: `reflection-${reflections.length}`,
        eyebrow: `reflection · ${lastReflection.verdict}`,
        monologue: null,
        reflection: lastReflection,
        ts: null,
        active: false,
      });
    }
    return cards.slice(0, 4);
  }, [recentActions, reflections, taskActive]);

  const actionsUsed = thoughtBudget.actions_used;
  const actionsCap = Math.max(thoughtBudget.estimated_actions, actionsUsed);
  const actionsPct = actionsCap > 0 ? Math.min(100, (actionsUsed / actionsCap) * 100) : 0;
  const llmPct = llmCallsCap > 0 ? Math.min(100, (llmCallsUsed / llmCallsCap) * 100) : 0;

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col relative"
      style={{ background: 'var(--surface-sunrise, var(--surface-base))' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
      data-testid="operator-layout"
    >
      <AmbientGlows />
      <StatusBar />

      <main
        className="flex-1 grid gap-3 px-3 py-3 min-h-0 z-10"
        style={{
          gridTemplateRows: 'auto 1fr auto',
          gridTemplateColumns: '1fr',
        }}
      >
        {/* ─── HERO — orb + running goal + budget chips ─── */}
        <section
          className="flex items-center gap-3 px-3 py-2"
          style={{
            background: 'var(--glass-card, rgba(255,255,255,0.7))',
            border: `1px solid color-mix(in srgb, ${pill.color} 30%, var(--glass-border, rgba(255,255,255,0.55)))`,
            borderRadius: 14,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: 'var(--shadow-md, 0 4px 14px rgba(120,70,10,0.10))',
            minHeight: 80,
          }}
        >
          {/* Status orb */}
          <div
            aria-hidden
            style={{
              width: 56,
              height: 56,
              flexShrink: 0,
              borderRadius: 999,
              background: 'var(--accent-radial, radial-gradient(circle at 30% 30%, #fff8e0, #f4af25, #fb923c))',
              boxShadow:
                '0 0 18px color-mix(in srgb, var(--primary, #f4af25) 50%, transparent)',
              animation: taskActive ? 'orb-breathe 3s ease-in-out infinite' : 'none',
              position: 'relative',
            }}
          />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Cpu size={12} strokeWidth={2} color="var(--primary-shadow, #8a5e0a)" />
              <span
                className="font-mono"
                style={{
                  color: 'var(--primary-shadow, #8a5e0a)',
                  fontSize: 'var(--fs-xxs, 11px)',
                  letterSpacing: 'var(--tracking-widest)',
                  fontWeight: 700,
                }}
              >
                OPERATOR · GOAL
              </span>
              <span
                className="font-mono"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 9px',
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${pill.color} 18%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${pill.color} 40%, transparent)`,
                  fontSize: 'var(--fs-xxs, 10px)',
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  color: pill.color,
                }}
                data-testid="operator-status-pill"
              >
                <span
                  aria-hidden
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: pill.color,
                    animation: taskActive ? 'phantom-pulse 1s ease-in-out infinite' : 'none',
                  }}
                />
                {pill.label}
              </span>
              {currentTask?.task.id && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 'var(--fs-xxs, 10px)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  · TASK {currentTask.task.id.slice(0, 6)}
                </span>
              )}
            </div>
            <p
              className="leading-snug truncate"
              style={{
                color: 'var(--ink-primary)',
                fontSize: 'var(--fs-md)',
                fontFamily: 'var(--font-serif, var(--font-display))',
                margin: 0,
              }}
              data-testid="operator-goal-line"
              title={currentTask?.task.goal ?? ''}
            >
              {currentTask?.task.goal || 'No active goal — type or speak below.'}
            </p>
          </div>

          {/* Budget chips */}
          <BudgetChip
            label="ACTIONS"
            value={`${actionsUsed}`}
            cap={`/ ${Math.max(actionsCap, 1)}`}
            pct={actionsPct}
            sub={`${thoughtBudget.reflections_done} reflections`}
          />
          <BudgetChip
            label="LLM CALLS"
            value={`${llmCallsUsed}`}
            cap={`/ ${llmCallsCap}`}
            pct={llmPct}
            sub={substate.toUpperCase()}
          />
        </section>

        {/* ─── BODY — plan tree + decision stack ─── */}
        <section
          className="grid min-h-0 gap-3"
          style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}
        >
          {/* Plan tree column */}
          <div
            className="flex flex-col min-h-0 p-3"
            style={{
              background: 'var(--glass-panel, rgba(255,255,255,0.6))',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
              borderRadius: 14,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(120,70,10,0.04))',
            }}
          >
            <PlanTree
              subGoals={subGoals}
              recentActions={recentActions}
              activeSubGoalId={activeSubGoal?.id ?? null}
            />
          </div>

          {/* Right column — decision stack on top, timeline below */}
          <div className="flex flex-col min-h-0 gap-3">
            <div
              className="flex flex-col min-h-0 p-3"
              style={{
                background: 'var(--glass-panel, rgba(255,255,255,0.6))',
                border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
                borderRadius: 14,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(120,70,10,0.04))',
                flex: '1 1 60%',
              }}
            >
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
                <Sparkles size={12} strokeWidth={2} />
                <span>Decisions</span>
                <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>
                  {decisionCards.length}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
                {decisionCards.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center h-full"
                    style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
                    data-testid="decision-stack-empty"
                  >
                    <Sparkles size={20} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: 6 }} />
                    <span style={{ letterSpacing: 'var(--tracking-wider)', fontFamily: 'var(--font-mono)' }}>
                      No decisions yet
                    </span>
                  </div>
                ) : (
                  decisionCards.map((card) => <DecisionCard key={card.id} data={card} />)
                )}
              </div>
            </div>

            <div
              className="flex flex-col min-h-0 p-3"
              style={{
                background: 'var(--glass-panel, rgba(255,255,255,0.6))',
                border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
                borderRadius: 14,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(120,70,10,0.04))',
                flex: '1 1 40%',
              }}
            >
              <AgentTimeline
                recentActions={recentActions}
                observations={observations}
                reflections={reflections}
              />
            </div>
          </div>
        </section>

        {/* ─── BOTTOM — input + controls ─── */}
        <section
          className="flex flex-col gap-2 px-3 py-3"
          style={{
            background: 'var(--glass-card, rgba(255,255,255,0.7))',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
            borderRadius: 14,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: 'var(--shadow-md, 0 4px 14px rgba(120,70,10,0.10))',
          }}
        >
          {promptToUser && (
            <div
              className="px-3 py-2 flex items-center gap-2"
              data-testid="operator-prompt-banner"
              style={{
                background: 'color-mix(in srgb, var(--signal-warn, #f59e0b) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--signal-warn, #f59e0b) 36%, transparent)',
                borderRadius: 10,
                fontSize: 'var(--fs-sm)',
                color: 'var(--ink-primary)',
              }}
            >
              <Activity size={14} color="var(--signal-warn, #f59e0b)" strokeWidth={2.2} />
              <span
                className="font-mono"
                style={{
                  fontSize: 'var(--fs-xxs, 11px)',
                  color: 'var(--signal-warn, #f59e0b)',
                  letterSpacing: 'var(--tracking-wider)',
                  fontWeight: 700,
                }}
              >
                AGENT NEEDS INPUT:
              </span>
              <span style={{ flex: 1 }}>{promptToUser}</span>
            </div>
          )}
          {taskActive ? (
            <ControlsBar onIntervene={() => setInterveneOpen(true)} />
          ) : (
            <GoalInput disabled={false} onSubmit={startTask} />
          )}
        </section>
      </main>

      <FloatingToolbar />
      <Overlays />
      <InterventionDialog
        open={interveneOpen}
        prompt={promptToUser}
        onSubmit={async (text) => {
          await intervene(text);
          setPromptToUser(null);
        }}
        onClose={() => setInterveneOpen(false)}
      />
    </motion.div>
  );
}

function BudgetChip({
  label,
  value,
  cap,
  pct,
  sub,
}: {
  label: string;
  value: string;
  cap: string;
  pct: number;
  sub: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        minWidth: 112,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid rgba(255,255,255,0.6)',
        flexShrink: 0,
      }}
      data-testid={`budget-chip-${label.toLowerCase()}`}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 'var(--fs-xxs, 10px)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-wider)',
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <span
          className="font-mono"
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 700,
            color: 'var(--ink-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{ fontSize: 'var(--fs-xxs, 10px)', color: 'var(--ink-muted)' }}
        >
          {cap}
        </span>
      </div>
      <div
        aria-hidden
        style={{
          height: 3,
          borderRadius: 2,
          background: 'rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: '100%',
            background:
              'linear-gradient(90deg, var(--primary, #f4af25), var(--orange, #fb923c))',
            transition: 'width 320ms ease',
          }}
        />
      </div>
      <span
        className="truncate"
        style={{ fontSize: 'var(--fs-xxs, 10px)', color: 'var(--ink-muted)' }}
        title={sub}
      >
        {sub}
      </span>
    </div>
  );
}
