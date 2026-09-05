/**
 * Чесність смуги — на DOM, а не на функціях.
 *
 * 4 вересня це дерево видаляло впевнені числа без нічого за ними: рівень
 * мікрофона з `Math.random()` під написом «Opus WebRTC», три зелені «в
 * мережі», безумовний «P2P verified». Смуга поступу — найлегше місце
 * додати нову вигадку, тому тут перевіряється не «функція повернула», а
 * що САМЕ бачить людина:
 *
 *   - у ВИПІКАННІ немає ні знака «%», ні жодного `role="progressbar"` —
 *     бо знаменника не існує;
 *   - у ЗАВАНТАЖЕННІ зі знаменником є рівно одна смуга, і її
 *     `aria-valuenow` дорівнює саме `bytes_done`;
 *   - у ЗАВАНТАЖЕННІ без знаменника смуги й відсотка немає;
 *   - зупинку за памʼяттю пояснює бекенд: 30 і 3 приходять зі знімка, а не
 *     з коду — і це доводиться грепом по власному джерелу;
 *   - будь-яка поразка малює `outcome.detail_ua` дослівно.
 *
 * Усі виклики bakeApi тут висять нерозвʼязаними обіцянками: знімок кладемо
 * в стор напряму. Так у DOM лишається рівно те, що ми намалювали, і жодного
 * асинхронного оновлення, яке б перевірку розмило.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BakeSnapshot, BakeStage } from '@shared/types';

const pending = () => new Promise(() => {});

vi.mock('../services/bakeApi', () => ({
  bakeApi: {
    scopes: () => pending(),
    capability: () => pending(),
    current: () => pending(),
    last: () => pending(),
    start: () => pending(),
    cancel: () => pending(),
  },
}));

import { RoadPackBaker } from '../components/map/hud/RoadPackBaker';
import { useBakeStore } from '../stores/bakeStore';

const ISO = '2026-09-05T10:00:00.000Z';

function snapshot(stage: BakeStage, over: Partial<BakeSnapshot> = {}): BakeSnapshot {
  return {
    job_id: 'j1',
    scope_id: 'kyiv',
    label_ua: 'Київ',
    stage,
    started_at: ISO,
    updated_at: ISO,
    download: {
      bytes_done: 0,
      bytes_total: null,
      resumed_from_bytes: 0,
      rate_bps: null,
      source_last_modified: null,
      from_cache: false,
    },
    verify: { bytes_hashed: 0, bytes_total: 0 },
    bake: {
      nodes_seen: 4_100_000,
      nodes_kept: 900_000,
      ways_seen: 512_004,
      ways_kept: 310_887,
      rows_written: 620_112,
      cells: 8_441,
      elapsed_s: 372,
      ram_available_pct: 41,
      input_bytes: 918_223_872,
      output_bytes: null,
      index_bytes: null,
    },
    outcome: null,
    pack: null,
    previous: null,
    guard: null,
    ...over,
  };
}

/** Малюємо саме те, що побачить людина, з готового знімка. */
function paint(snap: BakeSnapshot) {
  useBakeStore.setState({ snapshot: snap, countersChangedAt: Date.parse(snap.updated_at) });
  return render(<RoadPackBaker />);
}

beforeEach(() => {
  useBakeStore.setState({
    snapshot: null,
    countersChangedAt: 0,
    countersFp: '',
    catalog: null,
    capability: null,
    error: null,
    busy: false,
  });
});

describe('стадія ВИПІКАННЯ — одометр, не паливний покажчик', () => {
  it('не малює ні знака «%», ні смуги поступу', () => {
    const { container } = paint(snapshot('baking'));

    expect(container.textContent).not.toContain('%');
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  it('показує лічильники, які справді поміряні', () => {
    paint(snapshot('baking'));

    const counters = screen.getByTestId('bake-counters');
    // Розрядник у `uk-UA` — нерозривний пробіл; порівнюємо цифри, не пробіли.
    expect(counters.textContent?.replace(/\s/g, '')).toContain('310887');
    expect(counters.textContent?.replace(/\s/g, '')).toContain('8441');
    expect(screen.getByText('Доріг узято')).toBeInTheDocument();
    // Вільна памʼять — теж відсоток, але не міра просування, тож словом.
    expect(screen.getByText('41 відсоток')).toBeInTheDocument();
  });

  it('не обіцяє кінця навіть тоді, коли минуле випікання відоме', () => {
    const { container } = paint(
      snapshot('baking', { previous: { way_count: 300_000, elapsed_s: 400, baked_at: ISO } }),
    );

    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toMatch(/лишилось|майже|приблизно|ETA/i);
  });
});

describe('стадія ЗАВАНТАЖЕННЯ — знаменник вирішує все', () => {
  it('зі знаменником: рівно одна смуга, aria-valuenow === bytes_done', () => {
    const { container } = paint(
      snapshot('downloading', {
        download: {
          bytes_done: 229_555_968,
          bytes_total: 918_223_872,
          resumed_from_bytes: 0,
          rate_bps: 5_242_880,
          source_last_modified: null,
          from_cache: false,
        },
      }),
    );

    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('aria-valuenow')).toBe('229555968');
    expect(bars[0].getAttribute('aria-valuemax')).toBe('918223872');
    expect(container.textContent).toContain('25%');
  });

  it('без знаменника: ні смуги, ні відсотка — самі байти', () => {
    const { container } = paint(
      snapshot('downloading', {
        download: {
          bytes_done: 229_555_968,
          bytes_total: null,
          resumed_from_bytes: 0,
          rate_bps: null,
          source_last_modified: null,
          from_cache: false,
        },
      }),
    );

    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    expect(container.textContent).not.toContain('%');
    expect(screen.getByText('218.9 МіБ')).toBeInTheDocument();
    expect(screen.getByText('сервер не назвав розміру')).toBeInTheDocument();
    expect(screen.getByText('не поміряно')).toBeInTheDocument();
  });
});

describe('зупинка за памʼяттю — очікуваний вихід, з числами бекенда', () => {
  const DETAIL =
    'Вільної памʼяті лишалось менше 30% три виміри поспіль. За такої межі сторож ' +
    'системи вбиває найбільший процес без попередження — піч зупинилась раніше сама ' +
    'і прибрала недопечений пакет, нічого не зіпсовано. Звільніть памʼять або ' +
    'оберіть менший обсяг.';

  it('малює речення бекенда дослівно, з його 30 і його 3', () => {
    paint(
      snapshot('failed', {
        outcome: { kind: 'failed', reason: 'low_memory', detail_ua: DETAIL },
      }),
    );

    expect(screen.getByTestId('bake-detail-ua').textContent).toBe(DETAIL);
    expect(screen.getByText('Піч зупинилась сама')).toBeInTheDocument();
    expect(screen.getByText('Це передбачений вихід, а не збій.')).toBeInTheDocument();
  });

  it('30 і 3 не зашиті у власному коді — це числа знімка', () => {
    const files = [
      'components/map/hud/RoadPackBaker.tsx',
      'components/map/hud/bakeStageViews.tsx',
      'stores/bakeStore.ts',
      'services/bakeApi.ts',
    ];

    for (const rel of files) {
      // vitest стартує з кореня фронтенду — звідти й читаємо власне джерело.
      const src = readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');
      expect(src.length, rel).toBeGreaterThan(500);
      expect(src, rel).not.toMatch(/менше\s*30/);
      expect(src, rel).not.toMatch(/\b30\s*(%|відсот)/);
      expect(src, rel).not.toMatch(/три\s+виміри/);
      // Поріг сторожа памʼяті не належить фронтенду в жодному вигляді.
      expect(src, rel).not.toMatch(/ram_available_pct\s*[<>]/);
    }

    // Додатний контроль: якщо шлях колись поїде, ці перевірки мусять
    // ЗАЧЕРВОНІТИ, а не мовчки проходити по порожньому місцю.
    const views = readFileSync(
      resolve(process.cwd(), 'src/components/map/hud/bakeStageViews.tsx'),
      'utf8',
    );
    expect(views).toContain('ram_available_pct');
    expect(views).toContain('detail_ua');
  });
});

describe('поразка й скасування — пояснює бекенд', () => {
  it.each([
    ['low_disk', 'На диску лишилось 3.1 ГіБ, а пакету треба 16.0 ГіБ.'],
    ['network', 'Зʼєднання з download.geofabrik.de обірвалось на 41-й хвилині.'],
    ['osmium_missing', 'Інструмента osmium немає — без нього витяг не порізати.'],
  ] as const)('%s: detail_ua дослівно', (reason, detail) => {
    paint(snapshot('failed', { outcome: { kind: 'failed', reason, detail_ua: detail } }));

    expect(screen.getByTestId('bake-detail-ua').textContent).toBe(detail);
    expect(screen.getByTestId(`bake-outcome-${reason}`)).toBeInTheDocument();
  });
});

describe('завершення — що робити далі, а не «в мережі»', () => {
  it('називає файл і не обіцяє доставки', () => {
    useBakeStore.setState({
      catalog: {
        estimate: true,
        scopes: [],
        sources: [],
        pack_root_abs: '/home/phantom/.phantom-data/map_packs',
      },
    });
    const { container } = paint(
      snapshot('done', {
        pack: {
          pack_id: 'kyiv',
          bytes: 41_943_040,
          format_version: 2,
          sha256: 'a'.repeat(64),
          way_count: 310_887,
          row_count: 620_112,
          cell_count: 8_441,
          baked_at: ISO,
          filename: 'phantom_road_mesh.kyiv.db',
          rel_path: 'road/phantom_road_mesh.kyiv.db',
        },
      }),
    );

    expect(
      screen.getByText('/home/phantom/.phantom-data/map_packs/road/phantom_road_mesh.kyiv.db'),
    ).toBeInTheDocument();
    // Шлях на телефоні — чотири підписи, кожен прочитаний у дереві
    // phantom-companion і звірений на `rebuild/mobile-day1` та
    // `integration/beta` 05.09.2026. Цей тест — сторож проти дрейфу: коли
    // телефон перейменує розділ, тут стане видно, що ПК показує неіснуючу
    // дорогу. Джерела перелічені над самим рядком у bakeStageViews.tsx.
    expect(screen.getByTestId('bake-phone-path').textContent).toBe(
      'Скриня → «Стратегія» → «РЕБ та Супутники» → «ОФЛАЙН-ДОРОГИ» → «Внести файл пакета вручну»',
    );
    expect(container.textContent).toContain('Перенесіть файл на телефон і внесіть його:');
    // Жодного «в мережі», «P2P» чи «синхронізовано»: ПК іще не віддає
    // пакети телефону, і картка про це не бреше.
    expect(container.textContent).not.toMatch(/в мережі|P2P|синхроніз|готовий для телефона/i);
  });
});

describe('прогулянка — час іде від started_at, а не від відкриття вкладки', () => {
  it('перезавантаження посеред роботи не показує «0 с»', () => {
    const now = new Date();
    const { container } = paint(
      snapshot('baking', {
        started_at: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
        updated_at: now.toISOString(),
      }),
    );

    expect(container.textContent).toMatch(/триває 40 хв/);
  });

  it('мовчання лічильників називається, без діагнозу', () => {
    const stale = new Date(Date.now() - 40 * 1000).toISOString();
    paint(snapshot('baking', { started_at: stale, updated_at: stale }));

    expect(screen.getByTestId('bake-age').textContent).toBe('лічильники не змінюються 40 с');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Знімок із НЕПОМІРЯНИМИ лічильниками.
 *
 * Уся решта фікстур у цьому файлі числова — саме тому набір був зелений,
 * поки типи розходились із бекендом у десяти місцях, а на склі обсяг-країна
 * малював «0 вузлів» (факт, якого ніхто не встановлював) і «null відсотків».
 * Зелений набір не бачив цього СТРУКТУРНО: не було жодного випадку, де
 * значення відсутнє. Ось він.
 * ───────────────────────────────────────────────────────────────────────── */
describe('незміряне не малюється нулем', () => {
  it('обсяг-країна: жодного «0 вузлів», жодного «null»', () => {
    paint(
      snapshot('indexing', {
          bake: {
            nodes_seen: null, nodes_kept: null, ways_seen: 0, ways_kept: 0,
            rows_written: 0, cells: 0, elapsed_s: 12,
            ram_available_pct: null, input_bytes: null,
            output_bytes: null, index_bytes: null,
          },
      }),
    );
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('null');
    expect(dom).not.toContain('0 вузлів');
    expect(dom).not.toContain('%');
  });

  it('успіх: причини немає, і це не малюється як undefined', () => {
    paint(
      snapshot('done', {
        outcome: { kind: 'done', reason: null, detail_ua: 'пакет готовий' },
      }),
    );
    expect(document.body.textContent ?? '').not.toContain('undefined');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * ДІМ печі та ДВЕРІ до нього — досяжність, а не вигляд.
 *
 * Рішення продукту 05.09.2026: піч живе в Налаштуваннях › Мапа › «Дорожні
 * пакети», бо випікання — довга, рідкісна, свідома дія, яку роблять сидячи,
 * а HUD мапи існує для того, хто веде авто. У HUD лишились ДВЕРІ.
 *
 * Тести питають те, що ламається мовчки: чи є категорія в дереві навігації
 * (без цього картка існує, але людина її не знайде — рівно та вада, через
 * яку значок печі жив у незмонтованому StatusBar), і чи двері справді
 * просять ТУ САМУ категорію, а не відкривають налаштування абиде.
 * ───────────────────────────────────────────────────────────────────────── */
describe('дім печі досяжний з навігації', () => {
  it('категорія «Дорожні пакети» стоїть у розділі «Мапа»', async () => {
    const { SETTINGS_SECTIONS, sectionForCategory } = await import(
      '../components/settings/settingsSections'
    );
    const map = SETTINGS_SECTIONS.find((s) => s.id === 'map');
    expect(map?.categories).toContain('road_packs');
    expect(sectionForCategory('road_packs').id).toBe('map');
  });

  it('двері з панелі «Офлайн» просять саме road_packs і відкривають налаштування', async () => {
    const { OfflinePanel } = await import('../components/map/panels/OfflinePanel');
    const { useSettingsStore } = await import('../stores/settingsStore');
    const { useDeskStore } = await import('../stores/deskStore');
    const opened: string[] = [];
    useDeskStore.setState({ openPane: ((k: string) => opened.push(k)) as never });

    render(<OfflinePanel open onClose={() => {}} />);
    const door = screen.getByTestId('offline-door-road-packs');
    fireEvent.click(door);

    expect(useSettingsStore.getState().requestedCategoryId).toBe('road_packs');
    expect(opened).toContain('settings');
  });
});
