/**
 * V5 TDD — PlanEditor trigger + робоча зона оператора.
 *
 * T2: "✎ План" button in AgentCommandCenter opens PlanEditor (sets open state).
 * T3: OperatorLayout — робоча зона на всю ширину в БУДЬ-ЯКОМУ режимі; peek-панелі
 *     зняті разом із колонковим поділом v4.
 * T4 знято 03.09 разом із перемикачем «Агент / Екран оператора»: обидва режими
 *     давали ідентичну верстку (доводить T3), читачів ui_agent_layout поза самим
 *     перемикачем не було жодного — жест зберігав значення й не робив нічого.
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

// ── shared mocks ────────────────────────────────────────────────────────────

// Stub heavy workspace components that need QueryClient / real services.
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
vi.mock('../components/agent/overlays/AgentRoster', () => ({
  AgentRoster: () => <div data-testid="agent-roster-stub" />,
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
             
            return <Tag {...(rest as any)}>{children}</Tag>;
          },
      },
    ),
  };
});

vi.mock('../services/api', () => ({
  request: vi.fn().mockRejectedValue(new Error('offline')),
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

  // Колонковий поділ 9/3 знято разом із OperatorLayout v4: робоча зона
  // тепер на всю ширину. Перевіряємо, що вона є і що жоден режим її не
  // «підтискає» назад у вузьку смугу.
  for (const mode of ['conversation', 'telemetry'] as const) {
    it(`${mode}: робоча зона на всю ширину, без стиснених peek-панелей`, () => {
      useSettingsStore.setState({ values: { ui_agent_layout: mode }, loaded: true });
      render(wrap(<OperatorLayout />));
      expect(screen.getByTestId('operator-layout')).toBeTruthy();
      expect(screen.getByTestId('focus-panel-stub')).toBeTruthy();
      expect(screen.getByTestId('agent-roster-stub')).toBeTruthy();
      expect(screen.queryByTestId('vitals-peek')).toBeNull();
      expect(screen.queryByTestId('tape-peek')).toBeNull();
    });
  }

  it('за замовчуванням робоча зона теж повна', () => {
    useSettingsStore.setState({ values: {}, loaded: true });
    render(wrap(<OperatorLayout />));
    expect(screen.getByTestId('focus-panel-stub')).toBeTruthy();
    expect(screen.queryByTestId('vitals-peek')).toBeNull();
  });

});

