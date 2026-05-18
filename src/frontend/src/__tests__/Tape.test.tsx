import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tape } from '../components/agent/workspace/Tape';
import { useAgentStore } from '../stores/agentStore';
import type { AgentReflectionResult, AgentPlanStep, AgentObservation } from '@shared/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReflection(verdict: AgentReflectionResult['verdict']): AgentReflectionResult {
  return {
    verdict,
    summary: 'test',
    progress_assessment: '',
    recurring_errors: [],
    recommendations: '',
    new_confidence: 0.7,
  };
}

function makeAction(step_idx: number, action: string, ts: string): AgentPlanStep {
  return {
    step_idx,
    sub_goal_id: null,
    action,
    args: {},
    intent: '',
    monologue: { what_i_see: '', what_i_plan: '' } as AgentPlanStep['monologue'],
    retried_from: null,
    ts,
  };
}

function makeObservation(step_idx: number, type: AgentObservation['type'], ts: string): AgentObservation {
  return {
    step_idx,
    type,
    source: 'test',
    content: '',
    confidence: 0.9,
    entities: [],
    ts,
  };
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('Tape', () => {
  beforeEach(() => {
    useAgentStore.setState({
      recentActions: [],
      reflections: [],
      observations: [],
    });
  });

  // ── 1. Empty state ──────────────────────────────────────────────────────

  it('renders empty state when store is empty', () => {
    render(<Tape />);
    expect(screen.getByTestId('tape')).toBeTruthy();
    expect(screen.getByText('Tape idle')).toBeTruthy();
  });

  // ── 2. Ten identical reflections collapse to 1 row with ↻10 ──────────

  it('collapses 10 identical reflections into 1 row showing ↻10', () => {
    const reflections = Array.from({ length: 10 }, () =>
      makeReflection('revise_strategy'),
    );
    useAgentStore.setState({ reflections });

    render(<Tape />);

    // Only one row should be rendered (collapsed)
    const badge = screen.getByText('↻10');
    expect(badge).toBeTruthy();

    // The tape root exists and is not in idle state
    expect(screen.queryByText('Tape idle')).toBeNull();
  });

  // ── 3. Different verdicts do not merge ─────────────────────────────────

  it('does not merge reflections with different verdicts', () => {
    useAgentStore.setState({
      reflections: [
        makeReflection('revise_strategy'),
        makeReflection('continue'),
        makeReflection('revise_subgoal'),
      ],
    });

    render(<Tape />);

    // Three distinct rows — none should show a ↻N badge
    expect(screen.queryByText(/↻/)).toBeNull();

    // All three verdict labels should appear
    expect(screen.getByText('revise_strategy')).toBeTruthy();
    expect(screen.getByText('continue')).toBeTruthy();
    expect(screen.getByText('revise_subgoal')).toBeTruthy();
  });

  // ── 4. Different step_idx do not merge ────────────────────────────────

  it('does not merge actions with different step_idx', () => {
    useAgentStore.setState({
      recentActions: [
        makeAction(0, 'shell.run', '2026-05-11T10:00:00.000Z'),
        makeAction(1, 'shell.run', '2026-05-11T10:00:01.000Z'),
        makeAction(2, 'shell.run', '2026-05-11T10:00:02.000Z'),
      ],
    });

    render(<Tape />);

    // Three rows with the same action name but different step_idx → no collapse
    expect(screen.queryByText(/↻/)).toBeNull();

    // All three entries render their action name (truncated to ≤24 chars)
    const labels = screen.getAllByText('shell.run');
    expect(labels.length).toBe(3);
  });

  // ── 5. Tap on row with repeats > 1 expands inline (5 sub-rows) ───────

  it('expands inline sub-events when tapping a collapsed row', () => {
    const reflections = Array.from({ length: 10 }, () =>
      makeReflection('revise_strategy'),
    );
    useAgentStore.setState({ reflections });

    render(<Tape />);

    // Badge present before tap
    const badge = screen.getByText('↻10');
    expect(badge).toBeTruthy();

    // The collapsed row button — click it to expand
    const button = badge.closest('button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);

    // After expanding, sub-rows become visible (up to 5).
    // Sub-rows are <li> elements inside the nested <ul>; each contains the
    // verdict text alongside a time prefix. Query by partial text match.
    const allVerdict = screen.getAllByText(/revise_strategy/);
    // 1 in the main row button + 5 in the expanded sub-list = 6
    expect(allVerdict.length).toBeGreaterThanOrEqual(6);
  });

  // ── 6. Reads from useAgentStore selectors (actions render) ────────────

  it('renders action rows seeded via useAgentStore.setState', () => {
    useAgentStore.setState({
      recentActions: [
        makeAction(0, 'browser.navigate', '2026-05-11T10:01:00.000Z'),
        makeAction(1, 'shell.exec', '2026-05-11T10:02:00.000Z'),
      ],
    });

    render(<Tape />);

    expect(screen.getByText('browser.navigate')).toBeTruthy();
    expect(screen.getByText('shell.exec')).toBeTruthy();
    expect(screen.queryByText('Tape idle')).toBeNull();
  });

  // ── 7. Observation rows render ────────────────────────────────────────

  it('renders observation rows from the store', () => {
    useAgentStore.setState({
      observations: [
        makeObservation(0, 'result', '2026-05-11T10:03:00.000Z'),
      ],
    });

    render(<Tape />);

    // Label is "result: test" truncated to 24 chars
    expect(screen.getByText('result: test')).toBeTruthy();
  });

  // ── 8. Container has data-testid="tape" ──────────────────────────────

  it('has data-testid="tape" on the root element', () => {
    render(<Tape />);
    expect(screen.getByTestId('tape')).toBeTruthy();
  });
});
