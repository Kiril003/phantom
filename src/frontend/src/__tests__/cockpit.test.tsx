/**
 * Ф4 «Кокпіт оператора» — тести чарунок і міграції стола.
 *
 * Перевіряємо доктрину, не лише рендер:
 * - мертве ядро → відмова СЛОВОМ, не нулі (Машина/Пристрої/Аудит);
 * - порожнеча → чесне слово («агенти мовчать», «жодного спареного
 *   пристрою», «журнал порожній»);
 * - слово «тривога» в копі активності ЗАБОРОНЕНЕ (Ф4: канал agent.stream
 *   несе активність агентів, інше слово зарезервоване за реальним
 *   джерелом);
 * - стіл «Кокпіт» мігрує зі старого пресета analytics+dialogue на пейн
 *   cockpit, але кастомний стіл із власним cockpit-пейном не чіпається.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, act, waitFor } from '@testing-library/react';

/* ── Мок WS: керований емітер каналів ─────────────────────────────────── */

type Handler = (msg: unknown) => void;
const channelHandlers = new Map<string, Handler[]>();
let mockConnected = true;

vi.mock('../services/websocket', () => ({
  wsClient: {
    get isConnected() {
      return mockConnected;
    },
    on: (channel: string, handler: Handler) => {
      const list = channelHandlers.get(channel) ?? [];
      list.push(handler);
      channelHandlers.set(channel, list);
      return () => {
        const cur = channelHandlers.get(channel) ?? [];
        channelHandlers.set(
          channel,
          cur.filter((h) => h !== handler),
        );
      };
    },
    onConnect: (_h: () => void) => () => {},
    onDisconnect: (_h: () => void) => () => {},
  },
}));

function emit(channel: string, msg: unknown): void {
  for (const h of channelHandlers.get(channel) ?? []) h(msg);
}

/* ── Мок cockpitApi: кероване джерело ─────────────────────────────────── */

const machineOk = {
  sampled_at_ms: Date.now(),
  cpu: { pct: 12.3, source: 'system_metrics_sampler (1 Гц)' },
  ram: { total: 16 * 1024 ** 3, used: 8 * 1024 ** 3, pct: 50.0 },
  disk: { total: 500 * 1024 ** 3, used: 100 * 1024 ** 3, pct: 20.0 },
  uptime: { host_s: 90_000, backend_s: 3_600 },
  listeners: {
    http: { host: '127.0.0.1', port: 8010 },
    tls: { state: 'не піднявся', port: 8443, bound: [] },
    mdns: { state: 'не оголошено' },
    ws_clients: 2,
  },
};

const fetchMachineMock = vi.fn();
const fetchAuditPageMock = vi.fn();
const fetchPairedDevicesMock = vi.fn();

vi.mock('../services/cockpitApi', () => ({
  fetchMachine: (...a: unknown[]) => fetchMachineMock(...a),
  fetchAuditPage: (...a: unknown[]) => fetchAuditPageMock(...a),
  fetchPairedDevices: (...a: unknown[]) => fetchPairedDevicesMock(...a),
}));

import { ActivityCell, eventWord } from '../components/cockpit/ActivityCell';
import { MachineCell } from '../components/cockpit/MachineCell';
import { DevicesCell } from '../components/cockpit/DevicesCell';
import { AuditCell } from '../components/cockpit/AuditCell';

beforeEach(() => {
  channelHandlers.clear();
  mockConnected = true;
  fetchMachineMock.mockReset();
  fetchAuditPageMock.mockReset();
  fetchPairedDevicesMock.mockReset();
});

afterEach(() => {
  cleanup();
});

/* ── eventWord ────────────────────────────────────────────────────────── */

describe('eventWord: слово події без вигадок', () => {
  it('бере перший осмислений рядок з відомих полів', () => {
    expect(eventWord({ goal: 'знайти дорогу' })).toBe('знайти дорогу');
    expect(eventWord({ intent: ' пише звіт ' })).toBe('пише звіт');
    expect(eventWord({ action_name: 'fs.read' })).toBe('fs.read');
  });

  it('нема слова — порожньо, не вигадка', () => {
    expect(eventWord({})).toBe('');
    expect(eventWord({ count: 7 })).toBe('');
  });

  it('довге слово обрізається до 140', () => {
    const long = 'а'.repeat(200);
    expect(eventWord({ text: long }).length).toBeLessThanOrEqual(140);
  });
});

/* ── Активність ───────────────────────────────────────────────────────── */

describe('Активність: живий потік agent.stream', () => {
  it('порожньо → «агенти мовчать»; слова «тривога» нема ніде в копі', () => {
    render(<ActivityCell />);
    expect(screen.getByText(/агенти мовчать/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/тривог/i);
  });

  it('подія каналу рендериться: час + тип + слово', () => {
    render(<ActivityCell />);
    act(() => {
      emit('agent.stream', {
        channel: 'agent.stream',
        type: 'task.started',
        data: { goal: 'скласти маршрут' },
        ts: Date.now(),
      });
    });
    // «task.started» живе і в чипі рядка, і в option фільтра — тому getAll.
    expect(screen.getAllByText('task.started').length).toBeGreaterThan(0);
    expect(screen.getByText('скласти маршрут')).toBeTruthy();
    expect(screen.queryByText(/агенти мовчать/)).toBeNull();
  });

  it('фільтр за типом ховає інші типи', async () => {
    render(<ActivityCell />);
    act(() => {
      emit('agent.stream', {
        channel: 'agent.stream',
        type: 'task.started',
        data: { goal: 'перший' },
        ts: Date.now(),
      });
      emit('agent.stream', {
        channel: 'agent.stream',
        type: 'action.completed',
        data: { action_name: 'fs.read' },
        ts: Date.now(),
      });
    });
    const select = screen.getByLabelText('фільтр за типом події') as HTMLSelectElement;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(select, { target: { value: 'task.started' } });
    expect(screen.getByText('перший')).toBeTruthy();
    expect(screen.queryByText('fs.read')).toBeNull();
  });
});

/* ── Машина ───────────────────────────────────────────────────────────── */

describe('Машина: числа лише з джерела', () => {
  it('мертве ядро → відмова словом, жодних відсотків', async () => {
    fetchMachineMock.mockResolvedValue({ ok: false, reason: 'unreachable' });
    render(<MachineCell />);
    await waitFor(() =>
      expect(screen.getByText(/ядро недоступне — числа не малюю/)).toBeTruthy(),
    );
    expect(document.body.textContent ?? '').not.toMatch(/\d+(\.\d+)?%/);
  });

  it('живе джерело → CPU/RAM/диск/слухачі зі словами джерела', async () => {
    fetchMachineMock.mockResolvedValue({ ok: true, data: machineOk });
    render(<MachineCell />);
    await waitFor(() => expect(screen.getByText('12.3%')).toBeTruthy());
    expect(screen.getByText('50.0%')).toBeTruthy();
    expect(screen.getByText('127.0.0.1:8010')).toBeTruthy();
    expect(screen.getByText(/не піднявся \(порт 8443\)/)).toBeTruthy();
    expect(screen.getByText(/станом на/)).toBeTruthy();
  });

  it('operator-права відсутні → слово, не нулі', async () => {
    fetchMachineMock.mockResolvedValue({ ok: false, reason: 'unauthorized' });
    render(<MachineCell />);
    await waitFor(() =>
      expect(screen.getByText(/потрібні operator-права/)).toBeTruthy(),
    );
  });
});

/* ── Пристрої ─────────────────────────────────────────────────────────── */

describe('Пристрої: реальний список або чесна порожнеча', () => {
  it('порожньо → «жодного спареного пристрою» + як спарувати', async () => {
    fetchPairedDevicesMock.mockResolvedValue({ ok: true, data: [] });
    render(<DevicesCell />);
    await waitFor(() =>
      expect(screen.getByText(/жодного спареного пристрою/)).toBeTruthy(),
    );
    expect(screen.getByText(/спарувати: Налаштування → Мобільний компаньйон/)).toBeTruthy();
  });

  it('рядок пристрою: ім’я, канал, останній зв’язок', async () => {
    fetchPairedDevicesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          device_name: 'Pixel власника',
          device_model: 'Pixel 8',
          platform: 'android',
          platform_version: '15',
          paired_at: new Date().toISOString(),
          last_seen_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          revoked_at: null,
          capabilities: [],
          online: false,
        },
      ],
    });
    render(<DevicesCell />);
    await waitFor(() => expect(screen.getByText('Pixel власника')).toBeTruthy());
    expect(screen.getByText(/останній зв’язок: 5 хв тому/)).toBeTruthy();
  });

  it('мертве ядро → відмова словом', async () => {
    fetchPairedDevicesMock.mockResolvedValue({ ok: false, reason: 'unreachable' });
    render(<DevicesCell />);
    await waitFor(() =>
      expect(screen.getByText(/ядро недоступне — список пристроїв не прочитати/)).toBeTruthy(),
    );
  });
});

/* ── Аудит ────────────────────────────────────────────────────────────── */

describe('Аудит: журнал з пагінацією', () => {
  it('порожній журнал → чесне слово', async () => {
    fetchAuditPageMock.mockResolvedValue({
      ok: true,
      data: { total: 0, entries: [], next_before_id: null },
    });
    render(<AuditCell />);
    await waitFor(() =>
      expect(screen.getByText(/журнал порожній — виконавець ще не записав/)).toBeTruthy(),
    );
  });

  it('рядки + «показати старіші» коли курсор є', async () => {
    fetchAuditPageMock.mockResolvedValue({
      ok: true,
      data: {
        total: 40,
        entries: [
          {
            id: 40,
            ts_ms: Date.now(),
            action_name: 'fs.read',
            intent: 'читає файл',
            status: 'ok',
            elapsed_ms: 12,
            task_id: 'chat-tool',
          },
        ],
        next_before_id: 40,
      },
    });
    render(<AuditCell />);
    await waitFor(() => expect(screen.getByText('fs.read')).toBeTruthy());
    expect(screen.getByText('ок')).toBeTruthy();
    expect(screen.getByText(/40 записів/)).toBeTruthy();
    expect(screen.getByText('показати старіші')).toBeTruthy();
  });

  it('мертве ядро → відмова словом', async () => {
    fetchAuditPageMock.mockResolvedValue({ ok: false, reason: 'unreachable' });
    render(<AuditCell />);
    await waitFor(() =>
      expect(screen.getByText(/ядро недоступне — журнал аудиту не прочитати/)).toBeTruthy(),
    );
  });
});

/* ── Міграція стола «Кокпіт» ──────────────────────────────────────────── */

describe('deskStore: міграція стола «Кокпіт» на пейн cockpit', () => {
  const STORAGE_KEY = 'phantom.desks.v1';

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.resetModules();
  });

  async function loadStore() {
    vi.resetModules();
    const mod = await import('../stores/deskStore');
    return mod.useDeskStore.getState();
  }

  it('старий збережений кокпіт (analytics+dialogue) → новий пресет', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        desks: [
          {
            id: 'cockpit',
            name: 'Кокпіт',
            panes: [
              { id: 'cockpit:analytics', kind: 'analytics', fraction: 0.5, mode: 'tile', home: 'grid', floatRect: null, z: 0 },
              { id: 'cockpit:dialogue', kind: 'dialogue', fraction: 0.5, mode: 'tile', home: 'grid', floatRect: null, z: 0 },
            ],
          },
        ],
        activeDeskId: 'cockpit',
      }),
    );
    const s = await loadStore();
    const cockpit = s.desks.find((d) => d.id === 'cockpit');
    expect(cockpit).toBeTruthy();
    expect(cockpit!.panes.map((p) => p.kind)).toEqual(['cockpit']);
  });

  it('кастомний кокпіт, що ВЖЕ має пейн cockpit — не чіпається', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        desks: [
          {
            id: 'cockpit',
            name: 'Кокпіт',
            panes: [
              { id: 'cockpit:cockpit', kind: 'cockpit', fraction: 0.7, mode: 'tile', home: 'grid', floatRect: null, z: 0 },
              { id: 'cockpit:dialogue', kind: 'dialogue', fraction: 0.3, mode: 'tile', home: 'grid', floatRect: null, z: 0 },
            ],
          },
        ],
        activeDeskId: 'cockpit',
      }),
    );
    const s = await loadStore();
    const cockpit = s.desks.find((d) => d.id === 'cockpit');
    expect(cockpit!.panes.map((p) => p.kind).sort()).toEqual(['cockpit', 'dialogue']);
    expect(cockpit!.panes.find((p) => p.kind === 'cockpit')!.fraction).toBeCloseTo(0.7);
  });

  it('свіжий стан без сховища: кокпіт — один пейн cockpit', async () => {
    const s = await loadStore();
    const cockpit = s.desks.find((d) => d.id === 'cockpit');
    expect(cockpit!.panes.map((p) => p.kind)).toEqual(['cockpit']);
  });
});
