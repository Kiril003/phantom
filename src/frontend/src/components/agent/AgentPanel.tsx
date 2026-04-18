import { useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { GoalInput } from './GoalInput';
import { ControlsBar } from './ControlsBar';
import { InterventionDialog } from './InterventionDialog';
import { ThoughtBudget } from './ThoughtBudget';
import { TaskTree } from './TaskTree';
import { SubstateIndicator } from './SubstateIndicator';

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  idle:           { color: 'var(--ink-faint)', label: 'IDLE' },
  planning:       { color: 'var(--chart-2)', label: 'PLANNING' },
  running:        { color: 'var(--signal-info)', label: 'RUNNING' },
  paused:         { color: 'var(--ink-muted)', label: 'PAUSED' },
  awaiting_user:  { color: 'var(--signal-warn)', label: 'AWAITING USER' },
  done:           { color: 'var(--signal-ok)', label: 'DONE' },
  failed:         { color: 'var(--signal-alert)', label: 'FAILED' },
  stopped:        { color: 'var(--signal-alert)', label: 'STOPPED' },
};

export function AgentPanel() {
  const status = useAgentStore((s) => s.status);
  const substate = useAgentStore((s) => s.substate);
  const currentTask = useAgentStore((s) => s.currentTask);
  const subGoals = useAgentStore((s) => s.subGoals);
  const recentActions = useAgentStore((s) => s.recentActions);
  const thoughtBudget = useAgentStore((s) => s.thoughtBudget);
  const promptToUser = useAgentStore((s) => s.promptToUser);
  const startTask = useAgentStore((s) => s.startTask);
  const intervene = useAgentStore((s) => s.intervene);
  const setPromptToUser = useAgentStore((s) => s.setPromptToUser);

  const [interveneOpen, setInterveneOpen] = useState(false);

  const taskActive = currentTask !== null && status !== 'idle' && status !== 'done' && status !== 'failed' && status !== 'stopped';
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle;

  return (
    <div className="flex flex-col h-full" data-testid="agent-panel">
      {/* Top sticky region */}
      <div
        className="px-5 py-3 flex flex-col gap-2"
        style={{
          borderBottom: '1px solid var(--line-subtle)',
          background: 'var(--glass-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <h2
            className="font-display flex-1"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-md)',
              letterSpacing: 'var(--tracking-wide)',
            }}
            data-testid="agent-goal"
          >
            {currentTask?.task.goal || 'No active goal — type one below.'}
          </h2>
          <SubstateIndicator substate={substate} />
          <span
            className="px-2 py-0.5 font-mono"
            style={{
              fontSize: 'var(--fs-xxs)',
              letterSpacing: 'var(--tracking-wider)',
              background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
              color: badge.color,
              border: `1px solid color-mix(in srgb, ${badge.color} 32%, transparent)`,
              borderRadius: 6,
            }}
          >
            {badge.label}
          </span>
        </div>
        <ThoughtBudget budget={thoughtBudget} />
      </div>

      {/* Middle scrollable region */}
      <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-3">
        {promptToUser && (
          <div
            className="px-3 py-2"
            style={{
              background: 'color-mix(in srgb, var(--signal-warn) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--signal-warn) 32%, transparent)',
              borderRadius: 10,
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            <span
              className="font-mono mr-2"
              style={{ color: 'var(--signal-warn)', fontSize: 'var(--fs-xxs)', letterSpacing: 'var(--tracking-wider)' }}
            >
              AGENT NEEDS INPUT:
            </span>
            {promptToUser}
          </div>
        )}
        <TaskTree subGoals={subGoals} recentActions={recentActions} />
      </div>

      {/* Bottom controls */}
      <div
        className="px-5 py-3 flex flex-col gap-3"
        style={{
          borderTop: '1px solid var(--line-subtle)',
          background: 'var(--glass-subtle)',
        }}
      >
        {!taskActive ? (
          <GoalInput disabled={false} onSubmit={startTask} />
        ) : (
          <ControlsBar
            onIntervene={() => {
              setInterveneOpen(true);
            }}
          />
        )}
      </div>

      <InterventionDialog
        open={interveneOpen}
        prompt={promptToUser}
        onSubmit={async (text) => {
          await intervene(text);
          setPromptToUser(null);
        }}
        onClose={() => setInterveneOpen(false)}
      />
    </div>
  );
}
