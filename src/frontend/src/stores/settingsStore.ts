import { create } from 'zustand';
import { SettingsCategory } from '@shared/types';

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
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
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
}));
