import { create } from 'zustand';
import { SettingsCategory, isThemeId, type ThemeId } from '@shared/types';
import { settingsApi } from '../services/api';

/* phase-5-R0-3-THEME-NIGHT — theme picker wiring.
 *
 * The settings store is the single source of truth for the active
 * theme. Every code-path that wants to flip themes calls
 * `setTheme(id)`, which:
 *
 *  1. Updates `<html data-theme="…">` immediately so the UI follows
 *     before the network round-trip resolves.
 *  2. Mirrors the choice into localStorage under THEME_STORAGE_KEY so
 *     the next bootstrap can paint the correct palette before the
 *     `/settings` GET completes.
 *  3. Optimistically updates the in-memory `values` map so other
 *     consumers (SettingsPanel save badge, picker tile) reflect the
 *     change without a re-fetch.
 *  4. Persists the value via the existing settings PUT endpoint so a
 *     second tab / a backend restart preserves the choice. Failures
 *     are swallowed: localStorage is the durable cache; backend sync
 *     happens on next navigation if it temporarily fails.
 */
export const THEME_STORAGE_KEY = 'phantom_theme';
export const THEME_SETTING_KEY = 'ui_theme';

export function applyThemeToDom(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', id);
}

interface SettingsStoreState {
  categories: SettingsCategory[];
  values: Record<string, unknown>;
  dirty: Set<string>;
  loaded: boolean;

  setCategories: (categories: SettingsCategory[]) => void;
  setValue: (key: string, value: unknown) => void;
  applyRemote: (key: string, value: unknown) => void;
  markClean: (key: string) => void;
  bulkSet: (values: Record<string, unknown>) => void;

  /** Read the active theme id from the in-memory settings, falling
   * back to the localStorage cache or the conservative default. */
  getActiveTheme: () => ThemeId;
  /** Flip theme: DOM + localStorage immediately, backend best-effort. */
  setTheme: (id: ThemeId) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  categories: [],
  values: {},
  dirty: new Set(),
  loaded: false,

  setCategories: (categories) => {
    const values: Record<string, unknown> = {};
    for (const cat of categories) {
      for (const def of cat.settings) {
        values[def.key] = def.value;
      }
    }
    set({ categories, values, loaded: true });
  },

  setValue: (key, value) =>
    set((s) => {
      const next = new Set(s.dirty);
      next.add(key);
      return { values: { ...s.values, [key]: value }, dirty: next };
    }),

  applyRemote: (key, value) =>
    set((s) => ({ values: { ...s.values, [key]: value } })),

  markClean: (key) =>
    set((s) => {
      const next = new Set(s.dirty);
      next.delete(key);
      return { dirty: next };
    }),

  bulkSet: (values) =>
    set((s) => ({ values: { ...s.values, ...values } })),

  getActiveTheme: () => {
    const fromValues = get().values[THEME_SETTING_KEY];
    if (isThemeId(fromValues)) return fromValues;
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(stored)) return stored;
    }
    return 'sunrise-warm';
  },

  setTheme: async (id) => {
    if (!isThemeId(id)) return;
    // 1. DOM first — paints next frame.
    applyThemeToDom(id);
    // 2. localStorage cache — survives reload, pre-paint hint for
    //    bootstrap, no auth required.
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, id);
      }
    } catch {
      /* private mode / storage full — DOM still updated, skip cache */
    }
    // 3. Optimistic store update + clear dirty marker so SettingsPanel
    //    doesn't show a "save needed" pill after a successful flip.
    set((s) => {
      const dirty = new Set(s.dirty);
      dirty.delete(THEME_SETTING_KEY);
      return {
        values: { ...s.values, [THEME_SETTING_KEY]: id },
        dirty,
      };
    });
    // 4. Backend persist — best-effort. The `phantom_token` gate in
    //    settingsApi.set keeps this a no-op pre-auth so the picker
    //    still works on the LoginScreen if we ever surface it there.
    try {
      if (
        typeof localStorage === 'undefined' ||
        localStorage.getItem('phantom_token')
      ) {
        await settingsApi.set(THEME_SETTING_KEY, id);
      }
    } catch {
      /* network blip — cache is durable; sync happens next save. */
    }
  },
}));
