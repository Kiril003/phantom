import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSystemStore } from '../stores/systemStore';
import { useAgentStore } from '../stores/agentStore';
import { SystemState } from '@shared/types';
import OperatorLayout from '../layouts/OperatorLayout';

// Mock framer-motion
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get:
          (_target, key) =>
            (props: Record<string, unknown>) => {
              const { children, ...rest } = props as { children?: React.ReactNode };
              const Tag = (key as string) as keyof JSX.IntrinsicElements;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return <Tag {...(rest as any)}>{children}</Tag>;
            },
      }
    ),
  };
});

function withRouter(ui: React.ReactElement) {
  // OperatorLayout's tree (V2 ParallelChatDrawer / mission UI) uses
  // react-query; the provider is mandatory or render throws.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe('OperatorLayout v3', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.OPERATOR,
      authenticated: true,
      wsConnected: true,
      sentience: { cortisol: 0.2, dopamine: 0.5, oxytocin: 0.5 },
    });
    useAgentStore.setState({
      status: 'idle',
      currentTask: null,
      subGoals: [],
      recentActions: [],
      reflections: [],
    });
  });

  it('renders the three v3 invariants: roster + focus + tape', () => {
    render(withRouter(<OperatorLayout />));
    expect(screen.getByTestId('operator-layout')).toBeDefined();
    expect(screen.getByTestId('agent-roster')).toBeDefined();
    expect(screen.getByTestId('focus-panel')).toBeDefined();
    expect(screen.getByTestId('tape')).toBeDefined();
  });

  it('no longer renders the legacy Hero/Logic Stream/Event Log sections', () => {
    render(withRouter(<OperatorLayout />));
    // These were the three redundant panels v3 collapses into FocusPanel + Tape.
    expect(screen.queryByText(/Tactical Execution/i)).toBeNull();
    expect(screen.queryByText(/Logic Stream/i)).toBeNull();
    expect(screen.queryByText(/Event Log/i)).toBeNull();
    expect(screen.queryByText(/System Controller/i)).toBeNull();
  });

  it('never crushes Vitals/Tape into unreadable peek strips (1024×600)', () => {
    // V5 regression: conversation mode (the default) jammed AgentVitals
    // into a 36px band and Tape into a 48px sliver — "не бачу їх як
    // треба". Panels must always render at readable column widths.
    render(withRouter(<OperatorLayout />));
    expect(screen.queryByTestId('vitals-peek')).toBeNull();
    expect(screen.queryByTestId('tape-peek')).toBeNull();
    expect(screen.getByTestId('vitals-column').className).toContain('col-span-2');
    expect(screen.getByTestId('tape-column').className).toContain('col-span-3');
  });

  it('renders current goal inside FocusPanel when task is active', () => {
    useAgentStore.setState({
      status: 'running',
      currentTask: {
        task: { id: 't1', goal: 'Test Goal', status: 'running' } as any,
        sub_goals: [],
        self_model: null,
        observations: [],
        thought_budget: { actions_used: 0, estimated_actions: 10 } as any,
        last_audit: [],
      },
    });
    render(withRouter(<OperatorLayout />));
    expect(screen.getByText('Test Goal')).toBeDefined();
  });
});
