/**
 * React binding for the i18n runtime.
 *
 * The active locale lives in the settings store under `ui_language`, exactly
 * like `ui_theme` — so a language switch propagates through the same
 * optimistic-update → localStorage → backend-PUT path, and every component
 * subscribed through this hook re-renders on the flip without a reload.
 *
 * The store selector reads the raw value (not a derived object) so zustand's
 * default reference equality is enough; resolution happens in a memo.
 */
import { useCallback, useMemo } from 'react';
import {
  useSettingsStore,
  LANGUAGE_SETTING_KEY,
  LANGUAGE_STORAGE_KEY,
} from '../stores/settingsStore';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';
import { translate, type MessageKey, type TranslateVars } from './index';

/** settings value → localStorage cache → source language. */
export function resolveLocale(raw: unknown): Locale {
  if (isLocale(raw)) return raw;
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isLocale(stored)) return stored;
    } catch {
      /* private mode — fall through to the default */
    }
  }
  return DEFAULT_LOCALE;
}

export function useLocale(): Locale {
  const raw = useSettingsStore((s) => s.values[LANGUAGE_SETTING_KEY]);
  return useMemo(() => resolveLocale(raw), [raw]);
}

export interface Translation {
  t: (key: MessageKey, vars?: TranslateVars) => string;
  locale: Locale;
}

export function useTranslation(): Translation {
  const locale = useLocale();
  const t = useCallback(
    (key: MessageKey, vars?: TranslateVars) => translate(key, locale, vars),
    [locale],
  );
  return { t, locale };
}
