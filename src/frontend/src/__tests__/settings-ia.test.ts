/**
 * Ф1.5 — покриття інформаційної архітектури Налаштувань.
 *
 * НЕПОРУШНЕ «всі конфіги — з UI»: цей тест обходить СПРАВЖНІЙ реєстр
 * бекенда (src/backend/api/routes_settings.py, CATEGORY_SPEC) — не
 * копію — і доводить:
 *
 *  1. Кожна категорія бекенда поіменно приписана до розділу ІА.
 *  2. Невідома категорія майбутнього не зникає — падає у фолбек.
 *  3. Кожен ключ реєстру має людське пояснення українською.
 *  4. Фільтр видимості не губить жодного ключа: єдині винятки —
 *     поіменні ключі з власним контролом (DEDICATED_CONTROL_KEYS).
 *  5. Пошук знаходить по поясненню (не лише по назві) і називає
 *     розділ знахідки; порожній запит — порожній результат.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SettingDefinition, SettingsCategory } from '@shared/types';
import {
  SETTINGS_SECTIONS,
  FALLBACK_SECTION_ID,
  sectionForCategory,
  categoriesForSection,
  DANGER_CATEGORY_ID,
} from '../components/settings/settingsSections';
import {
  SETTING_DESCRIPTIONS,
  resolveDescription,
} from '../components/settings/settingDescriptions';
import {
  DEDICATED_CONTROL_KEYS,
  filterVisibleDefs,
  searchAllSettings,
} from '../components/settings/visibleSettings';

/* ─── Парсинг справжнього реєстру бекенда ─────────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_SETTINGS_PY = path.resolve(
  HERE,
  '../../../backend/api/routes_settings.py'
);

interface BackendRegistry {
  categoryIds: string[];
  keys: string[];
}

function parseBackendRegistry(): BackendRegistry {
  const source = readFileSync(ROUTES_SETTINGS_PY, 'utf8');
  const start = source.indexOf('CATEGORY_SPEC');
  const end = source.indexOf('LABEL_OVERRIDES');
  expect(start, 'CATEGORY_SPEC не знайдено в routes_settings.py').toBeGreaterThan(-1);
  expect(end, 'LABEL_OVERRIDES не знайдено в routes_settings.py').toBeGreaterThan(start);
  const slice = source
    .slice(start, end)
    // Коментарі геть, щоб приклади в них не стали «ключами».
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');

  const categoryIds = Array.from(
    slice.matchAll(/"id":\s*"([a-z_]+)"/g),
    (m) => m[1]
  );

  // Усі "снейк-кейс" літерали мінус структурні слова і самі id —
  // labels/icons кирилицею чи символами і в цей клас не потрапляють.
  const structural = new Set(['id', 'label', 'icon', 'keys', ...categoryIds]);
  const keys = Array.from(
    new Set(
      Array.from(slice.matchAll(/"([a-z][a-z0-9_]*)"/g), (m) => m[1]).filter(
        (token) => !structural.has(token)
      )
    )
  );

  expect(categoryIds.length, 'реєстр бекенда порожній?').toBeGreaterThan(5);
  expect(keys.length, 'ключі реєстру не розпарсились').toBeGreaterThan(50);
  return { categoryIds, keys };
}

/** Віртуальні категорії, що існують лише на фронтенді (SettingsPanel). */
const FRONTEND_VIRTUAL_CATEGORIES = [
  'desktop',
  'polis_keys',
  'license',
  'api_keys',
  'members',
  DANGER_CATEGORY_ID,
];

/* ─── 1-2: категорії ─────────────────────────────────────────────────── */

describe('ІА Налаштувань: покриття категорій', () => {
  const { categoryIds } = parseBackendRegistry();

  it('кожна категорія бекенда поіменно приписана до розділу', () => {
    const claimed = new Set(SETTINGS_SECTIONS.flatMap((s) => s.categories));
    const orphans = categoryIds.filter((id) => !claimed.has(id));
    expect(
      orphans,
      `категорії бекенда без розділу ІА (додай у settingsSections.ts): ${orphans.join(', ')}`
    ).toEqual([]);
  });

  it('кожна віртуальна категорія фронтенда теж приписана', () => {
    const claimed = new Set(SETTINGS_SECTIONS.flatMap((s) => s.categories));
    const orphans = FRONTEND_VIRTUAL_CATEGORIES.filter((id) => !claimed.has(id));
    expect(orphans).toEqual([]);
  });

  it('невідома категорія майбутнього не зникає — падає у фолбек', () => {
    const section = sectionForCategory('category_from_the_future');
    expect(section.id).toBe(FALLBACK_SECTION_ID);

    // І categoriesForSection фолбека реально домальовує сироту в хвіст.
    const fake: SettingsCategory[] = [
      { id: 'category_from_the_future', label: 'Майбутнє', icon: '?', settings: [] },
    ];
    const fallback = SETTINGS_SECTIONS.find((s) => s.id === FALLBACK_SECTION_ID)!;
    const rendered = categoriesForSection(fallback, fake);
    expect(rendered.map((c) => c.id)).toContain('category_from_the_future');
  });

  it('жодна категорія не приписана до двох розділів', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => s.categories);
    expect(new Set(all).size).toBe(all.length);
  });

  it('розділів 5-7 — осмислена ІА, не новий пласкій список', () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(SETTINGS_SECTIONS.length).toBeLessThanOrEqual(7);
  });
});

/* ─── 3: пояснення ───────────────────────────────────────────────────── */

describe('ІА Налаштувань: людські пояснення', () => {
  const { keys } = parseBackendRegistry();

  it('кожен ключ реєстру бекенда має пояснення українською', () => {
    const missing = keys.filter((key) => {
      const text = SETTING_DESCRIPTIONS[key];
      return !text || text.trim().length === 0;
    });
    expect(
      missing,
      `ключі без пояснення (допиши в settingDescriptions.ts): ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('пояснення — справді українською (кирилиця), не заглушки', () => {
    const nonUkrainian = keys.filter((key) => {
      const text = SETTING_DESCRIPTIONS[key] ?? '';
      return !/[а-щьюяіїєґ]/i.test(text);
    });
    expect(nonUkrainian).toEqual([]);
  });

  it('бекендове пояснення перемагає реєстр, порожнє — програє', () => {
    const withOwn = { key: 'debug', description: 'Своє з бекенда' };
    expect(resolveDescription(withOwn)).toBe('Своє з бекенда');
    const empty = { key: 'debug', description: '' };
    expect(resolveDescription(empty)).toBe(SETTING_DESCRIPTIONS.debug);
    const unknown = { key: 'no_such_key_ever', description: '' };
    expect(resolveDescription(unknown)).toBe('');
  });
});

/* ─── 4-5: видимість і пошук ─────────────────────────────────────────── */

function makeDef(over: Partial<SettingDefinition> & { key: string }): SettingDefinition {
  return {
    label: over.key,
    description: '',
    type: 'string',
    default: '',
    value: '',
    requires_restart: false,
    category: 'general',
    visible_to: ['ROOT', 'OPERATOR', 'GUEST'],
    ...over,
  } as SettingDefinition;
}

describe('ІА Налаштувань: фільтр не губить ключів', () => {
  const { keys } = parseBackendRegistry();

  it('з розширеними увімкненими і без запиту видно ВСЕ, крім ключів із власним контролом', () => {
    const defs = keys.map((key) => makeDef({ key }));
    const visible = filterVisibleDefs(defs, { query: '', showAdvanced: true });
    const lost = keys.filter(
      (key) =>
        !visible.some((d) => d.key === key) && !(key in DEDICATED_CONTROL_KEYS)
    );
    expect(lost, `ключі, що зникли з UI без власного контролу: ${lost.join(', ')}`).toEqual([]);
  });

  it('кожен виняток DEDICATED_CONTROL_KEYS називає свій контрол', () => {
    for (const [key, control] of Object.entries(DEDICATED_CONTROL_KEYS)) {
      expect(control.trim().length, `${key} без назви контрола`).toBeGreaterThan(0);
    }
  });

  it('advanced ховається за тумблером, але пошук ламає завісу', () => {
    const defs = [makeDef({ key: 'voice_partial_debounce_ms', tier: 'advanced' })];
    expect(filterVisibleDefs(defs, { query: '', showAdvanced: false })).toEqual([]);
    expect(
      filterVisibleDefs(defs, { query: 'debounce', showAdvanced: false })
    ).toHaveLength(1);
  });
});

describe('ІА Налаштувань: пошук по назві І поясненню, з розділом знахідки', () => {
  const categories: SettingsCategory[] = [
    {
      id: 'ai',
      label: 'AI',
      icon: '✦',
      settings: [
        makeDef({ key: 'ai_ollama_model', label: 'Модель Ollama', category: 'ai' }),
      ],
    },
    {
      id: 'voice',
      label: 'Голос',
      icon: '♪',
      settings: [
        makeDef({ key: 'voice_mic_duck_on_tts', label: 'Мікрофон під час TTS', category: 'voice' }),
      ],
    },
  ];

  it('матч по слову з ПОЯСНЕННЯ (реєстр), якого нема в назві', () => {
    // «інтернету» живе лише в поясненні ai_ollama_model.
    const hits = searchAllSettings(categories, 'інтернету');
    expect(hits.map((h) => h.def.key)).toEqual(['ai_ollama_model']);
    expect(hits[0].section.label).toBe('ШІ та памʼять');
    expect(hits[0].category.label).toBe('AI');
  });

  it('матч по назві теж живий', () => {
    const hits = searchAllSettings(categories, 'мікрофон');
    expect(hits.map((h) => h.def.key)).toEqual(['voice_mic_duck_on_tts']);
    expect(hits[0].section.label).toBe('Мова і голос');
  });

  it('ключ із власним контролом досяжний і через пошук (двері до контрола)', () => {
    // ui_theme не рендериться генеричним рядком (ним володіє ThemePicker),
    // але пошук зобовʼязаний його знаходити — панель малює такий хіт
    // стрибком до підрозділу, не редактором.
    const withTheme: SettingsCategory[] = [
      ...categories,
      {
        id: 'theme',
        label: 'Тема',
        icon: '◐',
        settings: [
          makeDef({ key: 'ui_theme', label: 'Тема', category: 'theme' }),
        ],
      },
    ];
    const hits = searchAllSettings(withTheme, 'кіберпалуба');
    expect(hits.map((h) => h.def.key)).toEqual(['ui_theme']);
    expect(hits[0].section.label).toBe('Вигляд');
  });

  it('порожній запит → порожній результат, без «усього підряд»', () => {
    expect(searchAllSettings(categories, '   ')).toEqual([]);
  });

  it('нісенітниця → чесний нуль знахідок', () => {
    expect(searchAllSettings(categories, 'xyzzy-нема-такого')).toEqual([]);
  });
});
