import { create } from 'zustand';
import type { BakeCapability, BakeScopesResponse, BakeSnapshot, BakeStage } from '@shared/types';
import { bakeApi } from '../services/bakeApi';

/**
 * Кеш знімка печі — саме кеш, а не друга копія правди. Своєї думки не має:
 * знімок приходить повним і ЗАМІНЯЄ попередній, тож перезавантаження нічого
 * не губить. Єдине своє — `countersChangedAt`: відповідь на «чи взагалі щось
 * рухається», якої в знімку немає (бекенд може писати `updated_at`
 * щосекунди, поки лічильники стоять).
 */
const SEEN_KEY = 'phantom.bake.seenOutcome.v1';
const TERMINAL: readonly BakeStage[] = ['done', 'failed', 'cancelled'];

export const isTerminal = (s: BakeSnapshot | null): boolean =>
  s != null && TERMINAL.includes(s.stage);

/** Відбиток лічильників: усе, що мусить стрибнути, коли робота йде. */
const fingerprint = (s: BakeSnapshot): string =>
  [s.stage, s.download.bytes_done, s.verify.bytes_hashed, s.bake.nodes_seen,
    s.bake.ways_seen, s.bake.ways_kept, s.bake.rows_written, s.bake.cells].join('|');

/** Приватний режим кидає на самому доступі — значок тоді просто не памʼятає. */
const safeLocal = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

/** Помилка бекенда людською мовою — або чесне зізнання, що пояснення не було. */
function explain(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : '';
  if (msg && msg !== 'Unknown error') return msg;
  return status ? `Бекенд відмовив (HTTP ${status}) і не пояснив чому.` : 'Бекенд не відповів.';
}

interface BakeState {
  snapshot: BakeSnapshot | null;
  countersChangedAt: number;
  countersFp: string;
  catalog: BakeScopesResponse | null;
  capability: BakeCapability | null;
  error: string | null;
  busy: boolean;
  /** job_id завершеної роботи, яку людина вже бачила: значок не спливає вічно. */
  seenJobId: string | null;
  applySnapshot: (next: BakeSnapshot | null) => void;
  refresh: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  start: (scopeId: string, refreshSource?: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  acknowledge: () => void;
}

export const useBakeStore = create<BakeState>((set, get) => ({
  snapshot: null,
  countersChangedAt: 0,
  countersFp: '',
  catalog: null,
  capability: null,
  error: null,
  busy: false,
  seenJobId: safeLocal(() => localStorage.getItem(SEEN_KEY), null),

  applySnapshot: (next) => {
    if (!next) return set({ snapshot: null, countersFp: '', countersChangedAt: 0 });
    const fp = fingerprint(next);
    // Нова робота або перше читання після перезавантаження: годинник
    // «нічого не рухається» починається від часу бекенда, а не від mount —
    // інакше сорокахвилинна робота після F5 виглядала б щойно живою.
    const fresh = get().snapshot?.job_id !== next.job_id;
    const changedAt = fresh
      ? Date.parse(next.updated_at) || Date.now()
      : fp !== get().countersFp
        ? Date.now()
        : get().countersChangedAt;
    set({ snapshot: next, countersFp: fp, countersChangedAt: changedAt });
  },

  refresh: async () => {
    try {
      const current = await bakeApi.current();
      get().applySnapshot(current ?? (await bakeApi.last()));
      set({ error: null });
    } catch (err) {
      set({ error: explain(err) });
    }
  },

  loadCatalog: async () => {
    try {
      set({ catalog: await bakeApi.scopes(), error: null });
    } catch {
      // `/bake/scopes` міг іще не приїхати — тоді стеля машини лишається
      // єдиним, що ми знаємо, і вибір їде з неї БЕЗ розмірів і без хоста.
      try {
        set({ capability: await bakeApi.capability() });
      } catch (err) {
        set({ error: explain(err) });
      }
    }
  },

  start: async (scopeId, refreshSource = false) => {
    set({ busy: true, error: null });
    try {
      get().applySnapshot(await bakeApi.start({ scope_id: scopeId, refresh_source: refreshSource }));
    } catch (err) {
      // 409 — робота вже йде; знімок із бекенда покаже яка саме.
      set({ error: explain(err) });
      await get().refresh();
    } finally {
      set({ busy: false });
    }
  },

  cancel: async () => {
    set({ busy: true });
    try {
      // Без аргументу НАВМИСНО: бекенд бере `keep_download=None` як «спитай
      // налаштування власника» (`bake_keep_source_extracts`). Передати сюди
      // `true` означало б зробити ту гілку недосяжною — і перемикач у
      // Налаштуваннях › Мапа не вимикав би нічого. Що саме сталося з витягом,
      // каже `outcome.detail_ua`, а не ми.
      get().applySnapshot(await bakeApi.cancel());
    } catch (err) {
      set({ error: explain(err) });
    } finally {
      set({ busy: false });
    }
  },

  acknowledge: () => {
    const id = get().snapshot?.job_id ?? null;
    if (!id) return;
    safeLocal(() => localStorage.setItem(SEEN_KEY, id), undefined);
    set({ seenJobId: id });
  },
}));
