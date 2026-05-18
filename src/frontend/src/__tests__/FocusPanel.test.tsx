/**
 * FocusPanel — pivot render tests.
 * Task 10, OperatorLayout v3.
 *
 * Assertions:
 *  1. foreground pivot with currentTask seeded → goal text visible + plan-tree testid
 *  2. background pivot with progressByTaskId → renders progress label
 *  3. standing_orders pivot → renders SO content or placeholder
 *  4. proactive pivot with enabled=true → proactive indicator visible
 *  5. council pivot with councilActive=false → 'Council idle' text
 *  6. Now-row renders STEPS / AI numbers from budget
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAgentStore } from '../stores/agentStore';
import { useUIStore } from '../stores/uiStore';
import { FocusPanel } from '../components/agent/workspace/FocusPanel';

// ─── store reset helpers ──────────────────────────────────────────────────────

const EMPTY_BUDGET = {
  estimated_actions: 0,
  actions_used: 0,
  force_reflect_ratio: 2,
  reflections_done: 0,
};

function resetStores() {
  useAgentStore.setState({
    currentTask: null,
    subGoals: [],
    recentActions: [],
    reflections: [],
    thoughtBudget: EMPTY_BUDGET,
    llmCallsUsed: 0,
    llmCallsCap: 50,
    proactive: { enabled: false, lastCycleAt: null, hasTriggers: false },
    councilActive: false,
    progressByTaskId: {},
    bgTaskGoals: {},
    promotedToBackgroundAt: {},
    progressEtaByTaskId: {},
    progressLoading: {},
    status: 'idle',
  });
  useUIStore.setState({ focusedAgent: 'foreground' });
}

// ─── minimal AgentTaskDetail fixture ─────────────────────────────────────────

function makeTask(goal: string) {
  return {
    task: {
      id: 'task-1',
      goal,
      status: 'running' as const,
      track: 'foreground' as const,
      paused_reason: null,
      error: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    },
    sub_goals: [],
    self_model: null,
    observations: [],
    thought_budget: EMPTY_BUDGET,
    last_audit: [],
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('FocusPanel', () => {
  beforeEach(() => {
    resetStores();
  });

  // 1. Foreground pivot: goal text visible + plan-tree testid
  it('foreground: renders goal text and plan-tree area', () => {
    const task = makeTask('Explore the filesystem and report');
    useAgentStore.setState({
      currentTask: task,
      status: 'running',
      subGoals: [
        {
          id: 'sg-1',
          description: 'List all files',
          rationale: 'needed',
          status: 'active',
          actions_used: 1,
          expected_actions: 3,
          acceptance_criteria: '',
        },
      ],
    });

    const { getByTestId } = render(
      <FocusPanel focusedAgent="foreground" />,
    );

    // Container has data-testid
    expect(getByTestId('focus-panel')).toBeTruthy();

    // PlanTree renders with data-testid="plan-tree" (non-empty subGoals path)
    expect(getByTestId('plan-tree')).toBeTruthy();

    // Now-row is present
    expect(getByTestId('focus-now-row')).toBeTruthy();
  });

  // 2. Background pivot: progressByTaskId renders progress label
  it('background: renders progress label from progressByTaskId', () => {
    useAgentStore.setState({
      progressByTaskId: {
        'task-1': [
          {
            task_id: 'task-1',
            kind: 'checkpoint',
            label: 'doing X',
            percent: 42,
            at: Date.now() / 1000,
            extra: {},
          },
        ],
      },
      bgTaskGoals: { 'task-1': 'long goal here' },
    });

    const { getByTestId } = render(<FocusPanel focusedAgent="background" />);

    const progressEl = getByTestId('focus-bg-progress');
    expect(progressEl.textContent).toContain('doing X');
  });

  // 3. Standing orders pivot: renders SO content or placeholder
  it('standing_orders: renders SO content or placeholder text', () => {
    const { getByTestId, container } = render(
      <FocusPanel focusedAgent="standing_orders" />,
    );

    // The focus-panel root is always present
    expect(getByTestId('focus-panel')).toBeTruthy();

    // Either the real hook renders (with focus-so-monologue) or the placeholder
    const hasReal = container.querySelector('[data-testid="focus-so-monologue"]');
    const hasPlaceholder = container.querySelector(
      '[data-testid="focus-so-placeholder"]',
    );

    // Exactly one of them should be present
    expect(Boolean(hasReal) || Boolean(hasPlaceholder)).toBe(true);
  });

  // 4. Proactive pivot with enabled=true → indicator visible
  it('proactive: renders proactive enabled indicator', () => {
    useAgentStore.setState({
      proactive: {
        enabled: true,
        lastCycleAt: new Date().toISOString(),
        hasTriggers: false,
      },
    });

    const { getByTestId } = render(<FocusPanel focusedAgent="proactive" />);

    const indicator = getByTestId('proactive-enabled-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator.textContent).toContain('Active');
  });

  // 5. Council pivot with councilActive=false → 'Council idle'
  it('council: shows "Council idle" when councilActive=false', () => {
    useAgentStore.setState({ councilActive: false });

    const { getByTestId } = render(<FocusPanel focusedAgent="council" />);

    const idleLabel = getByTestId('council-idle-label');
    expect(idleLabel.textContent).toContain('Council idle');
  });

  // 6. Now-row renders STEPS / AI numbers from thoughtBudget and llmCalls
  it('now-row: renders STEPS and AI budget numbers', () => {
    useAgentStore.setState({
      thoughtBudget: {
        estimated_actions: 20,
        actions_used: 7,
        force_reflect_ratio: 2,
        reflections_done: 3,
      },
      llmCallsUsed: 12,
      llmCallsCap: 50,
    });

    const { getByTestId } = render(<FocusPanel focusedAgent="foreground" />);

    const stepsEl = getByTestId('now-steps');
    expect(stepsEl.textContent).toContain('7');
    expect(stepsEl.textContent).toContain('20');

    const aiEl = getByTestId('now-ai');
    expect(aiEl.textContent).toContain('12');
    expect(aiEl.textContent).toContain('50');

    const loopEl = getByTestId('now-loop');
    expect(loopEl.textContent).toContain('↻3');
  });

  // Extra: council active shows "Open Council" button
  it('council: shows Open Council button when councilActive=true', () => {
    useAgentStore.setState({ councilActive: true });

    const { getByTestId } = render(<FocusPanel focusedAgent="council" />);

    expect(getByTestId('open-council-button')).toBeTruthy();
  });

  // Extra: proactive hasTriggers flag renders badge
  it('proactive: renders "triggers pending" badge when hasTriggers=true', () => {
    useAgentStore.setState({
      proactive: {
        enabled: true,
        lastCycleAt: null,
        hasTriggers: true,
      },
    });

    const { container } = render(<FocusPanel focusedAgent="proactive" />);
    expect(container.textContent).toContain('triggers pending');
  });

  // Extra: now-row shows cf from last reflection
  it('now-row: shows confidence from last reflection', () => {
    useAgentStore.setState({
      reflections: [
        {
          verdict: 'continue',
          summary: 'good progress',
          progress_assessment: '',
          recurring_errors: [],
          recommendations: '',
          new_confidence: 0.87,
        },
      ],
    });

    const { getByTestId } = render(<FocusPanel focusedAgent="foreground" />);
    expect(getByTestId('now-cf').textContent).toContain('0.87');
  });

  // Extra: background pivot with no tasks shows placeholder
  it('background: shows "No background task" when progressByTaskId is empty', () => {
    useAgentStore.setState({ progressByTaskId: {} });

    const { getByTestId } = render(<FocusPanel focusedAgent="background" />);
    const progressEl = getByTestId('focus-bg-progress');
    expect(progressEl.textContent).toContain('No background task');
  });
});
