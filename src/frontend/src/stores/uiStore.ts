import { create } from 'zustand';

export type OverlayName = 'terminal' | 'wardriving' | 'camera' | 'apps' | 'standing_orders';

// Logical frame size used when positioning overlays. Matches App shell.
const FRAME_W = 1024;
const FRAME_H = 600;
const TOOLBAR_CLEARANCE = 64;
const MIN_W = 280;
const MIN_H = 200;

/** Compact overlay default: centered-ish, fits 7" screens comfortably. */
function defaultRectFor(id: OverlayName): WindowRect {
  // 360×420 per phase-3 spec; slight offsets so stacked opens don't overlap.
  const width = 360;
  const height = 420;
  const baseX = Math.round((FRAME_W - width) / 2);
  const baseY = Math.round((FRAME_H - TOOLBAR_CLEARANCE - height) / 2);
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
  return Math.max(0, Math.min(FRAME_W - w, x));
}
function clampY(y: number, h: number): number {
  return Math.max(0, Math.min(FRAME_H - TOOLBAR_CLEARANCE - h, y));
}
function clampRect(rect: WindowRect): WindowRect {
  const width = Math.max(MIN_W, Math.min(FRAME_W, rect.width));
  const height = Math.max(MIN_H, Math.min(FRAME_H - TOOLBAR_CLEARANCE, rect.height));
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

  /**
   * Phase 9.5 — transient flag: the Voice button in FloatingToolbar sets this
   * when routing to DIALOGUE, and ChatWindow consumes it on mount to auto-fire
   * the mic toggle. Cleared immediately after consumption so subsequent
   * Dialogue visits don't auto-record.
   */
  pendingVoiceActivation: boolean;
  setPendingVoiceActivation: (v: boolean) => void;
}

/**
 * Storage key is versioned. Bump whenever the default geometry changes so
 * stale persisted rects from older builds don't place windows off-screen.
 */
const STORAGE_KEY = 'phantom.ui.windows.v2';

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

  pendingVoiceActivation: false,
  setPendingVoiceActivation: (v) => set({ pendingVoiceActivation: v }),
}));
