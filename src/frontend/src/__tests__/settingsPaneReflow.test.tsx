/**
 * Ф1.5 — анатомія пейна Налаштувань (зразок: dialoguePaneReflow).
 *
 * Рендерить SettingsPanel на ширині плитки (~520px) і на ~980px і
 * доводить:
 *  1) верстка ЧИТАЄ КОНТЕЙНЕР (data-narrow від виміру, не в'юпорту);
 *  2) жодного елемента з фіксованою шириною понад контейнер;
 *  3) «Назад на головну» не існує — пейн закривається засобами стола;
 *  4) навігація: компактні рядки для миші, 44px для тача
 *     (any-pointer: coarse);
 *  5) пошук — глобальний, по поясненню, з розділом знахідки; порожній
 *     результат — словом;
 *  6) небезпечна зона: перший клік лише зводить, другий виконує;
 *  7) збереження — глобальне: правка зі знахідки пошуку зберігається.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SettingDefinition, SettingsCategory } from '@shared/types';

/* ─── Легкі заглушки важких bespoke-панелей (у них свої тести) ────────── */

vi.mock('../components/settings/ProfileManagement', () => ({
  ProfileManagementSection: () => <div data-testid="stub-profile" />,
}));
vi.mock('../components/settings/MobilePairing', () => ({
  MobilePairing: () => <div data-testid="stub-mobile" />,
}));
vi.mock('../components/settings/VaultPanel', () => ({
  VaultPanel: () => <div data-testid="stub-vault" />,
}));
vi.mock('../components/settings/BackupRestoreCard', () => ({
  BackupRestoreCard: () => <div data-testid="stub-backup" />,
}));
vi.mock('../components/settings/KeyVaultPanel', () => ({
  KeyVaultPanel: () => <div data-testid="stub-polis" />,
}));
vi.mock('../components/settings/LicenseGroup', () => ({
  LicenseGroup: () => <div data-testid="stub-license" />,
}));
vi.mock('../components/settings/ApiKeysTab', () => ({
  ApiKeysTab: () => <div data-testid="stub-api-keys" />,
}));
vi.mock('../components/settings/MembersTab', () => ({
  MembersTab: () => <div data-testid="stub-members" />,
}));
vi.mock('../components/settings/AgentLimitsGroup', () => ({
  AgentLimitsGroup: () => <div data-testid="stub-agent-limits" />,
}));
vi.mock('../components/settings/AgentLayoutGroup', () => ({
  AgentLayoutGroup: () => <div data-testid="stub-agent-layout" />,
}));
vi.mock('../components/settings/DesktopShellGroup', () => ({
  DesktopShellGroup: () => <div data-testid="stub-desktop" />,
}));

/* ─── Мережа: фікстура замість бекенда ────────────────────────────────── */

function makeDef(
  over: Partial<SettingDefinition> & { key: string; category: string }
): SettingDefinition {
  return {
    label: over.key,
    description: '',
    type: 'string',
    default: '',
    value: '',
    requires_restart: false,
    visible_to: ['ROOT', 'OPERATOR', 'GUEST'],
    ...over,
  } as SettingDefinition;
}

const FIXTURE_CATEGORIES: SettingsCategory[] = [
  {
    id: 'theme',
    label: 'Тема',
    icon: '◐',
    settings: [
      makeDef({
        key: 'ui_font_size',
        label: 'Розмір шрифту',
        type: 'number',
        default: 16,
        value: 16,
        category: 'theme',
      }),
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: '✦',
    settings: [
      makeDef({
        key: 'ai_ollama_model',
        label: 'Модель Ollama',
        value: 'llama3.2:3b',
        category: 'ai',
      }),
      makeDef({
        key: 'ai_timeout_s',
        label: 'Тайм-аут ШІ (с)',
        type: 'number',
        default: 5,
        value: 5,
        category: 'ai',
      }),
    ],
  },
  {
    id: 'voice',
    label: 'Голос',
    icon: '♪',
    settings: [
      makeDef({
        key: 'voice_wake_phrase',
        label: 'Wake-фраза',
        value: 'фантом',
        category: 'voice',
      }),
    ],
  },
  {
    id: 'general',
    label: 'Загальні',
    icon: '⚙',
    settings: [
      makeDef({
        key: 'system_hostname',
        label: "Ім'я вузла",
        value: 'phantom-pc',
        category: 'general',
      }),
    ],
  },
  {
    id: 'auth',
    label: 'Автентифікація',
    icon: '🔒',
    settings: [
      makeDef({
        key: 'security_auto_login',
        label: 'Авто-логін',
        type: 'boolean',
        default: false,
        value: false,
        category: 'auth',
      }),
    ],
  },
];

const settingsApiMock = {
  getAll: vi.fn(async () => ({ categories: FIXTURE_CATEGORIES })),
  get: vi.fn(),
  set: vi.fn(async (key: string, value: unknown) => ({
    key,
    value,
    requires_restart: false,
  })),
  reset: vi.fn(async () => ({ ok: true, reset_count: 3 })),
  export: vi.fn(),
  import: vi.fn(),
};

vi.mock('../services/api', () => ({
  settingsApi: {
    getAll: (...a: unknown[]) => settingsApiMock.getAll(...(a as [])),
    get: (...a: unknown[]) => settingsApiMock.get(...(a as [])),
    set: (...a: unknown[]) =>
      settingsApiMock.set(...(a as [string, unknown])),
    reset: (...a: unknown[]) => settingsApiMock.reset(...(a as [])),
    export: (...a: unknown[]) => settingsApiMock.export(...(a as [])),
    import: (...a: unknown[]) => settingsApiMock.import(...(a as [])),
  },
  aiApi: {
    test: vi.fn(),
    reset: vi.fn(),
    listModels: vi.fn(async () => ({ ok: false, models: [] })),
  },
}));

vi.mock('../services/voiceApi', () => ({
  voiceApi: {
    status: vi.fn(async () => ({
      npu_enabled: false,
      npu_active: false,
      npu_available: false,
      npu_encoder_loaded: false,
      npu_model_path: '',
      npu_compute: '',
      npu_providers: '',
      stt_engine: 'vosk',
    })),
  },
}));

vi.mock('../services/settingsBootstrap', () => ({
  applyUISettings: vi.fn(),
}));

/* ─── Вимір контейнера під контролем тесту (як у dialoguePaneReflow) ──── */

const realGetRect = HTMLElement.prototype.getBoundingClientRect;
let containerWidth = 1280;

function stubMeasuredWidth(width: number) {
  containerWidth = width;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: containerWidth,
      height: 480,
      top: 0,
      left: 0,
      right: containerWidth,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

const realMatchMedia = window.matchMedia;

function stubPointer(coarse: boolean) {
  window.matchMedia = ((q: string) =>
    ({
      matches: q.includes('any-pointer: coarse') ? coarse : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

function assertNoFixedWidthWiderThan(root: HTMLElement, limit: number) {
  const offenders: string[] = [];
  const classRe = /(?:^|\s)(?:min-w|w)-\[(\d+)px\]/g;
  for (const el of Array.from(root.querySelectorAll<Element>('*'))) {
    const cls = el.getAttribute('class') ?? '';
    for (const m of cls.matchAll(classRe)) {
      if (Number(m[1]) > limit) offenders.push(`${el.tagName}: class «${m[0].trim()}»`);
    }
    const style = (el as HTMLElement).style;
    if (style) {
      for (const prop of ['width', 'minWidth'] as const) {
        const v = style[prop];
        const px = /^(\d+(?:\.\d+)?)px$/.exec(v ?? '');
        if (px && Number(px[1]) > limit) offenders.push(`${el.tagName}: style ${prop}=${v}`);
      }
    }
  }
  expect(offenders, `фіксовані ширини > ${limit}px:\n${offenders.join('\n')}`).toEqual([]);
}

async function renderPanelAt(width: number) {
  stubMeasuredWidth(width);
  // Стор скидається ДИНАМІЧНИМ імпортом: після vi.resetModules() живе
  // новий екземпляр zustand — статичний імпорт зверху тримав би старий,
  // і query/dirty попереднього тесту протікали б у наступний.
  const { useSettingsStore } = await import('../stores/settingsStore');
  useSettingsStore.setState({
    categories: [],
    values: {},
    dirty: new Set(),
    loaded: false,
    query: '',
    showAdvanced: false,
  });
  const { default: SettingsPanel } = await import(
    '../components/settings/SettingsPanel'
  );
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <div style={{ width }}>
        <SettingsPanel />
      </div>
    );
  });
  await waitFor(() => {
    expect(screen.getByTestId('settings-surface')).toBeInTheDocument();
  });
  return result!;
}

describe('НАЛАШТУВАННЯ у пейні: анатомія Ф1.5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPointer(false);
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realGetRect;
    window.matchMedia = realMatchMedia;
  });

  it('широкий пейн (~980px): дві колонки, розділи словами, без «Назад на головну»', async () => {
    const { container } = await renderPanelAt(980);

    const surface = screen.getByTestId('settings-surface');
    expect(surface.getAttribute('data-narrow')).toBeNull();

    // Розділи ІА — словами в навігації.
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    for (const word of ['Вигляд', 'Мова і голос', 'ШІ та памʼять', 'Система']) {
      expect(within(nav).getByText(word)).toBeInTheDocument();
    }

    // Кнопки «Назад на головну» не існує: у світі столів нема «головної».
    expect(screen.queryByText('Назад на головну')).toBeNull();

    // Лічильників «N/N» старої анатомії теж нема.
    expect(container.textContent).not.toMatch(/\d+\/\d+/);

    assertNoFixedWidthWiderThan(container, 980);
  });

  it('вузька плитка (~520px): одна колонка чипів, без фіксованих ширин понад контейнер', async () => {
    const { container } = await renderPanelAt(520);

    const surface = screen.getByTestId('settings-surface');
    expect(surface.getAttribute('data-narrow')).toBe('true');

    // Навігація жива і на вузькій плитці — чипами.
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    expect(within(nav).getByText('Вигляд')).toBeInTheDocument();

    assertNoFixedWidthWiderThan(container, 520);
  });

  it('навігація компактна для миші (28px) і 44px для тача', async () => {
    await renderPanelAt(980);
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    const fineBtn = within(nav).getByText('Система').closest('button')!;
    expect(parseInt(fineBtn.style.minHeight, 10)).toBe(28);

    // Тач: any-pointer: coarse → 44px.
    document.body.innerHTML = '';
    vi.resetModules();
    stubPointer(true);
    await renderPanelAt(980);
    const coarseNav = screen.getByRole('navigation', {
      name: 'Розділи налаштувань',
    });
    const coarseBtn = within(coarseNav).getByText('Система').closest('button')!;
    expect(parseInt(coarseBtn.style.minHeight, 10)).toBe(44);
  });

  it('пошук глобальний: слово з ПОЯСНЕННЯ знаходить ключ і називає розділ', async () => {
    await renderPanelAt(980);

    const input = screen.getByLabelText('Пошук по всіх налаштуваннях');
    // «інтернету» живе лише в поясненні ai_ollama_model
    // (settingDescriptions), не в назві — пошук по назві його б не знайшов.
    fireEvent.change(input, { target: { value: 'інтернету' } });

    await waitFor(() => {
      expect(screen.getByTestId('setting-row-ai_ollama_model')).toBeInTheDocument();
    });
    // Розділ знахідки — словами.
    expect(screen.getByText('ШІ та памʼять › AI')).toBeInTheDocument();
    // Чужі рядки в результати не потрапили.
    expect(screen.queryByTestId('setting-row-system_hostname')).toBeNull();
  });

  it('порожній результат пошуку — словом, не порожнім екраном', async () => {
    await renderPanelAt(980);
    fireEvent.change(screen.getByLabelText('Пошук по всіх налаштуваннях'), {
      target: { value: 'xyzzy-нема-такого' },
    });
    await waitFor(() => {
      expect(
        screen.getByText(/Нічого не знайдено за «xyzzy-нема-такого»/)
      ).toBeInTheDocument();
    });
  });

  it('правка зі знахідки пошуку зберігається глобальною кнопкою', async () => {
    await renderPanelAt(980);
    fireEvent.change(screen.getByLabelText('Пошук по всіх налаштуваннях'), {
      target: { value: 'інтернету' },
    });
    const row = await screen.findByTestId('setting-row-ai_ollama_model');
    const field = within(row).getByDisplayValue('llama3.2:3b');
    fireEvent.change(field, { target: { value: 'gemma3:4b' } });

    const save = screen.getByRole('button', { name: /Зберегти/ });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(settingsApiMock.set).toHaveBeenCalledWith('ai_ollama_model', 'gemma3:4b');
  });

  it('небезпечна зона: перший клік лише зводить, другий виконує скидання', async () => {
    await renderPanelAt(980);
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });

    // Розділ «Система» → підрозділ «Небезпечна зона».
    fireEvent.click(within(nav).getByText('Система'));
    fireEvent.click(await within(nav).findByText('Небезпечна зона'));

    const zone = await screen.findByTestId('danger-zone');
    const resetAll = within(zone).getByRole('button', { name: 'Скинути все' });

    // Клік №1 — лише озброєння, API мовчить.
    fireEvent.click(resetAll);
    expect(settingsApiMock.reset).not.toHaveBeenCalled();
    const armed = within(zone).getByRole('button', {
      name: 'ВСЕ до типових — натисни ще раз',
    });
    expect(armed.getAttribute('data-armed')).toBe('true');

    // Клік №2 — виконання.
    await act(async () => {
      fireEvent.click(armed);
    });
    expect(settingsApiMock.reset).toHaveBeenCalledTimes(1);

    // Після успіху — слово про наслідок, і панель перечитала дані.
    expect(within(zone).getByText('Скинуто значень: 3')).toBeInTheDocument();
    expect(settingsApiMock.getAll.mock.calls.length).toBeGreaterThan(1);
  });

  it('Esc роззброює небезпечну дію', async () => {
    await renderPanelAt(980);
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    fireEvent.click(within(nav).getByText('Система'));
    fireEvent.click(await within(nav).findByText('Небезпечна зона'));

    const zone = await screen.findByTestId('danger-zone');
    fireEvent.click(within(zone).getByRole('button', { name: 'Скинути все' }));
    const armed = within(zone).getByRole('button', {
      name: 'ВСЕ до типових — натисни ще раз',
    });
    fireEvent.keyDown(armed, { key: 'Escape' });
    // Кнопка повернулась у спокійний стан, API не чіпали.
    expect(
      within(zone).getByRole('button', { name: 'Скинути все' })
    ).toBeInTheDocument();
    expect(settingsApiMock.reset).not.toHaveBeenCalled();
  });

  it('кожен рядок несе людське пояснення видимим текстом', async () => {
    await renderPanelAt(980);
    const nav = screen.getByRole('navigation', { name: 'Розділи налаштувань' });
    fireEvent.click(within(nav).getByText('Система'));

    const row = await screen.findByTestId('setting-row-system_hostname');
    // Пояснення з реєстру — видиме, не сховане в title.
    expect(
      within(row).getByText(/представляється в мережі/)
    ).toBeInTheDocument();
  });
});
