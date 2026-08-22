import { create } from 'zustand';

export type OverlayName = 'terminal' | 'wardriving' | 'camera' | 'apps' | 'standing_orders';

// ─── OperatorLayout v3 — focused-agent / toast / chrome slices ────────────
//
// These three slices live alongside the overlay-window state because the
// surface they drive (Roster, ToastRail, chrome handles) is rendered inside
// every layout — we don't want a parallel store just for that.

export type FocusedAgent =
  | 'foreground'
  | 'background'
  | 'standing_orders'
  | 'proactive'
  | 'council'
  | 'horizons'
  | 'org_chart'
  | 'team_chat';

export type ToastKind = 'error' | 'warn' | 'info' | 'success';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  ts: number;
}

export type ChromeKey = 'statusBar' | 'roster' | 'hud' | 'toolbar';

export interface ChromeState {
  /** true = compact (top-mounted) or collapsed (bottom-mounted). */
  statusBar: boolean;
  roster: boolean;
  hud: boolean;
  toolbar: boolean;
}

// Bumped to v2 so first-run after the discoverability fix lands the new
// default (HUD expanded so Stop/Side-Channel/Vault are visible without
// hunting). Existing v1 localStorage rows are ignored.
const CHROME_KEY = 'phantom.chrome.v3';
const CHROME_DEFAULT: ChromeState = {
  statusBar: false,
  roster: true,
  // Розгорнуті: тулбар — це головна навігація продукту, а HUD тримає
  // Stop і доступ до сховища. Згорнуті за замовчуванням, вони читались
  // як «кнопки зникли».
  hud: false,
  toolbar: false,
};

function loadChromePersisted(): ChromeState {
  if (typeof localStorage === 'undefined') return CHROME_DEFAULT;
  try {
    const raw = localStorage.getItem(CHROME_KEY);
    if (!raw) return CHROME_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<ChromeState>;
    return { ...CHROME_DEFAULT, ...parsed };
  } catch {
    return CHROME_DEFAULT;
  }
}

function persistChrome(state: ChromeState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CHROME_KEY, JSON.stringify(state));
    localStorage.setItem('phantom.chrome.v1', JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

// Клітки 1024×600 більше нема (Ф1): межі оверлеїв — справжній viewport.
// Функції, а не константи: вікно живе, viewport міняється. Fallback —
// лише для середовищ без window (тести).
function frameW(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1024;
}
function frameH(): number {
  return typeof window !== 'undefined' ? window.innerHeight : 600;
}
const TOOLBAR_CLEARANCE = 64;
const MIN_W = 280;
const MIN_H = 200;

/** Compact overlay default: centered-ish, fits 7" screens comfortably. */
function defaultRectFor(id: OverlayName): WindowRect {
  // Phase 22 — Apps grid hosts every launcher (12 tiles in 3 sections) so it
  // gets a roomier default than the other compact overlays. Other windows keep
  // the original 360×420 phase-3 footprint.
  if (id === 'apps') {
    const width = 720;
    const height = 460;
    return {
      x: clampX(Math.round((frameW() - width) / 2), width),
      y: clampY(Math.round((frameH() - TOOLBAR_CLEARANCE - height) / 2), height),
      width,
      height,
    };
  }
  const width = 360;
  const height = 420;
  const baseX = Math.round((frameW() - width) / 2);
  const baseY = Math.round((frameH() - TOOLBAR_CLEARANCE - height) / 2);
  const order: OverlayName[] = ['terminal', 'wardriving', 'camera', 'apps'];
  const offset = order.indexOf(id);
  return {
    x: clampX(baseX + offset * 18, width),
    y: clampY(baseY + offset * 14, height),
    width,
    height,
  };
}

function clampX(x: number, w: number): number {
  return Math.max(0, Math.min(frameW() - w, x));
}
function clampY(y: number, h: number): number {
  return Math.max(0, Math.min(frameH() - TOOLBAR_CLEARANCE - h, y));
}
function clampRect(rect: WindowRect): WindowRect {
  const width = Math.max(MIN_W, Math.min(frameW(), rect.width));
  const height = Math.max(MIN_H, Math.min(frameH() - TOOLBAR_CLEARANCE, rect.height));
  return { x: clampX(rect.x, width), y: clampY(rect.y, height), width, height };
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends WindowRect {
  id: OverlayName;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  z: number;
  /** Stored rect before maximize, so we can restore it. */
  preMaxRect: WindowRect | null;
}

interface UIStoreState {
  windows: Record<OverlayName, WindowState>;
  zCounter: number;

  isOpen: (name: OverlayName) => boolean;
  openOverlay: (name: OverlayName) => void;
  closeOverlay: (name: OverlayName) => void;
  toggleOverlay: (name: OverlayName) => void;
  closeAll: () => void;

  setRect: (name: OverlayName, rect: Partial<WindowRect>) => void;
  minimize: (name: OverlayName) => void;
  maximize: (name: OverlayName) => void;
  restore: (name: OverlayName) => void;
  focus: (name: OverlayName) => void;
  focusedId: () => OverlayName | null;

  primaryToolbarOnly: boolean;
  setPrimaryToolbarOnly: (v: boolean) => void;
  moreMenuOpen: boolean;
  setMoreMenuOpen: (v: boolean) => void;
  toolsOverlayOpen: boolean;
  setToolsOverlayOpen: (v: boolean) => void;
  /**
   * Phase 22 — Apps grid promotes Timer / Alarm / Calendar / Files to
   * top-level tiles. Each tile sets `toolsInitialTab` and opens the
   * overlay so the user lands on the right tab in one tap.
   */
  toolsInitialTab: 'timer' | 'alarm' | 'calendar' | 'files';
  setToolsInitialTab: (v: 'timer' | 'alarm' | 'calendar' | 'files') => void;
  openToolsTab: (v: 'timer' | 'alarm' | 'calendar' | 'files') => void;

  /**
   * Phase 9.5 — transient flag: the Voice button in FloatingToolbar sets this
   * when routing to DIALOGUE, and ChatWindow consumes it on mount to auto-fire
   * the mic toggle. Cleared immediately after consumption so subsequent
   * Dialogue visits don't auto-record.
   */
  pendingVoiceActivation: boolean;
  setPendingVoiceActivation: (v: boolean) => void;

  /**
   * Phase 16 — agent history (AgentVault) overlay visibility. Toggled from
   * AgentCommandCenter; mounted by OperatorLayout and SunriseWorkspace.
   */
  agentHistoryOpen: boolean;
  setAgentHistoryOpen: (v: boolean) => void;
  toggleAgentHistory: () => void;
  closeAgentHistory: () => void;

  /**
   * Phase 17b — Agent Studio overlay (saved CustomAgents library +
   * visual builder). Toggled from FloatingToolbar's "Studio" entry. The
   * conversational builder is invoked via chat tools; this overlay is
   * only the visual surface.
   */
  studioOpen: boolean;
  setStudioOpen: (v: boolean) => void;

  /**
   * Phase 18 — AgentVisionPanel ("очі агента"). Operator toggles to
   * see what the agent sees on the desktop, with optional OCR overlay.
   */
  visionOpen: boolean;
  setVisionOpen: (v: boolean) => void;

  /**
   * Phase 28 — Will Engine panel.
   */
  willOpen: boolean;
  setWillOpen: (v: boolean) => void;

  /**
   * V11 — Intelligence Hub overlay.
   * Shows the aggregated "what PHANTOM knows about me" surface:
   * vault metadata, personal facts, lessons, memory, decisions.
   */
  intelligenceHubOpen: boolean;
  setIntelligenceHubOpen: (v: boolean) => void;

  /**
   * C-3 — Mission UI overlays + HUD toggle state.
   * `missionModeArmed` is the persisted operator preference (Task vs Mission
   * on the HUD RUN button). The remaining flags gate the three overlay
   * screens (brief dialog → detail screen → report screen) + the roster.
   */
  missionModeArmed: boolean;
  setMissionModeArmed: (v: boolean) => void;
  missionBriefOpen: boolean;
  setMissionBriefOpen: (v: boolean) => void;
  missionBriefObjective: string;
  setMissionBriefObjective: (v: string) => void;
  missionDetailOpen: boolean;
  setMissionDetailOpen: (v: boolean) => void;
  missionDetailId: string | null;
  setMissionDetailId: (id: string | null) => void;
  missionReportOpen: boolean;
  setMissionReportOpen: (v: boolean) => void;
  missionRosterOpen: boolean;
  setMissionRosterOpen: (v: boolean) => void;

  // ─── OperatorLayout v3 slices ───────────────────────────────────────────
  focusedAgent: FocusedAgent;
  setFocusedAgent: (a: FocusedAgent) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id' | 'ts'>) => string;
  dismissToast: (id: string) => void;

  chrome: ChromeState;
  setChromeCollapsed: (key: ChromeKey, collapsed: boolean) => void;
  toggleChrome: (key: ChromeKey) => void;
}

/**
 * Storage key is versioned. Bump whenever the default geometry changes so
 * stale persisted rects from older builds don't place windows off-screen.
 */
// v3 — Phase 22 enlarged the Apps window default (720×460); bumping the
// version key flushes any persisted v2 rects so the new size lands clean.
const STORAGE_KEY = 'phantom.ui.windows.v3';

const ALL_IDS: OverlayName[] = ['terminal', 'wardriving', 'camera', 'apps', 'standing_orders'];

const DEFAULT_RECT: Record<OverlayName, WindowRect> = {
  terminal: defaultRectFor('terminal'),
  wardriving: defaultRectFor('wardriving'),
  camera: defaultRectFor('camera'),
  apps: defaultRectFor('apps'),
  standing_orders: defaultRectFor('standing_orders'),
};

function loadPersisted(): Partial<Record<OverlayName, WindowRect>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<OverlayName, WindowRect>>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function persist(windows: Record<OverlayName, WindowState>): void {
  if (typeof window === 'undefined') return;
  const payload: Partial<Record<OverlayName, WindowRect>> = {};
  for (const id of ALL_IDS) {
    const w = windows[id];
    const rect = w.maximized && w.preMaxRect ? w.preMaxRect : { x: w.x, y: w.y, width: w.width, height: w.height };
    payload[id] = rect;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

function initialWindows(): Record<OverlayName, WindowState> {
  const persisted = loadPersisted();
  const out = {} as Record<OverlayName, WindowState>;
  for (const id of ALL_IDS) {
    const raw = persisted[id] ?? DEFAULT_RECT[id];
    const rect = clampRect(raw);
    out[id] = {
      id,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      open: false,
      minimized: false,
      maximized: false,
      z: 0,
      preMaxRect: null,
    };
  }
  return out;
}

export const useUIStore = create<UIStoreState>((set, get) => ({
  windows: initialWindows(),
  zCounter: 1,

  isOpen: (name) => get().windows[name]?.open ?? false,

  openOverlay: (name) =>
    set((s) => {
      const z = s.zCounter + 1;
      const next = {
        ...s.windows,
        [name]: { ...s.windows[name], open: true, minimized: false, z },
      };
      persist(next);
      return { windows: next, zCounter: z };
    }),

  closeOverlay: (name) =>
    set((s) => {
      if (!s.windows[name].open) return s;
      const next = {
        ...s.windows,
        [name]: { ...s.windows[name], open: false, minimized: false, maximized: false, preMaxRect: null },
      };
      persist(next);
      return { windows: next };
    }),

  toggleOverlay: (name) =>
    set((s) => {
      const w = s.windows[name];
      if (!w.open) {
        const z = s.zCounter + 1;
        const next = { ...s.windows, [name]: { ...w, open: true, minimized: false, z } };
        persist(next);
        return { windows: next, zCounter: z };
      }
      if (w.minimized) {
        const z = s.zCounter + 1;
        const next = { ...s.windows, [name]: { ...w, minimized: false, z } };
        return { windows: next, zCounter: z };
      }
      const next = { ...s.windows, [name]: { ...w, open: false, minimized: false, maximized: false, preMaxRect: null } };
      persist(next);
      return { windows: next };
    }),

  closeAll: () =>
    set((s) => {
      const next = { ...s.windows };
      for (const id of ALL_IDS) {
        next[id] = { ...next[id], open: false, minimized: false, maximized: false, preMaxRect: null };
      }
      persist(next);
      return { windows: next };
    }),

  setRect: (name, rect) =>
    set((s) => {
      const w = s.windows[name];
      if (w.maximized) return s; // cannot resize while maximized
      const clamped = clampRect({
        x: rect.x ?? w.x,
        y: rect.y ?? w.y,
        width: rect.width ?? w.width,
        height: rect.height ?? w.height,
      });
      const next = {
        ...s.windows,
        [name]: { ...w, ...clamped },
      };
      persist(next);
      return { windows: next };
    }),

  minimize: (name) =>
    set((s) => {
      const w = s.windows[name];
      if (!w.open) return s;
      const next = { ...s.windows, [name]: { ...w, minimized: true, maximized: false } };
      return { windows: next };
    }),

  maximize: (name) =>
    set((s) => {
      const w = s.windows[name];
      if (!w.open) return s;
      if (w.maximized) return s;
      const z = s.zCounter + 1;
      const next = {
        ...s.windows,
        [name]: {
          ...w,
          maximized: true,
          minimized: false,
          z,
          preMaxRect: { x: w.x, y: w.y, width: w.width, height: w.height },
        },
      };
      return { windows: next, zCounter: z };
    }),

  restore: (name) =>
    set((s) => {
      const w = s.windows[name];
      if (!w.open) return s;
      const z = s.zCounter + 1;
      const rect = w.preMaxRect ?? { x: w.x, y: w.y, width: w.width, height: w.height };
      const next = {
        ...s.windows,
        [name]: { ...w, ...rect, maximized: false, minimized: false, preMaxRect: null, z },
      };
      persist(next);
      return { windows: next, zCounter: z };
    }),

  focus: (name) =>
    set((s) => {
      const w = s.windows[name];
      if (!w.open) return s;
      const z = s.zCounter + 1;
      if (w.z === s.zCounter) return s;
      return {
        windows: { ...s.windows, [name]: { ...w, z, minimized: false } },
        zCounter: z,
      };
    }),

  focusedId: () => {
    const ws = get().windows;
    let top: WindowState | null = null;
    for (const id of ALL_IDS) {
      const w = ws[id];
      if (!w.open || w.minimized) continue;
      if (!top || w.z > top.z) top = w;
    }
    return top?.id ?? null;
  },

  primaryToolbarOnly: true,
  setPrimaryToolbarOnly: (v) => set({ primaryToolbarOnly: v }),
  moreMenuOpen: false,
  setMoreMenuOpen: (v) => set({ moreMenuOpen: v }),
  toolsOverlayOpen: false,
  setToolsOverlayOpen: (v) => set({ toolsOverlayOpen: v }),
  toolsInitialTab: 'timer',
  setToolsInitialTab: (v) => set({ toolsInitialTab: v }),
  openToolsTab: (v) => set({ toolsInitialTab: v, toolsOverlayOpen: true }),

  pendingVoiceActivation: false,
  setPendingVoiceActivation: (v) => set({ pendingVoiceActivation: v }),

  agentHistoryOpen: false,
  setAgentHistoryOpen: (v) => set({ agentHistoryOpen: v }),
  toggleAgentHistory: () => set((s) => ({ agentHistoryOpen: !s.agentHistoryOpen })),
  closeAgentHistory: () => set({ agentHistoryOpen: false }),

  studioOpen: false,
  setStudioOpen: (v) => set({ studioOpen: v }),

  visionOpen: false,
  setVisionOpen: (v) => set({ visionOpen: v }),

  willOpen: false,
  setWillOpen: (v) => set({ willOpen: v }),

  intelligenceHubOpen: false,
  setIntelligenceHubOpen: (v) => set({ intelligenceHubOpen: v }),

  // C-3 — mission mode HUD toggle persists across reloads.
  missionModeArmed:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('phantom_mission_mode_armed') === '1',
  setMissionModeArmed: (v) => {
    try {
      if (v) localStorage.setItem('phantom_mission_mode_armed', '1');
      else localStorage.removeItem('phantom_mission_mode_armed');
    } catch {
      /* SSR / restricted storage: ignore */
    }
    set({ missionModeArmed: v });
  },
  missionBriefOpen: false,
  setMissionBriefOpen: (v) => set({ missionBriefOpen: v }),
  missionBriefObjective: '',
  setMissionBriefObjective: (v) => set({ missionBriefObjective: v }),
  missionDetailOpen: false,
  setMissionDetailOpen: (v) => set({ missionDetailOpen: v }),
  missionDetailId: null,
  setMissionDetailId: (id) => set({ missionDetailId: id }),
  missionReportOpen: false,
  setMissionReportOpen: (v) => set({ missionReportOpen: v }),
  missionRosterOpen: false,
  setMissionRosterOpen: (v) => set({ missionRosterOpen: v }),

  // ─── OperatorLayout v3 slices ───────────────────────────────────────────
  focusedAgent: 'foreground',
  setFocusedAgent: (a) => set({ focusedAgent: a }),

  toasts: [],
  toast: (t) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id, ts: Date.now() }] }));
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),

  chrome: loadChromePersisted(),
  setChromeCollapsed: (key, collapsed) =>
    set((s) => {
      const next = { ...s.chrome, [key]: collapsed };
      persistChrome(next);
      return { chrome: next };
    }),
  toggleChrome: (key) =>
    set((s) => {
      const next = { ...s.chrome, [key]: !s.chrome[key] };
      persistChrome(next);
      return { chrome: next };
    }),
}));
