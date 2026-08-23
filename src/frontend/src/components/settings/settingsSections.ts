/**
 * Ф1.5 — інформаційна архітектура Налаштувань.
 *
 * Стара анатомія: ~20 категорій пласким сайдбаром. Нова: 7 осмислених
 * розділів; категорії конфіга НЕ зникають — вони стають підрозділами.
 *
 * НЕПОРУШНЕ (доктрина «всі конфіги — з UI»): кожна категорія, яку
 * віддає бекенд, мусить бути досяжною. Тому:
 *  - кожен відомий id категорії названо тут поіменно;
 *  - невідомий id (нова категорія майбутнього бекенда) НЕ зникає —
 *    падає у розділ-фолбек «Система» через sectionForCategory().
 *
 * Тест src/__tests__/settings-ia.test.ts обходить СПРАВЖНІЙ реєстр
 * бекенда (routes_settings.py) і доводить покриття.
 */

export interface SettingsSectionDef {
  /** Стабільний id — частина контракту персистенції вибору. */
  id: string;
  /** Слово-назва розділу. */
  label: string;
  /** Один рядок: що тут живе. */
  blurb: string;
  /** Id категорій-підрозділів у порядку показу. */
  categories: string[];
}

/**
 * Віртуальна категорія «Небезпечна зона» — існує лише на фронтенді.
 * Тут живуть дії, що стирають: скидання налаштувань. Кожна дія
 * вимагає озброєння (перший Enter/клік лише зводить, другий виконує).
 */
export const DANGER_CATEGORY_ID = 'danger';

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: 'look',
    label: 'Вигляд',
    blurb: 'Тема, мова інтерфейсу, оболонка',
    categories: ['theme', 'desktop'],
  },
  {
    id: 'speech',
    label: 'Мова і голос',
    blurb: 'Розпізнавання, озвучення, слово-виклик',
    categories: ['voice'],
  },
  {
    id: 'mind',
    label: 'ШІ та памʼять',
    blurb: 'Провайдери, агент, характер, чат',
    categories: ['ai', 'agent', 'personality', 'chat'],
  },
  {
    id: 'map',
    label: 'Мапа',
    blurb: 'Підложка, позиція, вардрайвінг',
    categories: ['map'],
  },
  {
    id: 'devices',
    label: 'Звʼязок і пристрої',
    blurb: 'Телефон, сенсори ESP32, камера',
    categories: ['mobile', 'sensors', 'vision'],
  },
  {
    id: 'access',
    label: 'Безпека і доступ',
    blurb: 'Вхід, профілі, учасники, ключі, сховище',
    categories: ['auth', 'profile', 'members', 'api_keys', 'polis_keys', 'vault'],
  },
  {
    id: 'system',
    label: 'Система',
    blurb: 'Вузол, ліцензія, резерв, небезпечна зона',
    categories: ['general', 'license', 'about', DANGER_CATEGORY_ID],
  },
] as const;

/** Розділ-фолбек: невідома категорія ніколи не зникає з UI. */
export const FALLBACK_SECTION_ID = 'system';

const CATEGORY_TO_SECTION: ReadonlyMap<string, SettingsSectionDef> = new Map(
  SETTINGS_SECTIONS.flatMap((section) =>
    section.categories.map((cat) => [cat, section] as const)
  )
);

/**
 * Розділ для категорії. Невідомий id → фолбек «Система»: нова
 * категорія бекенда зʼявиться в UI без жодної зміни фронтенда.
 */
export function sectionForCategory(categoryId: string): SettingsSectionDef {
  return (
    CATEGORY_TO_SECTION.get(categoryId) ??
    SETTINGS_SECTIONS.find((s) => s.id === FALLBACK_SECTION_ID)!
  );
}

/**
 * Категорії розділу в оголошеному порядку + невідомі категорії
 * бекенда (ті, що не названі в жодному розділі) — хвостом фолбека.
 */
export function categoriesForSection<T extends { id: string }>(
  section: SettingsSectionDef,
  allCategories: readonly T[]
): T[] {
  const byId = new Map(allCategories.map((c) => [c.id, c]));
  const named = section.categories
    .map((id) => byId.get(id))
    .filter((c): c is T => c != null);
  if (section.id !== FALLBACK_SECTION_ID) return named;
  const claimed = new Set(
    SETTINGS_SECTIONS.flatMap((s) => s.categories)
  );
  const orphans = allCategories.filter((c) => !claimed.has(c.id));
  return [...named, ...orphans];
}
