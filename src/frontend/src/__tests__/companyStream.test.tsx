/**
 * «Компанія» мусить бути потоком, а не знімком.
 *
 * Виміряна проблема: ядро оголошує делеговане в канал `background_events`
 * (agent/kernel/runtime.py:531), а підписників на ньому не було жодного —
 * лише рядок у тип-юніоні `WSChannel`. Пейн читав список один раз на
 * монтуванні, тож людина делегувала роботу і не бачила її ніде, доки не
 * тиснула «оновити».
 *
 * Тут перевіряється не рендер, а доктрина:
 * - делеговане зʼявляється САМЕ, і саме з потоку (лічильник listTasks не
 *   зрушив — отже, це не прихований перезапит);
 * - у рядок іде лише те, що приїхало в події; про незнайомий прогін рядок
 *   не вигадується;
 * - обрив і порожнеча — різні стани, і обидва названі вголос; застиглий
 *   знімок не має права виглядати свіжим.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

/* ── Мок WS: керований емітер каналів ─────────────────────────────────── */

type Handler = (msg: unknown) => void;
const channelHandlers = new Map<string, Handler[]>();
let connectHandlers: Array<() => void> = [];
let disconnectHandlers: Array<() => void> = [];
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
    onConnect: (h: () => void) => {
      connectHandlers.push(h);
      return () => {
        connectHandlers = connectHandlers.filter((x) => x !== h);
      };
    },
    onDisconnect: (h: () => void) => {
      disconnectHandlers.push(h);
      return () => {
        disconnectHandlers = disconnectHandlers.filter((x) => x !== h);
      };
    },
  },
}));

function emit(channel: string, msg: unknown): void {
  for (const h of [...(channelHandlers.get(channel) ?? [])]) h(msg);
}

/* ── Моки джерел пейна ────────────────────────────────────────────────── */

const listTasksMock = vi.fn();
const statusMock = vi.fn();

vi.mock('../services/agentApi', () => ({
  agentApi: {
    listTasks: (...a: unknown[]) => listTasksMock(...a),
    status: (...a: unknown[]) => statusMock(...a),
    stop: vi.fn(),
    intervene: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getReport: vi.fn(),
    audit: vi.fn(),
  },
}));

const requestMock = vi.fn();
vi.mock('../services/api', () => ({
  request: (...a: unknown[]) => requestMock(...a),
}));

import type { WSMessage } from '../services/websocket';
import CompanyPane from '../components/desk/CompanyPane';
import { applyBackgroundEvent, freshnessWord } from '../components/desk/companyStream';

/** Подія каналу в тій формі, у якій її ліпить вузол:
 *  api/websocket_hub.py:77 — {channel, type, data, ts}. */
function bgEvent(type: string, data: Record<string, unknown>): WSMessage {
  return { channel: 'background_events', type, data, ts: Date.parse('2026-08-30T09:41:00Z') };
}

const DELEGATED_START = bgEvent('task.started', {
  task_id: 'child-1',
  goal: 'перевірити звіт по кварталу',
  track: 'background',
  parent_task_id: 'parent-9',
  subagent_role: 'reviewer',
  delegation_depth: 1,
});

beforeEach(() => {
  channelHandlers.clear();
  connectHandlers = [];
  disconnectHandlers = [];
  mockConnected = true;
  listTasksMock.mockReset();
  statusMock.mockReset();
  requestMock.mockReset();
  listTasksMock.mockResolvedValue({ tasks: [] });
  requestMock.mockResolvedValue({ entries: [] });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/* ── Потік ────────────────────────────────────────────────────────────── */

describe('Компанія: делеговане приходить потоком', () => {
  it('рядок зʼявляється сам, без «оновити» і без перезапиту', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());
    expect(listTasksMock).toHaveBeenCalledTimes(1);

    act(() => {
      emit('background_events', DELEGATED_START);
    });

    expect(screen.getByText('перевірити звіт по кварталу')).toBeTruthy();
    expect(screen.queryByText('Прогонів ще не було')).toBeNull();
    // Список не перечитувався: рядок приїхав каналом, а не HTTP-запитом.
    expect(listTasksMock).toHaveBeenCalledTimes(1);
  });

  it('батько і роль малюються з події, і тільки з неї', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());

    act(() => {
      emit('background_events', DELEGATED_START);
    });
    expect(document.body.textContent ?? '').toMatch(/делеговано/);
    expect(document.body.textContent ?? '').toMatch(/роль reviewer/);
    expect(document.body.textContent ?? '').toMatch(/від parent-9/);
  });

  it('фоновий прогін без батька «делегованим» не зветься', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());

    act(() => {
      emit(
        'background_events',
        bgEvent('task.started', {
          task_id: 'own-1',
          goal: 'прибрати тимчасові файли',
          track: 'background',
        }),
      );
    });
    expect(screen.getByText('прибрати тимчасові файли')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/делеговано/);
  });

  it('термінальна подія перефарбовує рядок словом', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());

    act(() => {
      emit('background_events', DELEGATED_START);
    });
    expect(screen.getByText('виконує')).toBeTruthy();

    act(() => {
      emit(
        'background_events',
        bgEvent('task.completed', { task_id: 'child-1', track: 'background', summary: 'ок' }),
      );
    });
    expect(screen.getByText('завершено')).toBeTruthy();
    expect(screen.queryByText('виконує')).toBeNull();
  });

  it('подія про незнайомий прогін рядка не вигадує', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());

    act(() => {
      emit(
        'background_events',
        bgEvent('task.completed', { task_id: 'ghost-1', track: 'background' }),
      );
    });
    // Цілі нам ніхто не називав — тож у списку нічого не зʼявилось.
    expect(screen.getByText('Прогонів ще не було')).toBeTruthy();
  });
});

/* ── Чесність стану ───────────────────────────────────────────────────── */

describe('Компанія: обрив і порожнеча — різні стани', () => {
  it('канал тримається → слово про потік, без слова про обрив', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());
    expect(screen.getByText(/потік підключено/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/обірвано/);
  });

  it('канал обірвано → знімок названо застиглим, а не свіжим', async () => {
    mockConnected = false;
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText(/потік обірвано/)).toBeTruthy());
    expect(screen.getByText(/показане застигло на/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/потік підключено/);
  });

  it('порожньо І обірвано → сказано обидва, не одне замість другого', async () => {
    mockConnected = false;
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText('Прогонів ще не було')).toBeTruthy());
    expect(screen.getByText(/новий прогін сюди сам не дійде/)).toBeTruthy();
  });

  it('обрив посеред сеансу перемикає слово без перемонтування', async () => {
    render(<CompanyPane />);
    await waitFor(() => expect(screen.getByText(/потік підключено/)).toBeTruthy());

    act(() => {
      mockConnected = false;
      disconnectHandlers.forEach((h) => h());
    });
    expect(screen.getByText(/потік обірвано/)).toBeTruthy();
  });
});

/* ── Чиста функція: жодних вигадок ────────────────────────────────────── */

describe('applyBackgroundEvent: у рядок іде лише те, що було в події', () => {
  it('task.started без цілі не вигадує цілі', () => {
    const patch = applyBackgroundEvent(null, bgEvent('task.started', { task_id: 'x' }));
    expect(patch.tasks?.[0]).toMatchObject({
      id: 'x',
      goal: '',
      status: 'running',
      track: 'background',
      error: null,
      finished_at: null,
    });
  });

  it('спостережні події списку не чіпають', () => {
    const prev = [
      {
        id: 'x',
        goal: 'ціль',
        status: 'running' as const,
        track: 'background' as const,
        paused_reason: null,
        error: null,
        created_at: '2026-08-30T09:00:00.000Z',
        finished_at: null,
      },
    ];
    const patch = applyBackgroundEvent(
      prev,
      bgEvent('substate.changed', { task_id: 'x', substate: 'thinking' }),
    );
    expect(patch.tasks).toBeNull();
    expect(patch.needsReconcile).toBe(false);
  });

  it('термінальна подія про незнайомий прогін просить звірки, а не малює', () => {
    const patch = applyBackgroundEvent([], bgEvent('task.failed', { task_id: 'ghost' }));
    expect(patch.tasks).toBeNull();
    expect(patch.needsReconcile).toBe(true);
  });

  it('слово свіжості розрізняє обрив, потік і відсутність знімка', () => {
    const at = new Date('2026-08-30T09:41:00Z');
    expect(freshnessWord({ connected: false, lastEventAt: null, loadedAt: null })).toMatch(
      /обірвано · знімка ще не було/,
    );
    expect(freshnessWord({ connected: false, lastEventAt: at, loadedAt: at })).toMatch(
      /обірвано · показане застигло/,
    );
    expect(freshnessWord({ connected: true, lastEventAt: at, loadedAt: at })).toMatch(
      /потік · остання подія/,
    );
  });
});
