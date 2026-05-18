/**
 * AgentLimitsSettings — TDD for "Агент / Межі" settings group.
 *
 * Three concern groups:
 * 1. groupSettings routing — agent_max_, agent_bash_, agent_unbound_ keys
 *    land in the agent.limits bucket.
 * 2. AgentLimitsGroup component — renders all 7 controls + unbound toggle,
 *    and zeroes the 3 action/LLM caps when unbound is toggled on.
 * 3. settingsStore.bulkSet — correctly patches the 3 cap keys to 0.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { inferSubgroup } from '../components/settings/groupSettings';
import { useSettingsStore } from '../stores/settingsStore';
import { AgentLimitsGroup } from '../components/settings/AgentLimitsGroup';

vi.mock('../services/api', () => ({
  settingsApi: {
    getAll: vi.fn(),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue({}),
    reset: vi.fn(),
  },
  aiApi: {},
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: React.ReactNode };
          return <div {...(rest as object)}>{children}</div>;
        },
      }
    ),
  };
});

beforeEach(() => {
  useSettingsStore.setState({
    values: {
      agent_max_actions_per_task: 20,
      agent_max_elapsed_s_per_task: 600,
      agent_max_llm_calls_per_task: 50,
      agent_max_llm_calls_per_background_task: 10,
      agent_bash_timeout_s: 120,
      agent_bash_output_cap_bytes: 16384,
      agent_unbound_default: false,
    },
    dirty: new Set<string>(),
    loaded: true,
  });
});

// ── 1. groupSettings routing ─────────────────────────────────────────────

describe('inferSubgroup — agent.limits bucket', () => {
  it('routes agent_max_actions_per_task', () => {
    expect(inferSubgroup('agent', 'agent_max_actions_per_task').id).toBe('agent.limits');
  });
  it('routes agent_max_elapsed_s_per_task', () => {
    expect(inferSubgroup('agent', 'agent_max_elapsed_s_per_task').id).toBe('agent.limits');
  });
  it('routes agent_max_llm_calls_per_task', () => {
    expect(inferSubgroup('agent', 'agent_max_llm_calls_per_task').id).toBe('agent.limits');
  });
  it('routes agent_max_llm_calls_per_background_task', () => {
    expect(inferSubgroup('agent', 'agent_max_llm_calls_per_background_task').id).toBe('agent.limits');
  });
  it('routes agent_bash_timeout_s', () => {
    expect(inferSubgroup('agent', 'agent_bash_timeout_s').id).toBe('agent.limits');
  });
  it('routes agent_bash_output_cap_bytes', () => {
    expect(inferSubgroup('agent', 'agent_bash_output_cap_bytes').id).toBe('agent.limits');
  });
  it('routes agent_unbound_default', () => {
    expect(inferSubgroup('agent', 'agent_unbound_default').id).toBe('agent.limits');
  });
  it('does NOT route unrelated agent key to agent.limits', () => {
    expect(inferSubgroup('agent', 'agent_emotion_enabled').id).not.toBe('agent.limits');
  });
});

// ── 2. AgentLimitsGroup component ────────────────────────────────────────

describe('<AgentLimitsGroup />', () => {
  function setup() {
    const onChange = vi.fn();
    const values = useSettingsStore.getState().values;
    render(<AgentLimitsGroup values={values} onChange={onChange} />);
    return { onChange };
  }

  it('renders "Агент / Межі" heading', () => {
    setup();
    expect(screen.getByText(/Агент \/ Межі/i)).toBeInTheDocument();
  });

  it('renders Безмежний режим toggle', () => {
    setup();
    expect(screen.getByLabelText(/Безмежний режим/i)).toBeInTheDocument();
  });

  it('renders agent_max_actions_per_task input', () => {
    setup();
    expect(screen.getByLabelText(/Макс\. дій на задачу/i)).toBeInTheDocument();
  });

  it('renders agent_max_elapsed_s_per_task input', () => {
    setup();
    expect(screen.getByLabelText(/Бюджет часу/i)).toBeInTheDocument();
  });

  it('renders agent_max_llm_calls_per_task input', () => {
    setup();
    expect(screen.getByLabelText(/LLM-виклики.*задача/i)).toBeInTheDocument();
  });

  it('renders agent_max_llm_calls_per_background_task input', () => {
    setup();
    expect(screen.getByLabelText(/LLM-виклики.*фон/i)).toBeInTheDocument();
  });

  it('renders agent_bash_timeout_s input', () => {
    setup();
    expect(screen.getByLabelText(/Bash timeout/i)).toBeInTheDocument();
  });

  it('renders agent_bash_output_cap_bytes input', () => {
    setup();
    expect(screen.getByLabelText(/Bash output cap/i)).toBeInTheDocument();
  });

  it('toggling Безмежний режим ON calls onChange for 3 caps with 0', () => {
    const { onChange } = setup();
    const toggle = screen.getByLabelText(/Безмежний режим/i);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('agent_max_actions_per_task', 0);
    expect(onChange).toHaveBeenCalledWith('agent_max_llm_calls_per_task', 0);
    expect(onChange).toHaveBeenCalledWith('agent_max_llm_calls_per_background_task', 0);
    expect(onChange).toHaveBeenCalledWith('agent_unbound_default', true);
  });

  it('toggling Безмежний режим ON disables the 3 cap inputs', () => {
    const values = { ...useSettingsStore.getState().values, agent_unbound_default: true };
    const onChange = vi.fn();
    render(<AgentLimitsGroup values={values} onChange={onChange} />);
    expect(
      (screen.getAllByRole('spinbutton') as HTMLInputElement[]).some((i) => i.disabled)
    ).toBe(true);
  });

  it('numeric input changes call onChange with correct key+value', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText(/Макс\. дій на задачу/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith('agent_max_actions_per_task', 30);
  });
});

// ── 3. settingsStore.bulkSet zeroes caps ─────────────────────────────────

describe('settingsStore.bulkSet — unbound zeroing', () => {
  it('bulkSet zeroes action+LLM caps while preserving other values', () => {
    const { bulkSet, values: before } = useSettingsStore.getState();
    expect(before.agent_max_actions_per_task).toBe(20);
    bulkSet({
      agent_max_actions_per_task: 0,
      agent_max_llm_calls_per_task: 0,
      agent_max_llm_calls_per_background_task: 0,
      agent_unbound_default: true,
    });
    const after = useSettingsStore.getState().values;
    expect(after.agent_max_actions_per_task).toBe(0);
    expect(after.agent_max_llm_calls_per_task).toBe(0);
    expect(after.agent_max_llm_calls_per_background_task).toBe(0);
    expect(after.agent_unbound_default).toBe(true);
    expect(after.agent_bash_timeout_s).toBe(120);
  });
});
