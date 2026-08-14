/**
 * Той самий клас, що в `deadControls.test.tsx`, але на мапі. Нумерація
 * продовжує той файл; окремий файл тут тому, що ці двоє живуть під іншим
 * оточенням (мапа, ws, справжній fetch), і зносити його на екрани входу й
 * «Додатків» не можна.
 *
 * 4. Кнопки «Бібліотека шарів» не існувало ніде. `HudShell` оголошував
 *    `onOpenLibrary` у пропсах і не діставав його з деструктуризації, тож
 *    `OmniMap` слухняно передавав обробник у нікуди, а `libraryOpen`
 *    не міг стати `true` жодним дотиком по екрану. Панель на 236 рядків
 *    із одинадцятьма зеленими тестами була змонтована й недосяжна.
 *    Корінь: кнопку тримала `LayerPalette`, яку рейка `MapRail` замінила,
 *    а вхід у бібліотеку разом із нею загубила.
 *
 * 5. Профіль висот ходив на `/api/v1/elevation/profile` — сирим `mapApi.post`,
 *    що не додає `/map`. Справжній маршрут `/api/v1/map/elevation/profile`,
 *    тобто кожен запит був 404, а панель ловила помилку в консоль і лишала
 *    графік порожнім.
 *
 * Обидва тести б'ють у справжній ланцюг: перший тисне кнопку й дивиться, чи
 * панель відкрилась, а не чи викликали сеттер; другий читає URL, який пішов
 * у `fetch`, а не який метод API смикнули.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../services/websocket', () => ({
  wsClient: { on: () => () => {}, send: () => {}, connect: () => {}, disconnect: () => {} },
}));

// Полотно MapLibre до жодного з цих ланцюгів не належить.
vi.mock('../components/map/TacticalMap', () => ({
  TacticalMap: () => <div data-testid="tactical-map" />,
}));

const LAYERS_PAYLOAD = {
  layers: [
    {
      id: 'frontline',
      name_ua: 'Лінія фронту',
      name_en: 'Frontline',
      category: 'ukraine',
      license: 'CC-BY-NC-SA',
      attribution: 'DeepStateMap.live',
      source: { type: 'rest_polling', ttl_s: 600, bbox_required: false, extras: {} },
      geometry: 'polygon',
      style: { fill_opacity: 0.18, stroke_width: 2, point_radius: 4, pulse: false, legend: [] },
      agent_verbs: [],
      require_internet: true,
      require_setting: null,
      require_root: false,
      private: false,
      priority: 'critical',
      default_active: false,
      available_offline: false,
      tags: ['ukraine'],
      active: false,
    },
  ],
  total: 1,
  categories: ['ukraine'],
  load_errors: [],
};

/** Порожні, але правильні за формою відповіді для всього, що тягне HUD. */
function payloadFor(url: string): unknown {
  if (url.includes('/map/layers')) return LAYERS_PAYLOAD;
  if (url.includes('/map/position_sources')) return { phone: null, aps: [], paired_devices: 0 };
  if (url.includes('/map/wifi_scan')) return { aps: [], known: 0 };
  if (url.includes('/map/nearby')) return { remembered: [], osm: [], pois: [] };
  if (url.includes('/elevation/profile')) {
    return { profile: [{ distance_m: 0, elevation_m: 180 }, { distance_m: 1200, elevation_m: 214 }] };
  }
  return {};
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => payloadFor(String(url)),
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('дефект 4 — бібліотеку шарів не було чим відкрити', () => {
  it('кнопка на рейці шарів справді відкриває панель бібліотеки', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);

    const button = await screen.findByRole('button', { name: /Бібліотека шарів/ });
    fireEvent.click(button);

    // Не `setLibraryOpen`, а сама панель у документі.
    expect(await screen.findByTestId('layer-library-panel')).toBeTruthy();
  });

  it('доти панелі в документі немає', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);

    await screen.findByRole('button', { name: /Бібліотека шарів/ });
    expect(screen.queryByTestId('layer-library-panel')).toBeNull();
  });
});

describe('дефект 5 — профіль висот стукав не в ті двері', () => {
  it('запит іде на /api/v1/map/elevation/profile', async () => {
    const { AnalysisPanel } = await import('../components/map/panels/AnalysisPanel');
    render(
      <AnalysisPanel
        open
        onClose={() => {}}
        selectedPath={[[50.45, 30.52], [50.46, 30.54]]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/v1/map/elevation/profile');
    expect(urls).not.toContain('/api/v1/elevation/profile');
  });

  it('надсилає точки шляху тілом POST', async () => {
    const { AnalysisPanel } = await import('../components/map/panels/AnalysisPanel');
    render(
      <AnalysisPanel
        open
        onClose={() => {}}
        selectedPath={[[50.45, 30.52], [50.46, 30.54]]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/elevation/profile'));
    expect(call).toBeTruthy();
    const init = call![1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ points: [[50.45, 30.52], [50.46, 30.54]] });
  });

  it('малює профіль, коли бекенд відповів', async () => {
    const { AnalysisPanel } = await import('../components/map/panels/AnalysisPanel');
    render(
      <AnalysisPanel
        open
        onClose={() => {}}
        selectedPath={[[50.45, 30.52], [50.46, 30.54]]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));

    // 214 приходить зі стабу — якщо запит промазав, тут лишається 0.
    expect(await screen.findByText('214 м')).toBeTruthy();

    // Мінімум навмисно не перевіряємо: `minElev` рахується як
    // `Math.min(...висоти, 0)`, тож для будь-якої суші над рівнем моря він
    // намертво 0. Це окремий дефект того ж класу, не наслідок цієї правки.
  });
});
