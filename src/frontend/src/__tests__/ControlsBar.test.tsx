import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControlsBar } from '../components/agent/ControlsBar';
import { useAgentStore } from '../stores/agentStore';

vi.mock('../services/agentApi', () => ({
  agentApi: {
    pause: vi.fn(),
    resume: vi.fn(),
    intervene: vi.fn(),
    cancelStep: vi.fn(),
    stop: vi.fn(),
    startTask: vi.fn(),
    checkpoint: vi.fn(),
    resumeFromCheckpoint: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    audit: vi.fn(),
    selfModel: vi.fn(),
    feedback: vi.fn(),
  },
}));

describe('<ControlsBar />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('shows Pause + Stop when running, no Resume', () => {
    useAgentStore.setState({ status: 'running', substate: 'thinking' });
    render(<ControlsBar onIntervene={() => undefined} />);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resume')).toBeNull();
    expect(screen.getByLabelText('STOP')).toBeInTheDocument();
  });

  it('shows Resume when paused and hides Pause', () => {
    useAgentStore.setState({ status: 'paused', substate: 'paused' });
    render(<ControlsBar onIntervene={() => undefined} />);
    expect(screen.getByLabelText('Resume')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pause')).toBeNull();
  });

  it('shows Cancel-step only when substate is acting', () => {
    useAgentStore.setState({ status: 'running', substate: 'thinking' });
    const { rerender } = render(<ControlsBar onIntervene={() => undefined} />);
    expect(screen.queryByLabelText('Cancel step')).toBeNull();
    useAgentStore.setState({ status: 'running', substate: 'acting' });
    rerender(<ControlsBar onIntervene={() => undefined} />);
    expect(screen.getByLabelText('Cancel step')).toBeInTheDocument();
  });

  // Phase 9.2.3 (F-08): when a task parks on blocked_quota, the operator must
  // still be able to STOP or INTERVENE. Pause is hidden (no point pausing
  // something already parked); Cancel-step is hidden (not in 'acting' substate).
  it('keeps STOP and Intervene reachable when status is blocked_quota', () => {
    useAgentStore.setState({ status: 'blocked_quota', substate: 'waiting_user' });
    render(<ControlsBar onIntervene={() => undefined} />);
    expect(screen.getByLabelText('STOP')).toBeInTheDocument();
    expect(screen.getByLabelText('Intervene')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Resume')).toBeNull();
    expect(screen.queryByLabelText('Cancel step')).toBeNull();
  });
});
