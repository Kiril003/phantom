/**
 * Phase 24-PRE — repair stub HUD buttons + surface map errors.
 *
 * Covers the four regressions reported by the operator ("кнопки не реагують"):
 *  1. Satellite chip cycles `ui_map_style` setting through dark→satellite→streets.
 *  2. Compass chip exposes live bearing in its label and resets to 0 on click.
 *  3. Data-load failures are surfaced via the existing toast pipeline
 *     instead of being silently swallowed by `.catch(() => {})`.
 *  4. The ready-timeout fallback overlay renders if MapLibre fails to fire
 *     the `load` event within 5s, with a Retry button.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useMapStore } from '../stores/mapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

/* ─── framer-motion stub (keeps test surface tight) ────────────────────── */

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get:
          (_target, key) =>
            (props: Record<string, unknown>) => {
              const { children, ...rest } = props as { children?: React.ReactNode };
              const Tag = (key as string) as 'div';
              return <Tag {...(rest as object)}>{children}</Tag>;
            },
      }
    ),
  };
});

/* ─── hoisted shared state (vi.mock factories run before module init) ──── */

const hoisted = vi.hoisted(() => {
  interface RecordedListener { evt: string; cb: (...a: unknown[]) => void }

  class FakeMap {
    listeners: RecordedListener[] = [];
    private center = { lat: 50.45, lng: 30.52 };
    private _zoom = 15;
    private _bearing = 0;
    private _loaded = false;
    public autoFireLoad: boolean;
    public lastSetStyleArg: unknown = null;
    public lastRotateTo: { bearing: number; opts?: unknown } | null = null;
    public lastEaseTo: unknown = null;
    private _pitch = 0;
    private _terrain: unknown = null;
    private _container: HTMLElement | null = null;
    private _canvas = { style: {} as Record<string, string> };

    static suppressNextLoad = false;
    static recordedMaps: FakeMap[] = [];
    static lastFakeMap: FakeMap | null = null;

    // TacticalMap reads `opts.container` back out via getContainer()
    // (Ukrainian attribution-button relabelling, commit b220fc4).
    constructor(opts: { container?: HTMLElement } = {}) {
      this.autoFireLoad = !FakeMap.suppressNextLoad;
      FakeMap.suppressNextLoad = false;
      FakeMap.recordedMaps.push(this);
      FakeMap.lastFakeMap = this;
      this._container = opts.container ?? null;
    }
    on(evt: string, cb: (...a: unknown[]) => void) {
      this.listeners.push({ evt, cb });
      if (evt === 'load' && this.autoFireLoad) {
        setTimeout(() => {
          this._loaded = true;
          cb();
        }, 0);
      }
      return this;
    }
    off(evt: string, cb: (...a: unknown[]) => void) {
      this.listeners = this.listeners.filter((l) => !(l.evt === evt && l.cb === cb));
      return this;
    }
    fire(evt: string, payload?: unknown) {
      for (const l of this.listeners.filter((x) => x.evt === evt)) l.cb(payload);
    }
    remove() { this.listeners = []; }
    loaded() { return this._loaded; }
    getBounds() {
      return { getSouth: () => 50, getWest: () => 30, getNorth: () => 51, getEast: () => 31 };
    }
    getCenter() { return this.center; }
    getZoom() { return this._zoom; }
    getBearing() { return this._bearing; }
    setBearing(b: number) { this._bearing = b; this.fire('rotate'); }
    rotateTo(bearing: number, opts?: unknown) {
      this.lastRotateTo = { bearing, opts };
      this._bearing = bearing;
      this.fire('rotate');
    }
    easeTo(opts: { pitch?: number; duration?: number }) {
      this.lastEaseTo = opts;
      if (opts.pitch != null) this._pitch = opts.pitch;
    }
    setStyle(style: unknown, opts?: unknown) { this.lastSetStyleArg = { style, opts }; }
    flyTo({ center, zoom }: { center: [number, number]; zoom?: number }) {
      this.center = { lng: center[0], lat: center[1] };
      if (zoom != null) this._zoom = zoom;
    }
    zoomIn() { this._zoom += 1; }
    zoomOut() { this._zoom -= 1; }
    fitBounds() { /* noop */ }
    getSource() { return undefined; }
    addSource() { /* noop */ }
    addLayer() { /* noop */ }
    removeLayer() { /* noop */ }
    removeSource() { /* noop */ }
    getLayer() { return undefined; }
    isMoving() { return false; }
    getPitch() { return this._pitch; }
    getCanvas() { return this._canvas; }
    getContainer() { return this._container; }
    getTerrain() { return this._terrain; }
    setTerrain(opts: unknown) { this._terrain = opts ?? null; }
    setLight() { /* noop */ }
    setPixelRatio() { /* noop */ }
    queryRenderedFeatures() { return []; }
  }
  class FakeMarker {
    setLngLat() { return this; }
    addTo() { return this; }
    setPopup() { return this; }
    remove() { /* noop */ }
  }
  class FakePopup { setHTML() { return this; } }
  class FakeLngLatBounds { extend() { /* noop */ } }

  const settingsSetSpy = vi.fn(async (_key: string, _value: unknown) => undefined);

  return { FakeMap, FakeMarker, FakePopup, FakeLngLatBounds, settingsSetSpy };
});

const { FakeMap, settingsSetSpy } = hoisted;

// TacticalMap registers the pmtiles protocol on the maplibre-gl default
// export at module load (offline 3D terrain, commit c0d6977) — no-op
// stubs, same fix as map.test.tsx's mock.
const addProtocol = () => { /* noop */ };
const removeProtocol = () => { /* noop */ };

vi.mock('maplibre-gl', () => ({
  default: { Map: hoisted.FakeMap, Marker: hoisted.FakeMarker, Popup: hoisted.FakePopup, LngLatBounds: hoisted.FakeLngLatBounds, addProtocol, removeProtocol },
  Map: hoisted.FakeMap,
  Marker: hoisted.FakeMarker,
  Popup: hoisted.FakePopup,
  LngLatBounds: hoisted.FakeLngLatBounds,
  addProtocol,
  removeProtocol,
}));

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/api');
  return {
    ...actual,
    settingsApi: {
      ...((actual.settingsApi as object) ?? {}),
      set: hoisted.settingsSetSpy,
    },
  };
});

/* ─── helpers ──────────────────────────────────────────────────────────── */

function resetStores() {
  useMapStore.setState({
    wardrivingRecords: [],
    heatmap: [],
    pois: [],
    track: [],
    geoTaggedFacts: [],
    center: null,
    zoom: 15,
    layers: {
      base: true,
      presence: true,
      wardriving: true,
      heatmap: false,
      intel: true,
      recon: false,
      facts: true,
      cliff_scree: false,
    },
    selection: null,
    loading: false,
    error: null,
    toast: null,
    loadWardriving: vi.fn(async () => { }),
    loadHeatmap: vi.fn(async () => { }),
    loadPOIs: vi.fn(async () => { }),
    loadTrack: vi.fn(async () => { }),
    loadGeoTaggedFacts: vi.fn(async () => { }),
    savePOI: vi.fn(async () => null),
  });
  useSettingsStore.setState({
    categories: [],
    values: { ui_map_style: 'dark' },
    dirty: new Set(),
    loaded: true,
    showAdvanced: false,
    query: '',
  });
  useSystemStore.setState({
    state: SystemState.FOCUS,
    previousState: null,
    stateHistory: [],
    context: null,
    authenticated: true,
    wsConnected: true,
  });
  FakeMap.recordedMaps.length = 0;
  FakeMap.lastFakeMap = null;
  settingsSetSpy.mockClear();
}

/* ─── 1. Satellite cycles ui_map_style ─────────────────────────────────── */

// ViewControls (Phase 24-D/E HudShell rewrite, df27a42) relabelled the
// style-cycle button from English "Style · <name>" to Ukrainian
// "Вигляд · <назва>" (see ViewControls.tsx's STYLE_UA map) — the button
// and the underlying dark/streets cycle behaviour are unchanged.
describe('Phase 24-PRE — Satellite style cycle', () => {
  beforeEach(resetStores);

  it('cycles ui_map_style dark → streets → dark on each click (satellite retired)', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    const btn = await screen.findByLabelText(/Вигляд · /);
    expect(useSettingsStore.getState().values.ui_map_style).toBe('dark');

    fireEvent.click(btn);
    expect(useSettingsStore.getState().values.ui_map_style).toBe('streets');
    expect(settingsSetSpy).toHaveBeenLastCalledWith('ui_map_style', 'streets');

    fireEvent.click(screen.getByLabelText(/Вигляд · /));
    expect(useSettingsStore.getState().values.ui_map_style).toBe('dark');
  });

  it('survives backend persist failure (offline / pre-auth)', async () => {
    settingsSetSpy.mockRejectedValueOnce(new Error('network'));
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    const btn = await screen.findByLabelText(/Вигляд · /);
    fireEvent.click(btn);
    // Local optimistic state still flips even if backend rejects.
    expect(useSettingsStore.getState().values.ui_map_style).toBe('streets');
  });

  it('rebuilds MapLibre style on setting change after ready', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    // Wait for async load fire then style-rebuild effect.
    await waitFor(() => {
      expect(FakeMap.lastFakeMap?.listeners.some((l) => l.evt === 'load')).toBe(true);
    });
    fireEvent.click(await screen.findByLabelText(/Вигляд · /));
    await waitFor(() => {
      expect(FakeMap.lastFakeMap?.lastSetStyleArg).not.toBeNull();
    });
    const arg = FakeMap.lastFakeMap?.lastSetStyleArg as { opts?: { diff?: boolean } } | null;
    expect(arg?.opts?.diff).toBe(true);
  });
});

/* ─── 2. Compass live bearing + reset ──────────────────────────────────── */

// ViewControls (df27a42) relabelled the bearing chip from English
// "Bearing · 000°" (zero-padded) to Ukrainian "Напрямок · 0°. Повернути
// на північ" — plain, unpadded degrees (see `deg` in ViewControls.tsx).
// The live-bearing tracking and reset-to-0 behaviour are unchanged.
describe('Phase 24-PRE — Compass bearing chip', () => {
  beforeEach(resetStores);

  it('renders bearing 0° initially', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    expect(await screen.findByLabelText(/Напрямок · 0°/)).toBeDefined();
  });

  it('updates label when map.rotate fires with a new bearing', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await screen.findByLabelText(/Напрямок · 0°/);
    expect(FakeMap.lastFakeMap).not.toBeNull();
    act(() => {
      FakeMap.lastFakeMap!.setBearing(45);
    });
    await waitFor(() => screen.getByLabelText(/Напрямок · 45°/));
  });

  it('resets bearing and pitch to 0 on click', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await screen.findByLabelText(/Напрямок · 0°/);
    act(() => {
      FakeMap.lastFakeMap!.setBearing(120);
    });
    const btn = await screen.findByLabelText(/Напрямок · 120°/);
    fireEvent.click(btn);
    expect(FakeMap.lastFakeMap!.lastRotateTo?.bearing).toBe(0);
    expect((FakeMap.lastFakeMap!.lastEaseTo as { pitch?: number })?.pitch).toBe(0);
  });
});

/* ─── 3. Data-load failures surface via toast ──────────────────────────── */

describe('Phase 24-PRE — error surfacing', () => {
  beforeEach(resetStores);

  it('toasts when wardriving load rejects', async () => {
    useMapStore.setState({
      loadWardriving: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await waitFor(() => {
      expect(useMapStore.getState().toast ?? '').toMatch(/Wardriving: boom/);
    });
  });

  it('toasts when MapLibre emits an error event', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await waitFor(() => expect(FakeMap.lastFakeMap).not.toBeNull());
    act(() => {
      FakeMap.lastFakeMap!.fire('error', { error: { message: 'tile 504' } });
    });
    await waitFor(() => {
      expect(useMapStore.getState().toast ?? '').toMatch(/Map: tile 504/);
    });
  });
});

/* ─── 4. Ready-timeout overlay + retry ─────────────────────────────────── */

// TacticalMap's own comment above this effect explains a deliberate change
// (unrelated to the HUD relabelling in the earlier three blocks): the
// failure check used to be `!map.loaded()` after 5s, but `loaded()` stays
// false while even a single tile is in flight, so people saw "map failed"
// over a map that was loading fine on a slow connection. It now watches
// `styleReady` (set by the 'style.load' event) with a 20s budget instead —
// see the "Збій — це збій СТИЛЮ, а не повільні тайли" comment in
// TacticalMap.tsx. The Retry button also lost its English aria-label
// ("Retry" → "Спробувати ще раз", HudShell Ukrainianisation).
describe('Phase 24-PRE — ready-timeout fallback', () => {
  beforeEach(() => {
    resetStores();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders style-failed overlay if style.load never fires within 20s', async () => {
    FakeMap.suppressNextLoad = true;
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    // Advance the 20s ready-timeout — nothing else should be running.
    await act(async () => {
      vi.advanceTimersByTime(20100);
    });
    expect(screen.getByTestId('map-style-failed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Спробувати ще раз' })).toBeDefined();
  });

  it('Retry button re-mounts the MapLibre instance', async () => {
    FakeMap.suppressNextLoad = true;
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await act(async () => {
      vi.advanceTimersByTime(20100);
    });
    expect(FakeMap.recordedMaps).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    // New instance is created on retry-nonce bump.
    expect(FakeMap.recordedMaps.length).toBeGreaterThanOrEqual(2);
  });
});
