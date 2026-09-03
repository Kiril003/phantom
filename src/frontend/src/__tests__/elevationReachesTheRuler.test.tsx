/**
 * «Рельєф» мусить бути ДОСЯЖНИМ, а не просто справним.
 *
 * Профіль висот мав три зелені тести — і не міг спрацювати в продукті
 * ЖОДНОГО разу. Розрив був подвійний і тихий:
 *   • `OmniMap` рендерив `<AnalysisPanel>` **без `selectedPath`**;
 *   • жива лінійка (`RulerTool`, рейка мапи) тримала свої точки у
 *     ЛОКАЛЬНОМУ стані й нікому їх не віддавала.
 * Тобто панель чекала на лінію, а лінія існувала поруч і не знала про неї.
 * Ті три тести цього не бачили, бо **передавали шлях самі** — доводили
 * справність замість досяжності.
 *
 * Тож цей сторож ніде не підсовує шлях руками. Він перевіряє рівно місця
 * розриву: чи лінійка публікує намірене, і чи панель це бачить.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { RulerTool } from '../components/map/hud/RulerTool';
import { AnalysisPanel } from '../components/map/panels/AnalysisPanel';
import { useMapStore } from '../stores/mapStore';

type Handler = (payload: unknown) => void;

class FakeMap {
  handlers = new Map<string, Set<Handler>>();
  canvas = { style: { cursor: '' } };
  dblZoomEnabled = true;
  doubleClickZoom = {
    isEnabled: () => this.dblZoomEnabled,
    disable: () => { this.dblZoomEnabled = false; },
    enable: () => { this.dblZoomEnabled = true; },
  };
  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
  }
  off(event: string, fn: Handler) { this.handlers.get(event)?.delete(fn); }
  fire(event: string, payload: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }
  getCanvas() { return this.canvas; }
  getZoom() { return 15; }
  getCenter() { return { lat: 50.45, lng: 30.52 }; }
  project([lon, lat]: [number, number]) { return { x: (lon - 30) * 1000, y: (51 - lat) * 1000 }; }
}

function mapClick(map: FakeMap, lat: number, lon: number) {
  map.fire('click', { lngLat: { lat, lng: lon }, preventDefault: () => {} });
}

let fakeMap: FakeMap;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeMap = new FakeMap();
  (window as any).__phantom = { map: fakeMap };
  useMapStore.setState({ measurePath: [] });
  fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ profile: [{ distance_m: 0, elevation_m: 180 }, { distance_m: 1200, elevation_m: 214 }] }),
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  delete (window as any).__phantom;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('профіль висот досяжний від лінійки', () => {
  it('лінійка публікує намірену ламану — вона перестала бути приватною', () => {
    render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 50.0, 30.5);
      mapClick(fakeMap, 50.5, 30.5);
    });
    expect(useMapStore.getState().measurePath).toEqual([[50.0, 30.5], [50.5, 30.5]]);
  });

  it('закрита лінійка стирає шлях — профілю з невидимої лінії не буває', () => {
    const { unmount } = render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 50.0, 30.5);
      mapClick(fakeMap, 50.5, 30.5);
    });
    expect(useMapStore.getState().measurePath).toHaveLength(2);
    unmount();
    expect(useMapStore.getState().measurePath).toEqual([]);
  });

  it('панель бере ламану й питає рельєф саме по ній', async () => {
    // Шлях кладе ЛІНІЙКА, не тест.
    render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 50.0, 30.5);
      mapClick(fakeMap, 50.5, 30.5);
    });
    const path = useMapStore.getState().measurePath;

    render(<AnalysisPanel open onClose={() => {}} selectedPath={path} />);
    fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/elevation/profile'));
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ points: path });
  });

  it('без лінії панель веде до справжнього інструмента, а не в нікуди', () => {
    render(<AnalysisPanel open onClose={() => {}} selectedPath={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Рельєф/ }));
    // Раніше тут стояло «Побудуйте лінію для профілю висот» — вказівка, яку
    // з цієї панелі виконати було НІЧИМ.
    expect(screen.getByText(/Лінійкою.*на рейці мапи/)).toBeTruthy();
  });

  it('у панелі більше немає другої «Лінійки» — один вхід на один інструмент', () => {
    render(<AnalysisPanel open onClose={() => {}} selectedPath={[]} />);
    expect(screen.queryByRole('button', { name: /^Лінійка$/ })).toBeNull();
  });
});
