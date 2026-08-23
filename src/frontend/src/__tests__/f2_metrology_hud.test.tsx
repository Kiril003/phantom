/**
 * Ф2 «Театр мапи», фронт метрології (У6) — HUD-компоненти.
 *
 * Мапа тут — підробка на `window.__phantom.map`: рівно той міст, яким
 * HUD дістає живий інстанс (useHudMap), із ручним fire() подій.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CoordReadout, coordText } from '../components/map/hud/CoordReadout';
import { GridOverlay, chooseGridSpacing, metersPerPixelAt } from '../components/map/hud/GridOverlay';
import { RulerTool } from '../components/map/hud/RulerTool';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';

vi.mock('../services/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/api')>();
  return {
    ...mod,
    settingsApi: { ...mod.settingsApi, set: vi.fn().mockResolvedValue(undefined) },
  };
});

type Handler = (payload: unknown) => void;

class FakeMap {
  handlers = new Map<string, Set<Handler>>();
  canvas = { style: { cursor: '' } };
  zoom = 15;
  center = { lat: 50.4501, lng: 30.5234 };
  dblZoomEnabled = true;
  doubleClickZoom = {
    isEnabled: () => this.dblZoomEnabled,
    disable: () => {
      this.dblZoomEnabled = false;
    },
    enable: () => {
      this.dblZoomEnabled = true;
    },
  };

  on(event: string, fn: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
  }

  off(event: string, fn: Handler): void {
    this.handlers.get(event)?.delete(fn);
  }

  fire(event: string, payload: unknown): void {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }

  getCanvas(): { style: { cursor: string } } {
    return this.canvas;
  }

  getZoom(): number {
    return this.zoom;
  }

  getCenter(): { lat: number; lng: number } {
    return this.center;
  }

  /** Лінійна проєкція навколо Києва — достатня для перевірки SVG. */
  project([lon, lat]: [number, number]): { x: number; y: number } {
    return { x: (lon - 30) * 1000, y: (51 - lat) * 1000 };
  }
}

/** Клік по фейковій мапі в географічній точці. */
function mapClick(map: FakeMap, event: string, lat: number, lon: number): void {
  map.fire(event, { lngLat: { lat, lng: lon }, preventDefault: () => {} });
}

let fakeMap: FakeMap;

beforeEach(() => {
  fakeMap = new FakeMap();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__phantom = { map: fakeMap };
  useMapStore.setState({ center: [30.5234, 50.4501], toast: null });
  useSettingsStore.setState((s) => ({ values: { ...s.values, ui_coord_format: 'latlon' } }));
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__phantom;
});

describe('coordText — чесність недоступного', () => {
  it('УСК-2000 поза Україною — словом, без цифр', () => {
    expect(coordText('usk', 48.1374, 11.5755)).toBe('УСК-2000: поза зоною чинності (Україна)');
  });

  it('MGRS поза смугою UTM — словом', () => {
    expect(coordText('mgrs', 85, 0)).toBe('MGRS: поза смугою 80° пд — 84° пн');
  });

  it('Київ у трьох форматах — реальні значення', () => {
    expect(coordText('latlon', 50.4501, 30.5234)).toBe('50.45010° пн · 30.52340° сх');
    expect(coordText('mgrs', 50.4501, 30.5234)).toMatch(/^36U UA \d{5} \d{5}$/);
    expect(coordText('usk', 50.4501, 30.5234)).toMatch(/^зона 6 · X 5 \d{3} \d{3} · Y 6 \d{3} \d{3}$/);
  });
});

describe('CoordReadout', () => {
  it('без курсора показує центр екрана і каже про це', () => {
    render(<CoordReadout />);
    expect(screen.getByTestId('coord-source')).toHaveTextContent('центр');
    expect(screen.getByTestId('coord-value')).toHaveTextContent('50.45010° пн · 30.52340° сх');
  });

  it('mousemove по мапі перемикає джерело на курсор', async () => {
    render(<CoordReadout />);
    act(() => {
      fakeMap.fire('mousemove', { lngLat: { lat: 50.5, lng: 30.6 } });
    });
    await waitFor(() => {
      expect(screen.getByTestId('coord-source')).toHaveTextContent('курсор');
    });
    expect(screen.getByTestId('coord-value')).toHaveTextContent('50.50000° пн · 30.60000° сх');
    // mouseout — чесне повернення до центра.
    act(() => {
      fakeMap.fire('mouseout', {});
    });
    await waitFor(() => {
      expect(screen.getByTestId('coord-source')).toHaveTextContent('центр');
    });
  });

  it('клац по формату циклить ШИР·ДОВ → MGRS → УСК і персистить вибір', () => {
    render(<CoordReadout />);
    fireEvent.click(screen.getByTestId('coord-format'));
    expect(useSettingsStore.getState().values.ui_coord_format).toBe('mgrs');
    expect(screen.getByTestId('coord-value').textContent).toMatch(/^36U UA/);
    fireEvent.click(screen.getByTestId('coord-format'));
    expect(useSettingsStore.getState().values.ui_coord_format).toBe('usk');
    expect(screen.getByTestId('coord-value').textContent).toMatch(/^зона 6/);
    fireEvent.click(screen.getByTestId('coord-format'));
    expect(useSettingsStore.getState().values.ui_coord_format).toBe('latlon');
  });

  it('клац по координаті копіює її в буфер і каже про це тостом', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<CoordReadout />);
    fireEvent.click(screen.getByTestId('coord-value'));
    await waitFor(() => {
      expect(useMapStore.getState().toast).toMatch(/^Скопійовано: 50\.45010/);
    });
    expect(writeText).toHaveBeenCalledWith('50.45010° пн · 30.52340° сх');
  });

  it('без буфера обміну — чесний тост, не мовчання', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<CoordReadout />);
    fireEvent.click(screen.getByTestId('coord-value'));
    await waitFor(() => {
      expect(useMapStore.getState().toast).toBe('Буфер обміну недоступний');
    });
  });

  it('без мапи і без центра — «координат ще немає»', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__phantom;
    useMapStore.setState({ center: null });
    render(<CoordReadout />);
    expect(screen.getByTestId('coord-value')).toHaveTextContent('координат ще немає');
  });
});

describe('RulerTool — воскресіння: жива лінійка', () => {
  it('без точок — інструкція, без мапи — чесна відмова', () => {
    const { unmount } = render(<RulerTool onClose={() => {}} />);
    expect(screen.getByTestId('ruler-panel')).toHaveTextContent('Клац по мапі — точка');
    unmount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__phantom;
    render(<RulerTool onClose={() => {}} />);
    expect(screen.getByTestId('ruler-panel')).toHaveTextContent('Мапа ще не готова');
  });

  it('клац-клац міряє сегмент: відстань і істинний азимут на північ', async () => {
    render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 'click', 50.0, 30.5);
      mapClick(fakeMap, 'click', 50.5, 30.5);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-points', '2');
    });
    // 0.5° меридіана ≈ 55.6 км, азимут точно 000°.
    expect(screen.getByTestId('ruler-total')).toHaveTextContent(/55\.\d км/);
    expect(screen.getByTestId('ruler-azimuth')).toHaveTextContent('000°');
    expect(screen.getByTestId('ruler-segments').children).toHaveLength(1);
  });

  it('подвійний клац завершує лінію і не подвоює останню точку', async () => {
    render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 'click', 50.0, 30.5);
      // Перед dblclick мапа реально видає ДВА click у тій самій точці.
      mapClick(fakeMap, 'click', 50.5, 30.5);
      mapClick(fakeMap, 'click', 50.5, 30.5);
      mapClick(fakeMap, 'dblclick', 50.5, 30.5);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-done', 'true');
    });
    expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-points', '2');
    // Наступний клац починає нову лінію, а не тягне стару.
    act(() => {
      mapClick(fakeMap, 'click', 49.0, 30.0);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-points', '1');
    });
  });

  it('«Скинути» повертає порожнечу', async () => {
    render(<RulerTool onClose={() => {}} />);
    act(() => {
      mapClick(fakeMap, 'click', 50.0, 30.5);
      mapClick(fakeMap, 'click', 50.5, 30.5);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-points', '2');
    });
    fireEvent.click(screen.getByTestId('ruler-reset'));
    expect(screen.getByTestId('ruler-overlay')).toHaveAttribute('data-points', '0');
    expect(screen.getByTestId('ruler-panel')).toHaveTextContent('Клац по мапі — точка');
  });

  it('керує курсором і подвійним зумом, а на виході повертає як було', () => {
    const { unmount } = render(<RulerTool onClose={() => {}} />);
    expect(fakeMap.getCanvas().style.cursor).toBe('crosshair');
    expect(fakeMap.doubleClickZoom.isEnabled()).toBe(false);
    unmount();
    expect(fakeMap.getCanvas().style.cursor).toBe('');
    expect(fakeMap.doubleClickZoom.isEnabled()).toBe(true);
  });
});

describe('GridOverlay — сітка MGRS', () => {
  it('chooseGridSpacing: крок росте з масштабом, на дрібних зумах — null', () => {
    // ~0.6 м/px (з18, Київ) → 100 м; ~5 м/px → 1 км; ~50 → 10 км.
    expect(chooseGridSpacing(0.6)).toBe(100);
    expect(chooseGridSpacing(5)).toBe(1000);
    expect(chooseGridSpacing(50)).toBe(10000);
    expect(chooseGridSpacing(600)).toBe(100000);
    // Навіть 100-км лінії ближче за 70 px — чесна відмова.
    expect(chooseGridSpacing(2000)).toBeNull();
  });

  it('metersPerPixelAt узгоджений із формулою ScaleBar', () => {
    // z=15 на широті Києва ≈ 3.04 м/px.
    const mpp = metersPerPixelAt(15, 50.45);
    expect(mpp).toBeGreaterThan(2.9);
    expect(mpp).toBeLessThan(3.2);
  });

  it('неактивна — нічого не рендерить', () => {
    render(<GridOverlay active={false} />);
    expect(screen.queryByTestId('grid-overlay')).toBeNull();
  });

  it('замалий масштаб — вимикається словом', async () => {
    fakeMap.zoom = 3;
    render(<GridOverlay active />);
    await waitFor(() => {
      expect(screen.getByTestId('grid-off-chip')).toHaveTextContent(
        'Сітка MGRS: замалий масштаб — наблизь мапу',
      );
    });
  });

  it('поза смугою UTM — словом', async () => {
    fakeMap.center = { lat: 86, lng: 20 };
    fakeMap.zoom = 10;
    render(<GridOverlay active />);
    await waitFor(() => {
      expect(screen.getByTestId('grid-off-chip')).toHaveTextContent(
        'Сітка MGRS: поза смугою UTM (84° пн — 80° пд)',
      );
    });
  });

  it('на робочому зумі чипа відмови немає, канвас стоїть', () => {
    fakeMap.zoom = 12;
    render(<GridOverlay active />);
    expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('grid-off-chip')).toBeNull();
  });

  it('без мапи — «мапа ще не готова»', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__phantom;
    render(<GridOverlay active />);
    expect(screen.getByTestId('grid-off-chip')).toHaveTextContent('Сітка: мапа ще не готова');
  });
});
