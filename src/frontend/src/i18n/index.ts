/**
 * PHANTOM i18n runtime.
 *
 * The whole thing is a catalogue lookup plus a `{var}` interpolator — no
 * dependency, no plural engine, no lazy-loaded JSON. Two catalogues at ~1 kB
 * each cost less than the loader that would fetch them, and the Radxa board
 * has no budget for i18next's runtime.
 *
 * Resolution order for every key: requested locale → Ukrainian source → the
 * key itself. So an untranslated English string shows readable Ukrainian
 * instead of `chat.sessions.title`, and a key that exists nowhere is still
 * visible in the UI rather than rendering empty.
 */
import { DEFAULT_LOCALE, type Locale } from './locales';
import { en } from './messages/en';
import { uk, type MessageKey } from './messages/uk';

export type { MessageKey };
export { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, isLocale, type Locale } from './locales';

const CATALOGUES: Record<Locale, Partial<Record<MessageKey, string>>> = { uk, en };

/** Values substituted into `{name}` placeholders. */
export type TranslateVars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    // An unknown placeholder stays literal — it reads as an authoring bug in
    // the catalogue instead of silently swallowing part of the sentence.
    return value === undefined ? match : String(value);
  });
}

export function translate(
  key: MessageKey,
  locale: Locale = DEFAULT_LOCALE,
  vars?: TranslateVars,
): string {
  const template = CATALOGUES[locale]?.[key] ?? uk[key] ?? key;
  return interpolate(template, vars);
}
