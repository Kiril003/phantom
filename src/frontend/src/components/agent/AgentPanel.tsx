import { useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { GoalInput } from './GoalInput';
import { ControlsBar } from './ControlsBar';
import { InterventionDialog } from './InterventionDialog';
import { ThoughtBudget } from './ThoughtBudget';
import { LLMCallBudget } from './LLMCallBudget';
import { TaskTree } from './TaskTree';
import { SubstateIndicator } from './SubstateIndicator';
import { EmotionIndicator } from './EmotionIndicator';
import { InnerMonologueStream } from './InnerMonologueStream';

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  idle:           { color: 'var(--ink-faint)', label: 'IDLE' },
  planning:       { color: 'var(--chart-2)', label: 'PLANNING' },
  running:        { color: 'var(--signal-info)', label: 'RUNNING' },
  paused:         { color: 'var(--ink-muted)', label: 'PAUSED' },
  awaiting_user:  { color: 'var(--signal-warn)', label: 'AWAITING USER' },
  // Phase 9.2.1 — distinct badge so the operator can tell quota waits
  // apart from user-input waits (both are "task pinned, no progress").
  blocked_quota:  { color: 'var(--chart-3)', label: 'BLOCKED · QUOTA' },
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
  const llmCallsUsed = useAgentStore((s) => s.llmCallsUsed);
  const llmCallsCap = useAgentStore((s) => s.llmCallsCap);
  const promptToUser = useAgentStore((s) => s.promptToUser);
  const resumeCaveat = useAgentStore((s) => s.resumeCaveat);
  const emotion = useAgentStore((s) => s.emotion);
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
          <EmotionIndicator emotion={emotion} />
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
        <LLMCallBudget used={llmCallsUsed} cap={llmCallsCap} />
      </div>

      {/* Middle scrollable region */}
      <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-3">
        {resumeCaveat && resumeCaveat.kind === 'browser_session_lost' && (
          <div
            className="px-3 py-2"
            data-testid="resume-caveat-banner"
            style={{
              background: 'color-mix(in srgb, var(--signal-info) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--signal-info) 32%, transparent)',
              borderRadius: 10,
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            <span
              className="font-mono mr-2"
              style={{
                color: 'var(--signal-info)',
                fontSize: 'var(--fs-xxs)',
                letterSpacing: 'var(--tracking-wider)',
              }}
            >
              СЕСІЯ ВІДНОВЛЕНА:
            </span>
            Браузерна сесія була перервана. Агент повторно відкриє сторінку, якщо потрібно.
            {resumeCaveat.lastKnownUrl && (
              <span className="ml-2" style={{ color: 'var(--ink-muted)' }}>
                (останній URL: {resumeCaveat.lastKnownUrl})
              </span>
            )}
          </div>
        )}
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

      {/* Phase 9.4c audit G3 — live backend monologue stream. */}
      <InnerMonologueStream />

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
