/**
 * PHANTOM i18n — locale registry.
 *
 * Ukrainian is the product's source language and the runtime default; English
 * is the wired "seam" — structurally present and switchable, populated per
 * string as the UI is migrated (missing keys fall back to the uk source, then
 * to the key itself; see ./index). Deliberately dependency-free: a device-class
 * board doesn't need i18next's ~40 kB when the whole runtime is a lookup + a
 * `{var}` interpolator.
 */
export const LOCALES = ['uk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The source language: complete, and the fallback for every other locale. */
export const DEFAULT_LOCALE: Locale = 'uk';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Human labels for the language picker, in each language's own name. */
export const LOCALE_LABELS: Record<Locale, string> = {
  uk: 'Українська',
  en: 'English',
};
