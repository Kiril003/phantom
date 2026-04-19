import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentPanel } from '../components/agent/AgentPanel';
import { useAgentStore } from '../stores/agentStore';

vi.mock('../services/agentApi', () => ({
  agentApi: {
    startTask: vi.fn().mockResolvedValue({ task_id: 't', started: true }),
    pause: vi.fn(),
    resume: vi.fn(),
    intervene: vi.fn(),
    cancelStep: vi.fn(),
    stop: vi.fn(),
    checkpoint: vi.fn(),
    resumeFromCheckpoint: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    audit: vi.fn(),
    selfModel: vi.fn(),
    feedback: vi.fn(),
  },
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <AgentPanel />
    </MemoryRouter>,
  );
}

describe('<AgentPanel />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('shows the placeholder goal line and goal input when idle', () => {
    renderPanel();
    expect(screen.getByTestId('agent-goal').textContent).toMatch(/No active goal/i);
    expect(screen.getByTestId('goal-input')).toBeInTheDocument();
  });

  it('swaps to controls when a task starts', () => {
    useAgentStore.getState().handleEvent({
      type: 'task.started',
      ts: Date.now(),
      payload: { task_id: 'T1', goal: 'do things', self_model: {} },
    });
    renderPanel();
    expect(screen.getByTestId('controls-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('goal-input')).toBeNull();
    expect(screen.getByTestId('agent-goal').textContent).toBe('do things');
  });

  it('renders the thought-budget bar', () => {
    renderPanel();
    expect(screen.getByTestId('thought-budget')).toBeInTheDocument();
  });

  // Phase 9.2.2 (F-05): resume_with_caveat surfaces a banner so the operator
  // knows the browser session was lost across the restart.
  it('shows the resume caveat banner when browser session is lost', () => {
    useAgentStore.getState().handleEvent({
      type: 'agent.resumed_with_caveat',
      ts: Date.now(),
      payload: {
        task_id: 't1',
        caveat: 'browser_session_lost',
        last_known_url: 'https://example.com/dashboard',
      },
    });
    renderPanel();
    const banner = screen.getByTestId('resume-caveat-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/Браузерна сесія|browser/i);
    expect(banner.textContent).toContain('example.com/dashboard');
  });
});
