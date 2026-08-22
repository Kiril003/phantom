import { create } from 'zustand';

/**
 * deskStore — двигун столів (Ф1 майстерплану, §3).
 *
 * Стіл (workspace) = іменована сітка пейнів на весь виміряний viewport —
 * не клітка 1024×600. Пейн живе у трьох агрегатних станах: плитка в сітці
 * (tile), вільне вікно (float), повний екран (full). Плитки діляться
 * частками одного ряду; розкладка нормалізує частки по сумі, тож відліт
 * плитки у вільне вікно чесно віддає її місце сусідам, а повернення —
 * відновлює її частку.
 */

export type PaneKind = 'map' | 'dialogue' | 'company' | 'analytics' | 'settings';
export type PaneMode = 'tile' | 'float' | 'full';

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeskPane {
  /** Унікальний в межах стола: `${deskId}:${kind}`. */
  id: string;
  kind: PaneKind;
  /** Частка серед плиток стола; розкладка ділить по сумі часток плиток. */
  fraction: number;
  mode: PaneMode;
  /**
   * Дім пейна: grid — має місце в сітці, закриття вільного вікна повертає
   * його в плитку; loose — існує лише вікном, закриття прибирає зі стола.
   */
  home: 'grid' | 'loose';
  /** Прямокутник вільного вікна в координатах поверхні стола. */
  floatRect: PaneRect | null;
  /** Порядок вільних вікон (вище — ближче). */
  z: number;
}

export interface Desk {
  id: string;
  /** Слово-назва: стан несе слово. */
  name: string;
  panes: DeskPane[];
}

/** Менше ніж 12% ряду плитка не буває — інакше сплітер зачиняє її в нуль. */
export const MIN_FRACTION = 0.12;

const STORAGE_KEY = 'phantom.desks.v1';

function gridPane(deskId: string, kind: PaneKind, fraction: number): DeskPane {
  return {
    id: `${deskId}:${kind}`,
    kind,
    fraction,
    mode: 'tile',
    home: 'grid',
    floatRect: null,
    z: 0,
  };
}

/**
 * Столи-пресети. Persisted-стан власника має пріоритет; пресет, якого ще
 * нема в сховищі (нова версія додала стіл), домерджується на своє місце.
 */
function presetDesks(): Desk[] {
  return [
    {
      id: 'theatre',
      name: 'Театр',
      panes: [gridPane('theatre', 'map', 2 / 3), gridPane('theatre', 'dialogue', 1 / 3)],
    },
    {
      id: 'cockpit',
      name: 'Кокпіт',
      panes: [gridPane('cockpit', 'analytics', 1 / 2), gridPane('cockpit', 'dialogue', 1 / 2)],
    },
    {
      id: 'company',
      name: 'Компанія',
      panes: [gridPane('company', 'company', 1)],
    },
  ];
}

const KNOWN_KINDS: PaneKind[] = ['map', 'dialogue', 'company', 'analytics', 'settings'];
const KNOWN_MODES: PaneMode[] = ['tile', 'float', 'full'];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeRect(raw: unknown): PaneRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PaneRect>;
  if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function sanitizePane(raw: unknown, deskId: string): DeskPane | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<DeskPane>;
  if (!p.kind || !KNOWN_KINDS.includes(p.kind)) return null;
  const mode = p.mode && KNOWN_MODES.includes(p.mode) ? p.mode : 'tile';
  return {
    id: typeof p.id === 'string' && p.id ? p.id : `${deskId}:${p.kind}`,
    kind: p.kind,
    fraction: isFiniteNumber(p.fraction) && p.fraction > 0 ? p.fraction : 1,
    mode,
    home: p.home === 'loose' ? 'loose' : 'grid',
    floatRect: sanitizeRect(p.floatRect),
    z: isFiniteNumber(p.z) ? p.z : 0,
  };
}

function sanitizeDesk(raw: unknown): Desk | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<Desk>;
  if (typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name) return null;
  const panes = Array.isArray(d.panes)
    ? d.panes.map((p) => sanitizePane(p, d.id as string)).filter((p): p is DeskPane => p !== null)
    : [];
  return { id: d.id, name: d.name, panes };
}

interface PersistedShape {
  desks: Desk[];
  activeDeskId: string;
}

function loadPersisted(): PersistedShape {
  const presets = presetDesks();
  const fallback: PersistedShape = { desks: presets, activeDeskId: presets[0].id };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    const stored = Array.isArray(parsed.desks)
      ? parsed.desks.map(sanitizeDesk).filter((d): d is Desk => d !== null)
      : [];
    if (stored.length === 0) return fallback;
    // Домердж пресетів, яких у сховищі ще нема (у порядку пресетів).
    const merged = [...stored];
    for (const preset of presets) {
      if (!merged.some((d) => d.id === preset.id)) merged.push(preset);
    }
    const activeDeskId =
      typeof parsed.activeDeskId === 'string' && merged.some((d) => d.id === parsed.activeDeskId)
        ? parsed.activeDeskId
        : merged[0].id;
    return { desks: merged, activeDeskId };
  } catch {
    return fallback;
  }
}

function persist(desks: Desk[], activeDeskId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ desks, activeDeskId }));
  } catch {
    /* quota — ignore */
  }
}

function maxZ(desks: Desk[]): number {
  let z = 0;
  for (const d of desks) for (const p of d.panes) z = Math.max(z, p.z);
  return z;
}

/** Стартовий прямокутник вільного вікна — від справжнього viewport. */
function defaultFloatRect(): PaneRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
  const width = Math.min(560, Math.max(320, Math.round(vw * 0.45)));
  const height = Math.min(520, Math.max(260, Math.round(vh * 0.6)));
  return {
    x: Math.max(0, Math.round((vw - width) / 2)),
    y: Math.max(0, Math.round((vh - height) / 3)),
    width,
    height,
  };
}

interface DeskStoreState {
  desks: Desk[];
  activeDeskId: string;
  zCounter: number;

  activeDesk: () => Desk;
  setActiveDesk: (id: string) => void;

  /** Перевести пейн у режим tile / float / full. */
  setPaneMode: (deskId: string, paneId: string, mode: PaneMode) => void;
  setFloatRect: (deskId: string, paneId: string, rect: PaneRect) => void;
  /** Підняти вільне вікно нагору. */
  focusPane: (deskId: string, paneId: string) => void;
  /**
   * Сплітер: виставити частки двох сусідніх плиток (вже обчислені
   * розкладкою; сума пари зберігається на боці розкладки).
   */
  setSplit: (deskId: string, aId: string, aFraction: number, bId: string, bFraction: number) => void;
  /**
   * Відкрити пейн на активному столі: наявний — сфокусувати, відсутній —
   * додати вільним вікном (home: loose).
   */
  openPane: (kind: PaneKind) => void;
  /** Закрити вільне вікно: grid-пейн вертається в плитку, loose — зникає. */
  closePane: (deskId: string, paneId: string) => void;
}

function updateDesk(desks: Desk[], deskId: string, fn: (d: Desk) => Desk): Desk[] {
  return desks.map((d) => (d.id === deskId ? fn(d) : d));
}

function updatePane(desk: Desk, paneId: string, fn: (p: DeskPane) => DeskPane): Desk {
  return { ...desk, panes: desk.panes.map((p) => (p.id === paneId ? fn(p) : p)) };
}

export const useDeskStore = create<DeskStoreState>((set, get) => {
  const initial = loadPersisted();
  return {
    desks: initial.desks,
    activeDeskId: initial.activeDeskId,
    zCounter: maxZ(initial.desks) + 1,

    activeDesk: () => {
      const s = get();
      return s.desks.find((d) => d.id === s.activeDeskId) ?? s.desks[0];
    },

    setActiveDesk: (id) =>
      set((s) => {
        if (!s.desks.some((d) => d.id === id) || s.activeDeskId === id) return s;
        persist(s.desks, id);
        return { activeDeskId: id };
      }),

    setPaneMode: (deskId, paneId, mode) =>
      set((s) => {
        const z = s.zCounter + 1;
        const desks = updateDesk(s.desks, deskId, (d) =>
          updatePane(d, paneId, (p) => ({
            ...p,
            mode,
            z,
            floatRect: mode === 'float' ? (p.floatRect ?? defaultFloatRect()) : p.floatRect,
          })),
        );
        persist(desks, s.activeDeskId);
        return { desks, zCounter: z };
      }),

    setFloatRect: (deskId, paneId, rect) =>
      set((s) => {
        const desks = updateDesk(s.desks, deskId, (d) =>
          updatePane(d, paneId, (p) => ({ ...p, floatRect: rect })),
        );
        persist(desks, s.activeDeskId);
        return { desks };
      }),

    focusPane: (deskId, paneId) =>
      set((s) => {
        const desk = s.desks.find((d) => d.id === deskId);
        const pane = desk?.panes.find((p) => p.id === paneId);
        if (!pane || pane.z === s.zCounter) return s;
        const z = s.zCounter + 1;
        const desks = updateDesk(s.desks, deskId, (d) =>
          updatePane(d, paneId, (p) => ({ ...p, z })),
        );
        return { desks, zCounter: z };
      }),

    setSplit: (deskId, aId, aFraction, bId, bFraction) =>
      set((s) => {
        const desks = updateDesk(s.desks, deskId, (d) => ({
          ...d,
          panes: d.panes.map((p) =>
            p.id === aId
              ? { ...p, fraction: Math.max(MIN_FRACTION, aFraction) }
              : p.id === bId
                ? { ...p, fraction: Math.max(MIN_FRACTION, bFraction) }
                : p,
          ),
        }));
        persist(desks, s.activeDeskId);
        return { desks };
      }),

    openPane: (kind) =>
      set((s) => {
        const desk = s.desks.find((d) => d.id === s.activeDeskId);
        if (!desk) return s;
        const existing = desk.panes.find((p) => p.kind === kind);
        const z = s.zCounter + 1;
        if (existing) {
          const desks = updateDesk(s.desks, desk.id, (d) =>
            updatePane(d, existing.id, (p) => ({ ...p, z })),
          );
          return { desks, zCounter: z };
        }
        const pane: DeskPane = {
          id: `${desk.id}:${kind}`,
          kind,
          fraction: 1,
          mode: 'float',
          home: 'loose',
          floatRect: defaultFloatRect(),
          z,
        };
        const desks = updateDesk(s.desks, desk.id, (d) => ({ ...d, panes: [...d.panes, pane] }));
        persist(desks, s.activeDeskId);
        return { desks, zCounter: z };
      }),

    closePane: (deskId, paneId) =>
      set((s) => {
        const desk = s.desks.find((d) => d.id === deskId);
        const pane = desk?.panes.find((p) => p.id === paneId);
        if (!desk || !pane) return s;
        const desks =
          pane.home === 'loose'
            ? updateDesk(s.desks, deskId, (d) => ({
                ...d,
                panes: d.panes.filter((p) => p.id !== paneId),
              }))
            : updateDesk(s.desks, deskId, (d) =>
                updatePane(d, paneId, (p) => ({ ...p, mode: 'tile' })),
              );
        persist(desks, s.activeDeskId);
        return { desks };
      }),
  };
});
