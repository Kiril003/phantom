/**
 * Ф2 «Театр мапи», фронт метрології (У6) — HUD-компоненти.
 *
 * Мапа тут — підробка на `window.__phantom.map`: рівно той міст, яким
 * HUD дістає живий інстанс (useHudMap), із ручним fire() подій.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CoordReadout, coordText } from '../components/map/hud/CoordReadout';
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
