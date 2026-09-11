/**
 * Стор печі — кеш знімка, і саме це тут перевіряється.
 *
 * Дві поведінки, на яких найлегше збрехати:
 *
 * 1. ЗАМІНА, не злиття. Знімок приходить повним; якщо з нового зник `pack`
 *    або `outcome`, вони мусять зникнути й у сторі. Merge залишив би на
 *    склі спечений пакет від попередньої роботи — «зелене, що не вміє
 *    почервоніти» в чистому вигляді.
 * 2. `countersChangedAt` — єдине, що стор рахує сам, і рахує саме для того,
 *    щоб «лічильники не змінюються 40 с» було правдою й після F5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BakeSnapshot, BakeStage } from '@shared/types';

const current = vi.fn();
const last = vi.fn();

vi.mock('../../services/bakeApi', () => ({
  bakeApi: {
    scopes: vi.fn(),
    capability: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    current: () => current(),
    last: () => last(),
  },
}));

import { isTerminal, useBakeStore } from '../bakeStore';

const AT = '2026-09-05T10:00:00.000Z';

function snap(over: Partial<BakeSnapshot> = {}): BakeSnapshot {
  return {
    job_id: 'j1',
    scope_id: 'kyiv',
    label_ua: 'Київ',
    stage: 'baking' as BakeStage,
    started_at: AT,
    updated_at: AT,
    download: {
      bytes_done: 0,
      bytes_total: null,
      resumed_from_bytes: 0,
      rate_bps: null,
      source_last_modified: null,
      from_cache: false,
    },
    verify: { bytes_hashed: 0, bytes_total: 0 },
    bake: {
      nodes_seen: 0,
      nodes_kept: null,
      ways_seen: 100,
      ways_kept: 90,
      rows_written: 180,
      cells: 12,
      elapsed_s: 30,
      ram_available_pct: 55,
      input_bytes: 918_223_872,
      output_bytes: null,
      index_bytes: null,
    },
    outcome: null,
    pack: null,
    previous: null,
    guard: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useBakeStore.setState({
    snapshot: null,
    countersChangedAt: 0,
    countersFp: '',
    catalog: null,
    capability: null,
    error: null,
    busy: false,
    seenJobId: null,
  });
});

describe('applySnapshot заміняє знімок, а не зливає його', () => {
  it('поле, якого немає в новому знімку, зникає зі стора', () => {
    const s = useBakeStore.getState();
    s.applySnapshot(
      snap({
        stage: 'done',
        pack: {
          pack_id: 'kyiv',
          bytes: 1,
          format_version: 2,
          sha256: 'a',
          way_count: 1,
          row_count: 1,
          cell_count: 1,
          baked_at: AT,
        },
      }),
    );
    expect(useBakeStore.getState().snapshot?.pack).not.toBeNull();

    // Наступна робота пакета ще не має. Merge залишив би тут попередній.
    s.applySnapshot(snap({ job_id: 'j2', stage: 'baking', pack: null }));

    expect(useBakeStore.getState().snapshot?.pack).toBeNull();
    expect(useBakeStore.getState().snapshot?.job_id).toBe('j2');
  });

  it('null очищає геть усе', () => {
    const s = useBakeStore.getState();
    s.applySnapshot(snap());
    s.applySnapshot(null);

    expect(useBakeStore.getState().snapshot).toBeNull();
    expect(useBakeStore.getState().countersChangedAt).toBe(0);
  });
});

describe('countersChangedAt — годинник «чи взагалі щось рухається»', () => {
  it('перше читання після F5 бере час бекенда, а не час монтування', () => {
    // Робота вже сорок хвилин мовчить. Якби годинник стартував із mount,
    // сорокахвилинна тиша виглядала б щойно живою.
    const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    useBakeStore.getState().applySnapshot(snap({ updated_at: stale }));

    expect(useBakeStore.getState().countersChangedAt).toBe(Date.parse(stale));
  });

  it('зрушений лічильник переставляє годинник на «зараз»', () => {
    const s = useBakeStore.getState();
    s.applySnapshot(snap({ updated_at: new Date(Date.now() - 60_000).toISOString() }));
    const before = useBakeStore.getState().countersChangedAt;

    s.applySnapshot(snap({ bake: { ...snap().bake, ways_kept: 91 } }));

    expect(useBakeStore.getState().countersChangedAt).toBeGreaterThan(before);
  });

  it('новий знімок із тими самими лічильниками годинник НЕ чіпає', () => {
    const s = useBakeStore.getState();
    s.applySnapshot(snap({ updated_at: new Date(Date.now() - 60_000).toISOString() }));
    const before = useBakeStore.getState().countersChangedAt;

    // Бекенд пише `updated_at` щосекунди, а піч стоїть. Саме цей випадок
    // і робить `updated_at` непридатним як єдиний свідок руху.
    s.applySnapshot(snap({ updated_at: new Date().toISOString() }));

    expect(useBakeStore.getState().countersChangedAt).toBe(before);
  });
});

describe('refresh — правда з бекенда, з падінням на /last', () => {
  it('порожній /current читає /last, щоб завершена робота не зникла', async () => {
    current.mockResolvedValue(null);
    last.mockResolvedValue(snap({ stage: 'done' }));

    await useBakeStore.getState().refresh();

    expect(useBakeStore.getState().snapshot?.stage).toBe('done');
    expect(isTerminal(useBakeStore.getState().snapshot)).toBe(true);
  });

  it('живий /current до /last не звертається', async () => {
    current.mockResolvedValue(snap());
    last.mockResolvedValue(null);

    await useBakeStore.getState().refresh();

    expect(last).not.toHaveBeenCalled();
    expect(isTerminal(useBakeStore.getState().snapshot)).toBe(false);
  });

  it('падіння бекенда лишає пояснення, а не мовчазний нуль', async () => {
    current.mockRejectedValue(Object.assign(new Error('Unknown error'), { status: 503 }));

    await useBakeStore.getState().refresh();

    expect(useBakeStore.getState().error).toBe('Бекенд відмовив (HTTP 503) і не пояснив чому.');
  });
});

describe('acknowledge — завершена робота гасне лише коли її побачили', () => {
  it('запамʼятовує job_id, і він переживає перезавантаження', () => {
    const s = useBakeStore.getState();
    s.applySnapshot(snap({ stage: 'done' }));
    s.acknowledge();

    expect(useBakeStore.getState().seenJobId).toBe('j1');
    expect(localStorage.getItem('phantom.bake.seenOutcome.v1')).toBe('j1');
  });
});
