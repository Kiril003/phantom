import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskTree } from '../components/agent/workspace/TaskTree';
import type { AgentSubGoal } from '@shared/types';

const subGoals: AgentSubGoal[] = [
  { id: 'sg1', description: 'read hostname', rationale: 'first', expected_actions: 1,
    acceptance_criteria: '', status: 'done', actions_used: 1 },
  { id: 'sg2', description: 'ping gateway', rationale: 'second', expected_actions: 2,
    acceptance_criteria: '', status: 'active', actions_used: 1 },
];

describe('<TaskTree />', () => {
  it('renders one node per sub-goal with its description', () => {
    render(<TaskTree subGoals={subGoals} recentActions={[]} />);
    expect(screen.getByText('read hostname')).toBeInTheDocument();
    expect(screen.getByText('ping gateway')).toBeInTheDocument();
  });

  it('applies status colour to sub-goal borders', () => {
    const { container } = render(<TaskTree subGoals={subGoals} recentActions={[]} />);
    const done = container.querySelector('[data-testid="sub-goal-done"]');
    const active = container.querySelector('[data-testid="sub-goal-active"]');
    expect(done).toBeTruthy();
    expect(active).toBeTruthy();
  });

  it('shows the empty-state when no sub-goals', () => {
    render(<TaskTree subGoals={[]} recentActions={[]} />);
    expect(screen.getByText(/Awaiting strategic plan/i)).toBeInTheDocument();
  });
});
