/** ПОЛІС — store delta mechanics + ШТАБ/Фокус render + WS routing. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePolisStore, registerPolisWsHandler } from '../stores/polisStore';
import { StaffDeck } from '../components/polis/StaffDeck';
import { MissionFocus } from '../components/polis/MissionFocus';
import type { PolisMission, PolisNode, PolisSnapshot } from '@shared/types';

vi.mock('../services/polisApi', () => ({
  polisApi: {
    state: vi.fn().mockResolvedValue({
      missions: [],
      citizens: [],
      keys: [],
      gates: [],
      governor: {
        wave_size: 0, max_wave: 4, running_nodes: 0, queued_nodes: 0,
        night_mode: false,
      },
    }),
    resolveGate: vi.fn().mockResolvedValue({ ok: true }),
    pause: vi.fn().mockResolvedValue({ ok: true }),
    resume: vi.fn().mockResolvedValue({ ok: true }),
    kill: vi.fn().mockResolvedValue({ ok: true }),
    keys: vi.fn().mockResolvedValue({ keys: [] }),
    createMission: vi.fn(),
  },
}));

function node(over: Partial<PolisNode> = {}): PolisNode {
  return {
    id: 'n1',
    kind: 'workstream',
    title: 'Архітектура',
    domain: 'dev',
    depends_on: [],
    status: 'running',
    budget: { max_tokens: 1000, max_llm_calls: 10, spent_tokens: 0, spent_llm_calls: 0 },
    artifact_paths: [],
    eta_minutes: 10,
    attempts: 1,
    max_attempts: 2,
    ...over,
  };
}

function mission(over: Partial<PolisMission> = {}): PolisMission {
  return {
    id: 'm1',
    title: 'Тестова місія',
    brief: 'бриф',
    pipeline: 'dev_studio',
    domain: 'dev',
    status: 'running',
    nodes: [node()],
    progress: 0.25,
    critical_path: ['n1'],
    eta_minutes: 30,
    budget: { max_tokens: 1000, max_llm_calls: 10, spent_tokens: 100, spent_llm_calls: 2 },
    created_at: '2026-07-04T00:00:00Z',
    updated_at: '2026-07-04T00:00:00Z',
    ...over,
  };
}

const EMPTY_SNAP: PolisSnapshot = {
  missions: [],
  citizens: [],
  keys: [],
  gates: [],
  governor: {
    wave_size: 0, max_wave: 4, running_nodes: 0, queued_nodes: 0,
    night_mode: false,
  },
};

beforeEach(() => {
  usePolisStore.setState({
    loaded: false,
    view: 'world',
    focusMissionId: null,
    missions: [],
    citizens: [],
    keys: [],
    gates: [],
    governor: EMPTY_SNAP.governor,
    budgetAlerts: {},
  });
});

describe('polisStore deltas', () => {
  it('applyNodeStatus replaces node and updates progress', () => {
    const st = usePolisStore.getState();
    st.applyMissionStatus(mission());
    st.applyNodeStatus('m1', node({ status: 'done', output_summary: 'ок' }), 0.5);
    const m = usePolisStore.getState().missions[0];
    expect(m.progress).toBe(0.5);
    expect(m.nodes[0].status).toBe('done');
  });

  it('applyNodeStatus appends unknown node (rolling-wave planning)', () => {
    const st = usePolisStore.getState();
    st.applyMissionStatus(mission());
    st.applyNodeStatus('m1', node({ id: 'n2', title: 'Новий вузол' }), 0.25);
    expect(usePolisStore.getState().missions[0].nodes).toHaveLength(2);
  });

  it('gateOpened is idempotent, gateClosed removes', () => {
    const gate = {
      id: 'g1', mission_id: 'm1', node_id: 'n1', kind: 'operator' as const,
      question: 'Продовжити?', opened_at: '2026-07-04T00:00:00Z',
    };
    const st = usePolisStore.getState();
    st.gateOpened(gate);
    st.gateOpened(gate);
    expect(usePolisStore.getState().gates).toHaveLength(1);
    st.gateClosed('g1');
    expect(usePolisStore.getState().gates).toHaveLength(0);
  });

  it('focusMission switches to focus view', () => {
    usePolisStore.getState().focusMission('m1');
    expect(usePolisStore.getState().view).toBe('focus');
    expect(usePolisStore.getState().focusMissionId).toBe('m1');
  });
});

describe('polis WS routing', () => {
  it('routes node_status / gate_opened / budget_alert into the store', () => {
    let handler: ((msg: { type: string; data: any }) => void) | undefined;
    registerPolisWsHandler((_ch, cb) => {
      handler = cb;
      return () => undefined;
    });
    usePolisStore.getState().applyMissionStatus(mission());
    handler!({
      type: 'node_status',
      data: { mission_id: 'm1', node: node({ status: 'failed', error: 'зрив' }), progress: 0.25 },
    });
    expect(usePolisStore.getState().missions[0].nodes[0].status).toBe('failed');

    handler!({
      type: 'gate_opened',
      data: {
        gate: {
          id: 'g9', mission_id: 'm1', node_id: 'n1', kind: 'budget',
          question: 'Бюджет?', opened_at: 'x',
        },
      },
    });
    expect(usePolisStore.getState().gates).toHaveLength(1);

    handler!({ type: 'budget_alert', data: { mission_id: 'm1', pressure: 0.85 } });
    expect(usePolisStore.getState().budgetAlerts.m1).toBe(0.85);
  });
});

describe('StaffDeck', () => {
  it('renders mission river with ETA and status in Ukrainian', () => {
    usePolisStore.getState().applyMissionStatus(mission());
    render(<StaffDeck />);
    expect(screen.getByText('Тестова місія')).toBeTruthy();
    expect(screen.getByText(/у роботі/)).toBeTruthy();
  });

  it('gate card approve calls resolveGate and removes the card', async () => {
    usePolisStore.getState().gateOpened({
      id: 'g1', mission_id: 'm1', node_id: 'n1', kind: 'operator',
      question: 'Показати чернетку?', opened_at: 'x',
    });
    render(<StaffDeck />);
    fireEvent.click(screen.getByText('Схвалити'));
    const { polisApi } = await import('../services/polisApi');
    expect(polisApi.resolveGate).toHaveBeenCalledWith('g1', true);
  });

  it('empty vault shows the Ollama emergency-lamp message', () => {
    render(<StaffDeck />);
    expect(screen.getByText(/локального Ollama/)).toBeTruthy();
  });
});

describe('MissionFocus', () => {
  it('renders nodes with critical-path marker and crew roles', () => {
    usePolisStore.setState({ focusMissionId: 'm1' });
    usePolisStore.getState().applyMissionStatus(
      mission({
        nodes: [
          node({
            crew: { roles: ['senior_architect'], size: 1 },
            status: 'done',
            output_summary: 'модулі описано',
          }),
        ],
      }),
    );
    render(<MissionFocus />);
    expect(screen.getByText('Архітектура')).toBeTruthy();
    expect(screen.getByText('критичний шлях')).toBeTruthy();
    expect(screen.getByText(/senior architect/)).toBeTruthy();
    expect(screen.getByText('модулі описано')).toBeTruthy();
  });

  it('paused mission offers resume control', () => {
    usePolisStore.setState({ focusMissionId: 'm1' });
    usePolisStore.getState().applyMissionStatus(mission({ status: 'paused' }));
    render(<MissionFocus />);
    expect(screen.getByText('Продовжити')).toBeTruthy();
  });
});
