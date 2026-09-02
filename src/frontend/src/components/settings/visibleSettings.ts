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
  // ThemePicker (категорія theme) — та сама причина: setTheme фарбує
  // <html data-theme> одразу; другий генеричний select писав би ключ
  // повз цей шлях. Один ключ — один контрол.
  ui_theme: 'ThemePicker',
};

/**
 * Ключі, які бекендовий реєстр ВІДДАЄ як робочі, хоча їх ніхто не
 * читає — виміряно grep-ом по всьому src/backend (поза config.py,
 * routes_settings.py і тестами) 31.08.2026. Бекенд свої
 * UNIMPLEMENTED_KEYS фільтрує ще на сервері, тож значок «ще не діє»
 * для ЦИХ ключів може прийти лише звідси.
 *
 * Причина в кожного СВОЯ — та, що справді спрацювала. Спільна відписка
 * («підсистема не запущена») брехала б: підсистеми якраз живі, мертвий
 * лише конкретний дріт від ключа до коду.
 *
 * Запис знімається, щойно зʼявиться читач (сторож
 * settingsDeadSwitches.test.tsx звіряє мапу зі справжнім реєстром).
 */
export const FRONTEND_UNIMPLEMENTED_KEYS: Readonly<Record<string, string>> = {
  // db/models.py лише КОМЕНТАРЕМ обіцяє «populated only when …»;
  // жоден код прапорець не читає — журнал не вмикається ніколи.
  chat_prompt_logging_enabled:
    'Вимикач ніщо не читає: колонка журналу в БД є, але код запису ' +
    'промптів так і не підʼєднано — стан прапорця нічого не змінює.',
  // Той самий коментар обіцяє «truncated to … before write» — коду
  // обрізання не існує, ліміт нікуди не передається.
  chat_prompt_excerpt_max_chars:
    'Ліміт ніщо не читає: обрізання уривка промпта описане лише в ' +
    'коментарі моделі БД, самого коду обрізання нема.',
  // Дрібні пороги (схожість, півжиття, ваги) читаються в memory/*,
  // а от ГОЛОВНИЙ вимикач — ні: памʼять працює незалежно від нього.
  cognitive_memory_enabled:
    'Головний вимикач ніщо не читає: когнітивна памʼять працює ' +
    'незалежно від нього (її дрібні пороги при цьому живі).',
  cognitive_memory_disclosure_threshold:
    'Поріг розкриття ніщо не читає — жоден модуль памʼяті його не питає.',
  cognitive_memory_idle_timeout_min:
    'Таймаут бездіяльності ніщо не читає — консолідація ходить за ' +
    'власним інтервалом, не за цим ключем.',
  // agent/actions/bash.py обирає профіль з самої дії (compute або
  // read_host, захардкоджено) — «типовий» з конфіга не питає ніхто.
  agent_sandbox_profile_default:
    'Типовий профіль ніщо не читає: пісочниця bash бере профіль із ' +
    'самої дії, а не з цього ключа.',
};

/**
 * Причина, чому ключ «ще не діє», або null для живого ключа.
 * Джерела два: прапорець бекенда (def.unimplemented) і фронтова мапа
 * вище. SettingRow малює значок, коли повернено рядок.
 */
export function resolveUnimplemented(def: SettingDefinition): string | null {
  const local = FRONTEND_UNIMPLEMENTED_KEYS[def.key];
  if (local) return local;
  if (def.unimplemented) {
    return 'Підсистема ще не запущена — значення збережеться, ефекту поки нема';
  }
  return null;
}

export interface VisibilityOptions {
  query: string;
  showAdvanced: boolean;
  /**
   * Пошук має право бачити й ключі з власним контролом — вони
   * рендеряться не редактором, а стрибком до свого підрозділу.
   */
  includeDedicated?: boolean;
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
  { query, showAdvanced, includeDedicated = false }: VisibilityOptions
): SettingDefinition[] {
  const q = query.trim().toLowerCase();
  return defs.filter((def) => {
    if (!includeDedicated && def.key in DEDICATED_CONTROL_KEYS) return false;
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
      includeDedicated: true,
    })) {
      hits.push({ def, category, section: sectionForCategory(category.id) });
    }
  }
  return hits;
}
