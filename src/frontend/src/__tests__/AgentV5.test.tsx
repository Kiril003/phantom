/**
 * V5 TDD — PlanEditor trigger + layout toggle.
 *
 * T2: "✎ План" button in AgentCommandCenter opens PlanEditor (sets open state).
 * T3: OperatorLayout conversation mode → vitals/tape peek; telemetry mode → full columns.
 * T4: AgentLayoutGroup renders both modes, persists via onChange, settings key in store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useAgentStore } from '../stores/agentStore';
import { useSystemStore } from '../stores/systemStore';
import { useSettingsStore } from '../stores/settingsStore';
import { SystemState } from '@shared/types';
import OperatorLayout from '../layouts/OperatorLayout';
import { AgentCommandCenter } from '../components/agent/hud/AgentCommandCenter';
import { AgentLayoutGroup } from '../components/settings/AgentLayoutGroup';

// ── shared mocks ────────────────────────────────────────────────────────────

// Stub heavy workspace components that need QueryClient / real services.
vi.mock('../components/agent/workspace/AgentVitals', () => ({
  AgentVitals: () => <div data-testid="agent-vitals-stub" />,
}));
vi.mock('../components/agent/workspace/Tape', () => ({
  Tape: () => <div data-testid="tape-stub" />,
}));
vi.mock('../components/agent/workspace/FocusPanel', () => ({
  FocusPanel: () => <div data-testid="focus-panel-stub" />,
}));
vi.mock('../components/core/StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar-stub" />,
}));
vi.mock('../components/core/AmbientGlows', () => ({
  AmbientGlows: () => null,
}));
vi.mock('../components/core/FloatingToolbar', () => ({
  FloatingToolbar: () => null,
}));
vi.mock('../components/core/Orb', () => ({
  Orb: () => null,
}));
vi.mock('../components/agent/hud/SafetyShieldToggle', () => ({
  SafetyShieldToggle: () => null,
}));
vi.mock('../components/agent/overlays/AgentVault', () => ({
  AgentVault: () => null,
}));
vi.mock('../components/agent/overlays/ParallelChatDrawer', () => ({
  ParallelChatDrawer: () => null,
}));
vi.mock('../components/agent/overlays/InterventionDialog', () => ({
  InterventionDialog: () => null,
}));
vi.mock('../components/agent/overlays/AgentRoster', () => ({
  AgentRoster: () => <div data-testid="agent-roster-stub" />,
}));
vi.mock('../components/agent/overlays/AgentReportScreen', () => ({
  AgentReportScreen: () => null,
}));
vi.mock('../components/agent/overlays/CouncilStage', () => ({
  CouncilStage: () => null,
}));
vi.mock('../components/agent/overlays/InfoNeedDialog', () => ({
  InfoNeedDialog: () => null,
}));
vi.mock('../components/agent/workspace/PlanEditor', () => ({
  PlanEditor: () => null,
}));
vi.mock('../components/mission/MissionMounts', () => ({
  MissionMounts: () => null,
}));
vi.mock('../components/core/ToastRail', () => ({
  ToastRail: () => null,
}));
vi.mock('../hooks/useAgentStream', () => ({
  useAgentStream: () => {},
}));
vi.mock('../services/MorphologyEngine', () => ({
  MorphologyEngine: { getProfile: () => ({ opacity: 1 }) },
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get:
          (_t, key) =>
          (props: Record<string, unknown>) => {
            const { children, ...rest } = props as { children?: React.ReactNode };
            const Tag = key as keyof JSX.IntrinsicElements;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return <Tag {...(rest as any)}>{children}</Tag>;
          },
      },
    ),
  };
});

vi.mock('../services/api', () => ({
  settingsApi: {
    getAll: vi.fn().mockResolvedValue({ categories: [] }),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue({}),
    reset: vi.fn(),
  },
  aiApi: {},
}));

vi.mock('../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({ state: 'idle', start: vi.fn(), stop: vi.fn() }),
}));

vi.mock('../hooks/useChromeCollapse', () => ({
  useChromeCollapse: () => [false, vi.fn()],
}));

vi.mock('../services/voiceApi', () => ({
  voiceApi: { transcribe: vi.fn() },
}));

function wrap(ui: React.ReactElement) {
  return <BrowserRouter>{ui}</BrowserRouter>;
}

// ── T2: PlanEditor trigger ────────────────────────────────────────────────

describe('T2 — AgentCommandCenter Plan button', () => {
  it('renders "✎ План" button when task is active and handler provided', () => {
    useAgentStore.setState({
      status: 'running',
      currentTask: {
        task: { id: 't1', goal: 'test', status: 'running' } as never,
        sub_goals: [],
        self_model: null,
        observations: [],
        thought_budget: { actions_used: 0, estimated_actions: 10 } as never,
        last_audit: [],
      },
    });
    const onOpenPlanEditor = vi.fn();
    render(
      wrap(
        <AgentCommandCenter
          onOpenParallelChat={vi.fn()}
          onOpenPlanEditor={onOpenPlanEditor}
        />,
      ),
    );
    const btn = screen.getByTestId('plan-editor-trigger');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onOpenPlanEditor).toHaveBeenCalledTimes(1);
  });

  it('does not render Plan button when no task is active', () => {
    useAgentStore.setState({ status: 'idle', currentTask: null });
    render(
      wrap(
        <AgentCommandCenter
          onOpenParallelChat={vi.fn()}
          onOpenPlanEditor={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByTestId('plan-editor-trigger')).toBeNull();
  });

  it('does not render Plan button when handler is not provided', () => {
    useAgentStore.setState({
      status: 'running',
      currentTask: {
        task: { id: 't2', goal: 'g', status: 'running' } as never,
        sub_goals: [],
        self_model: null,
        observations: [],
        thought_budget: { actions_used: 0, estimated_actions: 5 } as never,
        last_audit: [],
      },
    });
    render(wrap(<AgentCommandCenter onOpenParallelChat={vi.fn()} />));
    expect(screen.queryByTestId('plan-editor-trigger')).toBeNull();
  });
});

// ── T3: Layout toggle ─────────────────────────────────────────────────────

describe('T3 — OperatorLayout conversation vs telemetry', () => {
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

  // The V5 conversation "peek" crush (col-span-1 + 36px/48px wrappers)
  // was an unreadable regression on the 1024×600 device — operator:
  // "не бачу їх як треба". Layout is now fixed 9/3 split.
  for (const mode of ['conversation', 'telemetry'] as const) {
    it(`${mode} mode: main column readable (col-span-9), no peek crush`, () => {
      useSettingsStore.setState({ values: { ui_agent_layout: mode }, loaded: true });
      render(wrap(<OperatorLayout />));
      expect(screen.getByTestId('main-stream-column').className).toContain('col-span-9');
      expect(screen.queryByTestId('vitals-peek')).toBeNull();
    });

    it(`${mode} mode: tape-column readable (col-span-3), no peek crush`, () => {
      useSettingsStore.setState({ values: { ui_agent_layout: mode }, loaded: true });
      render(wrap(<OperatorLayout />));
      expect(screen.getByTestId('tape-column').className).toContain('col-span-3');
      expect(screen.queryByTestId('tape-peek')).toBeNull();
    });
  }

  it('default (ui_agent_layout unset): panels readable, never crushed', () => {
    useSettingsStore.setState({ values: {}, loaded: true });
    render(wrap(<OperatorLayout />));
    expect(screen.getByTestId('main-stream-column').className).toContain('col-span-9');
    expect(screen.getByTestId('tape-column').className).toContain('col-span-3');
  });
});

// ── T4: AgentLayoutGroup settings component ────────────────────────────────

describe('T4 — AgentLayoutGroup', () => {
  it('renders "Агент / Екран оператора" heading', () => {
    const onChange = vi.fn();
    render(<AgentLayoutGroup values={{ ui_agent_layout: 'conversation' }} onChange={onChange} />);
    expect(screen.getByText(/Агент \/ Екран оператора/i)).toBeDefined();
  });

  it('renders both mode buttons', () => {
    render(
      <AgentLayoutGroup values={{ ui_agent_layout: 'conversation' }} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('agent-layout-conversation')).toBeDefined();
    expect(screen.getByTestId('agent-layout-telemetry')).toBeDefined();
  });

  it('conversation button is aria-pressed when active', () => {
    render(
      <AgentLayoutGroup values={{ ui_agent_layout: 'conversation' }} onChange={vi.fn()} />,
    );
    const btn = screen.getByTestId('agent-layout-conversation') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('telemetry button is NOT aria-pressed when conversation is active', () => {
    render(
      <AgentLayoutGroup values={{ ui_agent_layout: 'conversation' }} onChange={vi.fn()} />,
    );
    const btn = screen.getByTestId('agent-layout-telemetry') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking telemetry calls onChange with correct key+value', () => {
    const onChange = vi.fn();
    render(<AgentLayoutGroup values={{ ui_agent_layout: 'conversation' }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('agent-layout-telemetry'));
    expect(onChange).toHaveBeenCalledWith('ui_agent_layout', 'telemetry');
  });

  it('clicking conversation calls onChange with correct key+value', () => {
    const onChange = vi.fn();
    render(<AgentLayoutGroup values={{ ui_agent_layout: 'telemetry' }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('agent-layout-conversation'));
    expect(onChange).toHaveBeenCalledWith('ui_agent_layout', 'conversation');
  });

  it('defaults to conversation when key is absent', () => {
    render(<AgentLayoutGroup values={{}} onChange={vi.fn()} />);
    const btn = screen.getByTestId('agent-layout-conversation') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('settingsStore.setValue persists ui_agent_layout', () => {
    useSettingsStore.setState({ values: { ui_agent_layout: 'conversation' }, dirty: new Set() });
    const { setValue } = useSettingsStore.getState();
    setValue('ui_agent_layout', 'telemetry');
    expect(useSettingsStore.getState().values['ui_agent_layout']).toBe('telemetry');
    expect(useSettingsStore.getState().dirty.has('ui_agent_layout')).toBe(true);
  });
});
