/** Операційний Зал — розмова, документи, живі воркери. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { usePolisStore, registerPolisWsHandler } from '../stores/polisStore';
import { ConversationPanel } from '../components/polis/room/ConversationPanel';
import { DocumentsPanel } from '../components/polis/room/DocumentsPanel';
import { WorkersRail, WorkerInspector } from '../components/polis/room/WorkersRail';
import { MissionRail } from '../components/polis/room/MissionRail';
import type { PolisMission, PolisNode } from '@shared/types';

vi.mock('../services/polisApi', () => ({
  polisApi: {
    state: vi.fn().mockResolvedValue({
      missions: [], citizens: [], keys: [], gates: [],
      governor: { wave_size: 0, max_wave: 4, running_nodes: 0, queued_nodes: 0, night_mode: false },
    }),
    mission: vi.fn().mockResolvedValue({
      mission: baseMission(), chat: [{ role: 'phantom', text: 'Я тут.' }],
    }),
    chat: vi.fn().mockResolvedValue({ reply: { role: 'phantom', text: 'Прийнято.' } }),
    artifacts: vi.fn().mockResolvedValue({
      artifacts: [{ name: 'a.md', node_id: 'a', title: 'Архітектура', size: 2048, updated_at: '2026-07-04T02:00:00Z' }],
    }),
    artifact: vi.fn().mockResolvedValue({ name: 'a.md', content: '# Архітектура\n\nмодулі' }),
    workers: vi.fn().mockResolvedValue({ workers: [] }),
    workerTranscript: vi.fn().mockResolvedValue({ node_id: 'a', transcript: 'повний лог' }),
    resolveGate: vi.fn().mockResolvedValue({ ok: true }),
    pause: vi.fn(), resume: vi.fn(), kill: vi.fn(),
    keys: vi.fn().mockResolvedValue({ keys: [] }),
    createMission: vi.fn(),
  },
}));

function node(over: Partial<PolisNode> = {}): PolisNode {
  return {
    id: 'a', kind: 'workstream', title: 'Архітектура', domain: 'dev',
    depends_on: [], status: 'running',
    budget: { max_tokens: 1000, max_llm_calls: 10, spent_tokens: 0, spent_llm_calls: 1 },
    artifact_paths: [], eta_minutes: 10, attempts: 1, max_attempts: 2,
    crew: { roles: ['senior_architect'], size: 1 },
    ...over,
  };
}

function baseMission(over: Partial<PolisMission> = {}): PolisMission {
  return {
    id: 'm1', title: 'Зоряна місія', brief: 'бриф', pipeline: 'dev_studio',
    domain: 'dev', status: 'running', nodes: [node()], progress: 0.3,
    critical_path: ['a'], eta_minutes: 25,
    budget: { max_tokens: 1000, max_llm_calls: 10, spent_tokens: 100, spent_llm_calls: 2 },
    created_at: '2026-07-04T01:00:00Z', updated_at: '2026-07-04T01:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  usePolisStore.setState({
    loaded: true, view: 'world', focusMissionId: null,
    missions: [baseMission()], citizens: [], keys: [], gates: [],
    governor: { wave_size: 1, max_wave: 4, running_nodes: 1, queued_nodes: 2, night_mode: false },
    budgetAlerts: {}, selectedMissionId: 'm1', roomTab: 'talk',
    chats: {}, transcripts: {}, artifacts: {}, openDoc: null,
    inspectorNodeId: null, chatBusy: false,
  });
});

describe('ConversationPanel', () => {
  it('sends operator message optimistically', async () => {
    render(<ConversationPanel />);
    fireEvent.change(screen.getByTestId('mission-chat-input'), {
      target: { value: 'додай крок безпеки' },
    });
    fireEvent.click(screen.getByTestId('mission-chat-send'));
    expect(await screen.findByText('додай крок безпеки')).toBeTruthy();
    const { polisApi } = await import('../services/polisApi');
    await waitFor(() =>
      expect(polisApi.chat).toHaveBeenCalledWith('m1', 'додай крок безпеки'),
    );
  });

  it('renders system events and applied actions', () => {
    usePolisStore.getState().appendChat('m1', {
      role: 'system', text: '✓ «Архітектура» виконано',
    });
    usePolisStore.getState().appendChat('m1', {
      role: 'phantom', text: 'Додав крок.', applied: ['add_node:x1'],
    });
    render(<ConversationPanel />);
    expect(screen.getByText('✓ «Архітектура» виконано')).toBeTruthy();
    expect(screen.getByText(/застосовано: add_node:x1/)).toBeTruthy();
  });

  it('shows gate inline with approve action', async () => {
    usePolisStore.getState().gateOpened({
      id: 'g1', mission_id: 'm1', node_id: 'a', kind: 'operator',
      question: 'Продовжити з подвоєним лімітом?', opened_at: 'x',
    });
    render(<ConversationPanel />);
    fireEvent.click(screen.getByText('Схвалити'));
    const { polisApi } = await import('../services/polisApi');
    await waitFor(() =>
      expect(polisApi.resolveGate).toHaveBeenCalledWith('g1', true),
    );
  });
});

describe('WorkersRail + Inspector', () => {
  it('streams live tail into worker card via appendDelta', () => {
    usePolisStore.getState().appendDelta('m1', 'a', 'пишу модуль авторизації');
    render(<WorkersRail />);
    expect(screen.getByText(/пишу модуль авторизації/)).toBeTruthy();
  });

  it('inspector shows full transcript and loads from REST', async () => {
    usePolisStore.getState().openInspector('a');
    render(<WorkerInspector />);
    await waitFor(() =>
      expect(screen.getByTestId('inspector-transcript').textContent).toContain(
        'повний лог',
      ),
    );
    expect(screen.getByText(/senior architect/)).toBeTruthy();
  });
});

describe('DocumentsPanel', () => {
  it('lists artifacts and opens a doc rendered as markdown', async () => {
    usePolisStore.setState({
      artifacts: {
        m1: [{ name: 'a.md', node_id: 'a', title: 'Архітектура', size: 2048, updated_at: '2026-07-04T02:00:00Z' }],
      },
    });
    render(<DocumentsPanel />);
    fireEvent.click(screen.getByTestId('doc-a.md'));
    await waitFor(() => expect(usePolisStore.getState().openDoc).toBeTruthy());
    expect(usePolisStore.getState().openDoc?.content).toContain('модулі');
  });
});

describe('MissionRail', () => {
  it('selecting a mission loads its chat and artifacts', async () => {
    render(<MissionRail onNewMission={() => undefined} />);
    fireEvent.click(screen.getByTestId('rail-mission-m1'));
    await waitFor(() => {
      expect(usePolisStore.getState().chats.m1?.[0]?.text).toBe('Я тут.');
      expect(usePolisStore.getState().artifacts.m1?.[0]?.name).toBe('a.md');
    });
  });

  it('empty vault shows the red emergency key stripe', () => {
    render(<MissionRail onNewMission={() => undefined} />);
    expect(screen.getByTitle('без ключів — Ollama')).toBeTruthy();
  });
});

describe('WS routing (room events)', () => {
  it('worker_delta and chat_message land in the store', () => {
    let handler: ((msg: { type: string; data: any }) => void) | undefined;
    registerPolisWsHandler((_ch, cb) => {
      handler = cb;
      return () => undefined;
    });
    handler!({ type: 'worker_delta', data: { mission_id: 'm1', node_id: 'a', delta: 'абв' } });
    handler!({ type: 'worker_delta', data: { mission_id: 'm1', node_id: 'a', delta: 'где' } });
    expect(usePolisStore.getState().transcripts['m1:a']).toBe('абвгде');

    handler!({
      type: 'chat_message',
      data: { mission_id: 'm1', message: { role: 'phantom', text: 'Готово.' } },
    });
    expect(usePolisStore.getState().chats.m1?.at(-1)?.text).toBe('Готово.');
    // operator echo from WS must not duplicate the optimistic append
    handler!({
      type: 'chat_message',
      data: { mission_id: 'm1', message: { role: 'operator', text: 'дубль' } },
    });
    expect(
      usePolisStore.getState().chats.m1?.filter((c) => c.text === 'дубль'),
    ).toHaveLength(0);
  });
});
