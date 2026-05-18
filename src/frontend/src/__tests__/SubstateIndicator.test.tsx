import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubstateIndicator } from '../components/agent/status/SubstateIndicator';

describe('<SubstateIndicator />', () => {
  it('renders the thinking label when substate is thinking', () => {
    render(<SubstateIndicator substate="thinking" />);
    expect(screen.getByText('THINKING')).toBeInTheDocument();
  });

  it('returns null (renders nothing) when substate is idle', () => {
    const { container } = render(<SubstateIndicator substate="idle" />);
    expect(container.querySelector('[data-testid="substate-indicator"]')).toBeNull();
  });

  // Phase 9.2.3 (F-14): blocked_quota is a distinct substate, not aliased
  // to WAITING USER. Operator must be able to tell a quota-parked task
  // (auto-resumes on probe) from a task blocked on user input.
  it('renders BLOCKED (QUOTA) label when substate is blocked_quota', () => {
    render(<SubstateIndicator substate="blocked_quota" />);
    expect(screen.getByText('BLOCKED (QUOTA)')).toBeInTheDocument();
    expect(screen.queryByText('WAITING USER')).toBeNull();
  });
});
