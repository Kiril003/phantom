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
});
