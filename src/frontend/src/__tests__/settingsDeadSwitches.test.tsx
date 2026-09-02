/**
 * Мертві перемикачі Налаштувань — сторожі двох правок.
 *
 * 1) FRONTEND_UNIMPLEMENTED_KEYS: бекендовий реєстр (routes_settings.py)
 *    ховає власні UNIMPLEMENTED_KEYS ще на сервері, тож значок «ще не
 *    діє» у SettingRow досі не мав ЖОДНОГО шляху зʼявитись. А в реєстрі
 *    при цьому живуть ключі, які бекенд віддає як робочі, хоч їх ніхто
 *    не читає (перевірено grep-ом по всьому src/backend, кожен — своя
 *    причина в мапі). Людина бачила звичайний перемикач, клацала,
 *    зберігала — і нічого не відбувалось, без жодного попередження.
 *    Тепер фронт тримає власну поіменну мапу з ПРИЧИНАМИ і чіпляє той
 *    самий значок.
 *
 * 2) AgentLayoutGroup («Агент / Екран оператора»): OperatorLayout v4
 *    зняв колонковий поділ — обидва режими малюють ІДЕНТИЧНУ верстку
 *    (див. коментар у AgentV5.test.tsx), читачів ui_agent_layout у
 *    фронті нуль. Перемикач лишався і виглядав живим. Жест прибрано.
 *
 * ЧЕРВОНИМ доведено на старому коді: (а) експорту не існувало — файл
 * падав на імпорті; (б) значок не зʼявлявся; (в) AgentLayoutGroup був
 * змонтований у SettingsPanel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SettingDefinition, SettingsCategory } from '@shared/types';
import {
  FRONTEND_UNIMPLEMENTED_KEYS,
  resolveUnimplemented,
} from '../components/settings/visibleSettings';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '../../../backend');
const SETTINGS_DIR = path.resolve(HERE, '../components/settings');

/* ─── Ланка 1: кожен ключ мапи — справжній, і бекенд його НЕ ховає ───── */

describe('FRONTEND_UNIMPLEMENTED_KEYS — звірка зі справжнім реєстром', () => {
  const routesSrc = readFileSync(
    path.join(BACKEND, 'api', 'routes_settings.py'),
    'utf-8',
  );
  const configSrc = readFileSync(path.join(BACKEND, 'config.py'), 'utf-8');

  // Блок UNIMPLEMENTED_KEYS бекенда: від оголошення до закриття дужки.
  const backendUnimpl =
    /UNIMPLEMENTED_KEYS = \{[\s\S]*?\n\}/.exec(routesSrc)?.[0] ?? '';

  it('мапа не порожня і кожен запис має людську причину', () => {
    const entries = Object.entries(FRONTEND_UNIMPLEMENTED_KEYS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, reason] of entries) {
      expect(reason.trim().length, `порожня причина для ${key}`).toBeGreaterThan(
        10,
      );
    }
  });

  it('кожен ключ існує в config.py (не фантом фронтенда)', () => {
    for (const key of Object.keys(FRONTEND_UNIMPLEMENTED_KEYS)) {
      expect(
        new RegExp(`^    ${key}:`, 'm').test(configSrc),
        `${key} нема серед полів PhantomConfig`,
      ).toBe(true);
    }
  });

  it('кожен ключ ВІДДАЄТЬСЯ реєстром (бекенд його не ховає сам)', () => {
    for (const key of Object.keys(FRONTEND_UNIMPLEMENTED_KEYS)) {
      // Якщо ключ уже в бекендових UNIMPLEMENTED_KEYS — він відфільтрований
      // сервером, фронтова мапа для нього — мертвий вантаж, який бреше
      // про подвійне маркування. Тоді запис треба зняти.
      expect(
        backendUnimpl.includes(`"${key}"`),
        `${key} вже у бекендових UNIMPLEMENTED_KEYS — зайвий запис у фронтовій мапі`,
      ).toBe(false);
      // І він мусить згадуватись у CATEGORY_SPEC, інакше рядок не рендериться.
      expect(
        routesSrc.includes(`"${key}"`),
        `${key} не згадується у routes_settings.py — рядок для нього не існує`,
      ).toBe(true);
    }
  });

  it('resolveUnimplemented: причина для мертвого, null для живого', () => {
    const dead: SettingDefinition = {
      key: 'chat_prompt_logging_enabled',
      label: 'Журнал промптів',
      description: '',
      type: 'boolean',
      default: false,
      value: false,
      requires_restart: false,
      category: 'chat',
      visible_to: [],
    } as unknown as SettingDefinition;
    expect(resolveUnimplemented(dead)).toBeTruthy();

    const alive: SettingDefinition = {
      ...dead,
      key: 'agent_enabled',
    };
    expect(resolveUnimplemented(alive)).toBeNull();

    // Бекендовий прапорець (на майбутнє, коли сервер почне його слати)
    // теж дає значок — з генеричною причиною.
    const backendFlagged: SettingDefinition = {
      ...dead,
      key: 'agent_enabled',
      unimplemented: true,
    };
    expect(resolveUnimplemented(backendFlagged)).toBeTruthy();
  });
});

/* ─── Ланка 2: значок справді зʼявляється на склі ─────────────────────── */

const settingsApiMock = {
  getAll: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<object>('../services/api');
  return {
    ...actual,
    settingsApi: {
      getAll: (...a: unknown[]) => settingsApiMock.getAll(...(a as [])),
      set: (...a: unknown[]) => settingsApiMock.set(...(a as [string, unknown])),
      reset: (...a: unknown[]) => settingsApiMock.reset(...(a as [])),
    },
    aiApi: {
      test: vi.fn(),
      reset: vi.fn(),
      listModels: vi.fn(async () => ({ ok: false, models: [] })),
    },
  };
});
vi.mock('../services/voiceApi', () => ({
  voiceApi: { status: vi.fn(async () => ({ stt_engine: 'vosk' })) },
}));
vi.mock('../services/settingsBootstrap', () => ({ applyUISettings: vi.fn() }));

const CHAT_FIXTURE: SettingsCategory[] = [
  {
    id: 'chat',
    label: 'Чат',
    icon: '💬',
    settings: [
      {
        key: 'chat_prompt_logging_enabled',
        label: 'Журнал промптів',
        description: '',
        type: 'boolean',
        default: false,
        value: false,
        requires_restart: false,
        category: 'chat',
        visible_to: [],
        // Бекенд шле рядок як ЗВИЧАЙНИЙ — прапорця unimplemented нема.
        // Значок мусить прийти з фронтової мапи.
      } as unknown as SettingDefinition,
    ],
  },
];

describe('значок «ще не діє» на склі для ключа з фронтової мапи', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsApiMock.getAll.mockResolvedValue({ categories: CHAT_FIXTURE });
    window.matchMedia = ((q: string) =>
      ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('рядок chat_prompt_logging_enabled носить значок і справжню причину', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore');
    // Рядок дістаємо через глобальний пошук — той самий SettingRow, що і
    // в категорії, але без залежності від стартового підрозділу навігації.
    useSettingsStore.setState({
      categories: [],
      values: {},
      dirty: new Set(),
      loaded: false,
      query: 'Журнал промптів',
      showAdvanced: true,
    });
    const { default: SettingsPanel } = await import(
      '../components/settings/SettingsPanel'
    );
    await act(async () => {
      render(<SettingsPanel />);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('setting-row-chat_prompt_logging_enabled'),
      ).toBeInTheDocument();
    });
    const badge = screen.getByText('ще не діє');
    expect(badge).toBeInTheDocument();
    // Причина — ТА, ЩО СПРАЦЮВАЛА для цього ключа, не спільна відписка.
    expect(badge.getAttribute('title')).toBe(
      FRONTEND_UNIMPLEMENTED_KEYS['chat_prompt_logging_enabled'],
    );
  });
});

/* ─── Ланка 3: перемикач макета оператора прибрано ────────────────────── */

describe('AgentLayoutGroup — мертвий жест знято', () => {
  it('компонент не існує і SettingsPanel його не монтує', () => {
    expect(
      existsSync(path.join(SETTINGS_DIR, 'AgentLayoutGroup.tsx')),
      'AgentLayoutGroup.tsx досі лежить у components/settings',
    ).toBe(false);
    const panelSrc = readFileSync(
      path.join(SETTINGS_DIR, 'SettingsPanel.tsx'),
      'utf-8',
    );
    expect(
      panelSrc.includes('AgentLayoutGroup'),
      'SettingsPanel досі згадує AgentLayoutGroup',
    ).toBe(false);
  });
});
