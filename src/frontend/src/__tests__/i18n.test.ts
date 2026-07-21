import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, translate } from '../i18n';
import { uk } from '../i18n/messages/uk';
import { en } from '../i18n/messages/en';

describe('i18n runtime', () => {
  it('Ukrainian is the source language and the default', () => {
    expect(DEFAULT_LOCALE).toBe('uk');
    expect(LOCALES).toContain('uk');
    expect(LOCALES).toContain('en');
  });

  it('resolves a key in the requested locale', () => {
    expect(translate('chat.sessions.title', 'uk')).toBe('Сесії');
    expect(translate('chat.sessions.title', 'en')).toBe('Sessions');
  });

  it('falls back to the Ukrainian source when a locale lacks the key', () => {
    // en.ts is deliberately Partial — a not-yet-translated key must degrade to
    // readable Ukrainian, never to the raw dotted key.
    const partial = en as Record<string, string | undefined>;
    const missing = Object.keys(uk).find((k) => partial[k] === undefined);
    if (missing) {
      expect(translate(missing as keyof typeof uk, 'en')).toBe(
        uk[missing as keyof typeof uk]
      );
    }
    // And the fallback path is exercised regardless of catalogue coverage:
    delete partial['chat.thinking'];
    expect(translate('chat.thinking', 'en')).toBe(uk['chat.thinking']);
    partial['chat.thinking'] = 'Thinking';
  });

  it('interpolates {var} placeholders', () => {
    expect(translate('chat.sessions.count', 'en', { count: 12 })).toBe('12 msg');
    expect(translate('chat.sessions.preview', 'uk', { id: 'a1b2c3' })).toBe(
      'Сесія · a1b2c3'
    );
  });

  it('leaves unknown placeholders literal instead of blanking them', () => {
    expect(translate('chat.sessions.count', 'en', {})).toBe('{count} msg');
  });

  it('every en key exists in the uk source', () => {
    const ukKeys = new Set(Object.keys(uk));
    for (const key of Object.keys(en)) {
      expect(ukKeys.has(key)).toBe(true);
    }
  });

  it('isLocale rejects anything outside the registry', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(7)).toBe(false);
  });
});
