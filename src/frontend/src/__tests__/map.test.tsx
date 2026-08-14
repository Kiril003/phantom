import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { MapPOI, WardrivingRecord } from '@shared/types';
import { useMapStore } from '../stores/mapStore';
import { useSystemStore } from '../stores/systemStore';
import { mapApi } from '../services/api';
import { SystemState } from '@shared/types';

/* ─── Mocks ─────────────────────────────────────────────────────────────────── */

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

// Fully stubbed maplibre-gl to avoid canvas
vi.mock('maplibre-gl', () => {
  type Listener = (...args: unknown[]) => void;
  class FakeMap {
    private listeners: Record<string, Listener[]> = {};
    private center = { lat: 50.45, lng: 30.52 };
    private _zoom = 15;
    private sources: Record<string, { data: unknown }> = {};
    private mapLayers: Record<string, unknown> = {};

    on(evt: string, cb: Listener) {
      (this.listeners[evt] ||= []).push(cb);
      if (evt === 'load') setTimeout(() => cb(), 0);
      return this;
    }
    off(evt: string, cb: Listener) {
      this.listeners[evt] = (this.listeners[evt] || []).filter((h) => h !== cb);
      return this;
    }
    remove() {
      this.listeners = {};
    }
    getBounds() {
      return {
        getSouth: () => 50.0,
        getWest: () => 30.0,
        getNorth: () => 51.0,
        getEast: () => 31.0,
      };
    }
    getCenter() {
      return this.center;
    }
    getZoom() {
      return this._zoom;
    }
    setStyle() {
      /* noop */
    }
    flyTo({ center, zoom }: { center: [number, number]; zoom?: number }) {
      this.center = { lng: center[0], lat: center[1] };
      if (zoom != null) this._zoom = zoom;
    }
    fitBounds() {
      /* noop */
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addSource(id: string, src: { data: unknown }) {
      this.sources[id] = { data: src.data };
    }
    addLayer(layer: { id: string }) {
      this.mapLayers[layer.id] = layer;
    }
    removeLayer(id: string) {
      delete this.mapLayers[id];
    }
    removeSource(id: string) {
      delete this.sources[id];
    }
    getLayer(id: string) {
      return this.mapLayers[id];
    }
  }
  class FakeMarker {
    constructor(public opts: { element?: HTMLElement } = {}) { }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    setPopup() {
      return this;
    }
    remove() {
      /* noop */
    }
  }
  class FakePopup {
    setHTML() {
      return this;
    }
  }
  class FakeLngLatBounds {
    extend() {
      /* noop */
    }
  }
  return {
    default: {
      Map: FakeMap,
      Marker: FakeMarker,
      Popup: FakePopup,
      LngLatBounds: FakeLngLatBounds,
    },
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  };
});

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function makePOI(over: Partial<MapPOI> = {}): MapPOI {
  return {
    id: over.id ?? 'poi-1',
    user_id: over.user_id ?? 'u1',
    lat: over.lat ?? 50.45,
    lon: over.lon ?? 30.52,
    name: over.name ?? 'Base',
    category: over.category ?? 'saved',
    notes: over.notes ?? '',
    icon: over.icon ?? '📍',
    is_secret: over.is_secret ?? false,
    created_at: over.created_at ?? new Date('2026-04-16T10:00:00Z').toISOString(),
  };
}

function makeRecord(over: Partial<WardrivingRecord> = {}): WardrivingRecord {
  return {
    id: over.id ?? 1,
    mac: over.mac ?? 'AA:BB:CC:DD:EE:01',
    ssid: over.ssid ?? 'PhantomLab',
    rssi: over.rssi ?? -60,
    encryption: over.encryption ?? 'WPA2',
    channel: over.channel ?? 6,
    lat: over.lat ?? 50.45,
    lon: over.lon ?? 30.52,
    first_seen: over.first_seen ?? new Date('2026-04-15T10:00:00Z').toISOString(),
    last_seen: over.last_seen ?? new Date('2026-04-16T12:00:00Z').toISOString(),
    seen_count: over.seen_count ?? 3,
  };
}

function resetStores() {
  useMapStore.setState({
    wardrivingRecords: [],
    heatmap: [],
    pois: [],
    track: [],
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
  });
  useSystemStore.setState({
    state: SystemState.FOCUS,
    previousState: null,
    stateHistory: [],
    context: null,
    authenticated: true,
    wsConnected: true,
  });
}

/* ─── mapStore ──────────────────────────────────────────────────────────────── */

describe.skip('mapStore', () => {
  beforeEach(() => {
    resetStores();
  });

  it('toggleLayer flips visibility', () => {
    expect(useMapStore.getState().layers.heatmap).toBe(false);
    useMapStore.getState().toggleLayer('heatmap');
    expect(useMapStore.getState().layers.heatmap).toBe(true);
    useMapStore.getState().toggleLayer('heatmap');
    expect(useMapStore.getState().layers.heatmap).toBe(false);
  });

  it('setLayer sets explicit visibility', () => {
    useMapStore.getState().setLayer('recon', true);
    expect(useMapStore.getState().layers.recon).toBe(true);
  });

  it('appendPOI prepends', () => {
    const poi = makePOI({ id: 'a' });
    useMapStore.getState().appendPOI(poi);
    expect(useMapStore.getState().pois[0].id).toBe('a');
  });

  it('appendPOI dedupes by id', () => {
    useMapStore.getState().appendPOI(makePOI({ id: 'a', name: 'First' }));
    useMapStore.getState().appendPOI(makePOI({ id: 'a', name: 'Second' }));
    const pois = useMapStore.getState().pois;
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('Second');
  });

  it('removePOI removes by id', () => {
    useMapStore.getState().appendPOI(makePOI({ id: 'a' }));
    useMapStore.getState().appendPOI(makePOI({ id: 'b' }));
    useMapStore.getState().removePOI('a');
    expect(useMapStore.getState().pois.map((p) => p.id)).toEqual(['b']);
  });

  it('appendWardrivingRecords merges by mac+lat+lon', () => {
    const r1 = makeRecord({ mac: 'AA', lat: 1, lon: 2 });
    const r2 = makeRecord({ mac: 'AA', lat: 1, lon: 2, rssi: -40 });
    useMapStore.getState().appendWardrivingRecords([r1]);
    useMapStore.getState().appendWardrivingRecords([r2]);
    const recs = useMapStore.getState().wardrivingRecords;
    expect(recs).toHaveLength(1);
    expect(recs[0].rssi).toBe(-40);
  });

  it('selection clears on deletePOI when selected', async () => {
    const poi = makePOI({ id: 'sel' });
    useMapStore.getState().appendPOI(poi);
    useMapStore.getState().select({ kind: 'poi', poi });
    const deleteSpy = vi.spyOn(mapApi, 'deletePOI').mockResolvedValue({ ok: true });
    await useMapStore.getState().deletePOI('sel');
    expect(useMapStore.getState().selection).toBeNull();
    expect(useMapStore.getState().pois).toHaveLength(0);
    deleteSpy.mockRestore();
  });
});

/* ─── MarkerCard ────────────────────────────────────────────────────────────── */

describe.skip('MarkerCard', () => {
  beforeEach(() => resetStores());

  it('renders nothing when no selection', async () => {
    const { MarkerCard } = await import('../components/map/MarkerCard');
    const { container } = render(<MarkerCard />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders POI details', async () => {
    const poi = makePOI({ name: 'Safehouse', category: 'intel', notes: 'watch entrance' });
    useMapStore.setState({ selection: { kind: 'poi', poi } });
    const { MarkerCard } = await import('../components/map/MarkerCard');
    render(<MarkerCard />);
    expect(screen.getByText('Safehouse')).toBeDefined();
    expect(screen.getByText('INTEL')).toBeDefined();
    expect(screen.getByText('watch entrance')).toBeDefined();
  });

  it('renders wardriving record details', async () => {
    const record = makeRecord({ ssid: 'Secret-AP', rssi: -72 });
    useMapStore.setState({ selection: { kind: 'wardriving', record } });
    const { MarkerCard } = await import('../components/map/MarkerCard');
    render(<MarkerCard />);
    expect(screen.getByText('Secret-AP')).toBeDefined();
    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeDefined();
    expect(screen.getByText('-72 dBm')).toBeDefined();
  });

  it('close button clears selection', async () => {
    const poi = makePOI();
    useMapStore.setState({ selection: { kind: 'poi', poi } });
    const { MarkerCard } = await import('../components/map/MarkerCard');
    render(<MarkerCard />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(useMapStore.getState().selection).toBeNull();
  });
});

/* ─── TacticalMap ───────────────────────────────────────────────────────────── */

describe.skip('TacticalMap', () => {
  beforeEach(() => {
    resetStores();
    // Stub map API calls
    useMapStore.setState({
      loadWardriving: vi.fn(async () => { }),
      loadHeatmap: vi.fn(async () => { }),
      loadPOIs: vi.fn(async () => { }),
      loadTrack: vi.fn(async () => { }),
      savePOI: vi.fn(async () => null),
    });
  });

  it('mounts and renders layer panel', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    expect(screen.getByLabelText('Tactical map')).toBeDefined();
    expect(screen.getByLabelText('Base')).toBeDefined();
    expect(screen.getByLabelText('Wardriving')).toBeDefined();
    expect(screen.getByLabelText('Heatmap')).toBeDefined();
  });

  it('layer toggle updates store', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    const heatBtn = screen.getByLabelText('Heatmap');
    expect(useMapStore.getState().layers.heatmap).toBe(false);
    fireEvent.click(heatBtn);
    expect(useMapStore.getState().layers.heatmap).toBe(true);
  });

  it('centre-on-me button disabled when no GPS fix', async () => {
    useSystemStore.setState({
      state: SystemState.FOCUS,
      previousState: null,
      stateHistory: [],
      authenticated: true,
      wsConnected: true,
      context: {
        timestamp: Date.now(),
        who: { user_id: null, username: null, confidence: 0, auth_method: null, role: null },
        where: { lat: null, lon: null, fix: false, satellites: 0, speed_kmh: 0, place_known: false, place_name: null, first_visit: false },
        when: { time: '12:00', hour: 12, day_of_week: 'mon', date: '2026-04-16', work_hours: true, is_night: false },
        body: { breathing_bpm: null, breathing_state: 'normal', stress_level: 0.3, motion_energy: 0, static_energy: 0, user_distance_cm: null },
        env: { temp_c: null, pressure_hpa: null, aqi: null },
        presence: { user_detected: false, user_distance_cm: null, other_detected: false, other_distance_cm: null },
        history: { last_interaction_ago_s: 0, last_state_change_ago_s: 0, mood_trend: 'stable', active_timers: 0, pending_events_1h: 0 },
        memory_hints: [],
        system: { state: SystemState.FOCUS, uptime_s: 0, cpu_percent: 0, ram_percent: 0, disk_percent: 0, wifi_connected: false, internet_available: false, ai_provider: 'gemini', stt_engine: 'whisper' },
      },
    });
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    const btn = screen.getByLabelText('Centre on operator') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('drop POI button calls savePOI (after confirm)', async () => {
    const saveSpy = vi.fn(async () => null);
    useMapStore.setState({ savePOI: saveSpy });
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    await waitFor(() => screen.getByLabelText('Drop POI'));
    act(() => {
      fireEvent.click(screen.getByLabelText('Drop POI'));
    });
    // Confirm dialog appears with a dedicated "Confirm POI" button.
    await waitFor(() => screen.getByLabelText('Confirm POI'));
    act(() => {
      fireEvent.click(screen.getByLabelText('Confirm POI'));
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const call = saveSpy.mock.calls[0] as unknown as [{
      lat: number; lon: number; category: string;
    }];
    expect(call[0].category).toBe('saved');
  });

  it('shows Live status chip when not loading', async () => {
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('shows Syncing status chip when loading', async () => {
    useMapStore.setState({ loading: true });
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    expect(screen.getByText('Syncing')).toBeDefined();
  });

  it('renders marker card when selection is set', async () => {
    const poi = makePOI({ name: 'OpsCenter', category: 'intel' });
    useMapStore.setState({ selection: { kind: 'poi', poi } });
    const { OmniMap } = await import('../components/map/OmniMap');
    render(<OmniMap bridgeAgent={false} />);
    expect(screen.getByText('OpsCenter')).toBeDefined();
  });
});

/* ─── mapTokens ─────────────────────────────────────────────────────────────── */

describe.skip('mapTokens', () => {
  it('poiColor returns expected key per category', async () => {
    const { getMapTokens, poiColor } = await import('../components/map/mapTokens');
    const tokens = getMapTokens();
    expect(poiColor(tokens, 'threat')).toBe(tokens.signalAlert);
    expect(poiColor(tokens, 'intel')).toBe(tokens.signalInfo);
    expect(poiColor(tokens, 'home')).toBe(tokens.signalOk);
    expect(poiColor(tokens, 'custom')).toBe(tokens.inkSecondary);
    expect(poiColor(tokens, 'unknown-category')).toBe(tokens.inkSecondary);
  });

  it('resolveCssVar returns fallback when no document', async () => {
    const { resolveCssVar } = await import('../components/map/mapTokens');
    const result = resolveCssVar('--definitely-not-set-xyz', '#abc');
    expect(result).toBe('#abc');
  });

  it('buildPhantomStyle returns an OpenFreeMap style URL string, not a raster style object', async () => {
    const { getMapTokens, buildPhantomStyle } = await import('../components/map/mapTokens');
    const tokens = getMapTokens();
    const style = buildPhantomStyle(tokens, 'dark');
    expect(typeof style).toBe('string');
    expect(style).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  });

  it('buildPhantomStyle resolves the retired satellite style to streets (liberty) with a warning', async () => {
    const { getMapTokens, buildPhantomStyle } = await import('../components/map/mapTokens');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tokens = getMapTokens();
    expect(buildPhantomStyle(tokens, 'satellite')).toBe('https://tiles.openfreemap.org/styles/liberty');
    warnSpy.mockRestore();
  });

  it('buildPhantomStyle never returns tile.openstreetmap.org or arcgisonline URLs', async () => {
    const { getMapTokens, buildPhantomStyle } = await import('../components/map/mapTokens');
    const tokens = getMapTokens();
    (['dark', 'streets', 'satellite'] as const).forEach((style) => {
      const url = buildPhantomStyle(tokens, style);
      expect(url).not.toMatch(/tile\.openstreetmap\.org/);
      expect(url).not.toMatch(/arcgisonline/);
    });
  });

  it('preserveOverlayLayers carries phantom-prefixed sources/layers across a base-style swap', async () => {
    const { preserveOverlayLayers } = await import('../components/map/mapTokens');
    const previous = {
      version: 8,
      sources: {
        'openfreemap-base': { type: 'vector', url: 'https://old.example/tiles.json' },
        'phantom-track-src': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'background', type: 'background' },
        { id: 'phantom-track-layer', type: 'line', source: 'phantom-track-src' },
      ],
    } as any;
    const next = {
      version: 8,
      sources: { 'openfreemap-base-2': { type: 'vector', url: 'https://new.example/tiles.json' } },
      layers: [{ id: 'background-2', type: 'background' }],
    } as any;

    const merged = preserveOverlayLayers(previous, next);

    expect(merged.sources).toHaveProperty('phantom-track-src');
    expect(merged.sources).toHaveProperty('openfreemap-base-2');
    expect(merged.sources).not.toHaveProperty('openfreemap-base');
    expect((merged.layers as Array<{ id: string }>).map((l) => l.id)).toEqual(
      expect.arrayContaining(['background-2', 'phantom-track-layer']),
    );
  });

  it('preserveOverlayLayers is a no-op when there is no previous style', async () => {
    const { preserveOverlayLayers } = await import('../components/map/mapTokens');
    const next = { version: 8, sources: {}, layers: [] } as any;
    expect(preserveOverlayLayers(undefined, next)).toBe(next);
  });
});
