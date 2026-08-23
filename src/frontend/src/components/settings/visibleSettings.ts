/**
 * Ф1.5 — чиста логіка видимості та пошуку налаштувань.
 *
 * Винесено з SettingsPanel, щоб тест покриття міг довести без DOM:
 *  - жоден ключ, який віддає бекенд, не губиться фільтром — окрім
 *    поіменно задокументованих ключів, що мають ВЛАСНИЙ контрол
 *    (DEDICATED_CONTROL_KEYS);
 *  - пошук працює по назві, ЛЮДСЬКОМУ поясненню і ключу — по всіх
 *    категоріях одразу, з розділом знахідки.
 */

import type { SettingDefinition, SettingsCategory } from '@shared/types';
import { resolveDescription } from './settingDescriptions';
import { sectionForCategory, type SettingsSectionDef } from './settingsSections';

/**
 * Ключі, що НЕ рендеряться генеричним рядком, бо ними володіє
 * окремий контрол у тій самій категорії. Кожен запис тут мусить
 * назвати свій контрол — інакше ключ став би недосяжним і тест
 * покриття має право на бунт.
 */
export const DEDICATED_CONTROL_KEYS: Readonly<Record<string, string>> = {
  // LanguagePicker (категорія theme) — миттєвий <html lang> фліп;
  // генеричний рядок писав би ключ без DOM-ефекту.
  ui_language: 'LanguagePicker',
};

export interface VisibilityOptions {
  query: string;
  showAdvanced: boolean;
}

/**
 * Видимі рядки однієї категорії. Правила:
 *  1. Ключ із власним контролом — не рядок (контрол уже на екрані).
 *  2. tier=advanced ховається за тумблером; пошук ламає завісу —
 *     хто шукає, той знаходить і експертне.
 *  3. Запит матчиться по label + поясненню (реєстр!) + key.
 */
export function filterVisibleDefs(
  defs: readonly SettingDefinition[],
  { query, showAdvanced }: VisibilityOptions
): SettingDefinition[] {
  const q = query.trim().toLowerCase();
  return defs.filter((def) => {
    if (def.key in DEDICATED_CONTROL_KEYS) return false;
    if (def.tier === 'advanced' && !showAdvanced && !q) return false;
    if (q) {
      const haystack =
        `${def.label} ${resolveDescription(def)} ${def.key}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export interface SettingsSearchHit {
  def: SettingDefinition;
  /** Категорія-підрозділ, де живе знахідка. */
  category: SettingsCategory;
  /** Розділ ІА — щоб показати, ДЕ це знайдено. */
  section: SettingsSectionDef;
}

/**
 * Глобальний пошук: по всіх категоріях, назві І поясненню.
 * Порожній запит → порожній масив (пошук вимкнено, не «все підряд»).
 */
export function searchAllSettings(
  categories: readonly SettingsCategory[],
  query: string
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SettingsSearchHit[] = [];
  for (const category of categories) {
    for (const def of filterVisibleDefs(category.settings, {
      query,
      showAdvanced: true,
    })) {
      hits.push({ def, category, section: sectionForCategory(category.id) });
    }
  }
  return hits;
}
