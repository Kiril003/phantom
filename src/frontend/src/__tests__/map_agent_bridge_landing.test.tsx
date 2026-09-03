/**
 * `docs/design/chat-teardown.md` §7 / `docs/design/tools-audit.md` §8d:
 * the agent→map WS bridge (`useMapAgentBridge.ts`) only ever applied
 * `set_view` / `fly_to` / `enable_layer` / `disable_layer` / `time_travel`
 * to `mapStore`. `add_marker`, `route`, `snapshot` and `open_map` were
 * computed correctly on the backend and then fell through to
 * `store.setToast(narrative)` only — the marker/route/snapshot never
 * reached map state, so the map never moved.
 *
 * This file proves each op now lands in `mapStore` for real, one op per
 * `describe` block, landed and committed independently. A test asserting
 * `wsClient.on` was called proves nothing here — every assertion below
 * reads the resulting store state a renderer (`IntelLayer`, `RouteLayer`,
 * ...) actually consumes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const navigateSpy = vi.fn();
const locationState = { pathname: '/chat' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<object>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy, useLocation: () => locationState };
});

vi.mock('../services/websocket', () => {
  const handlers: Record<string, ((msg: unknown) => void)[]> = {};
  return {
    wsClient: {
      on: vi.fn(
        <T,>(channel: string, handler: (msg: T) => void) => {
          (handlers[channel] = handlers[channel] || []).push(handler as (msg: unknown) => void);
          return () => {
            const arr = handlers[channel] || [];
            const idx = arr.indexOf(handler as (msg: unknown) => void);
            if (idx >= 0) arr.splice(idx, 1);
          };
        },
      ),
      __dispatch: (channel: string, msg: unknown) => {
        for (const h of handlers[channel] || []) h(msg);
      },
    },
  };
});

import { wsClient } from '../services/websocket';
import { useMapAgentBridge } from '../hooks/useMapAgentBridge';
import { useMapOpenNavigator } from '../hooks/useMapOpenNavigator';
import { useMapStore } from '../stores/mapStore';

function dispatch(op: string, payload: Record<string, unknown>, narrative = ''): void {
  act(() => {
     
    (wsClient as any).__dispatch('map', {
      channel: 'map',
      type: op,
      data: { op, payload, narrative },
    });
  });
}

function BridgeHarness(): JSX.Element {
  useMapAgentBridge();
  return <div data-testid="bridge-harness" />;
}

function OpenNavigatorHarness(): JSX.Element {
  useMapOpenNavigator();
  return <div data-testid="open-navigator-harness" />;
}

const DEFAULT_LAYERS = {
  base: true, presence: true, wardriving: true, heatmap: false,
  intel: true, recon: false, facts: true, cliff_scree: false,
};

beforeEach(() => {
  useMapStore.setState({
    pois: [],
    center: null,
    zoom: 14,
    layers: { ...DEFAULT_LAYERS },
    toast: null,
    route: null,
    routing: false,
    routeError: null,
    lastSnapshot: null,
  });
  navigateSpy.mockClear();
  locationState.pathname = '/chat';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMapAgentBridge — map.add_marker lands on the map', () => {
  it('appends the agent-placed marker to mapStore.pois (rendered by IntelLayer)', () => {
    render(<BridgeHarness />);
    expect(useMapStore.getState().pois).toHaveLength(0);

    dispatch(
      'add_marker',
      {
        id: 'poi-1',
        lat: 50.45,
        lon: 30.52,
        name: 'Спостережний пункт',
        category: 'intel',
        icon: '👁',
        is_secret: false,
        created_at: '2026-08-15T10:00:00Z',
      },
      'Додав маркер «Спостережний пункт» у 50.4500, 30.5200.',
    );

    const { pois, toast } = useMapStore.getState();
    expect(pois).toHaveLength(1);
    expect(pois[0]).toMatchObject({
      id: 'poi-1',
      lat: 50.45,
      lon: 30.52,
      name: 'Спостережний пункт',
      category: 'intel',
      icon: '👁',
      is_secret: false,
    });
    // The old behaviour: only the toast changed. Now the toast still
    // fires (it's honest — the marker really was added) AND the marker
    // is really on the map.
    expect(toast).toContain('Спостережний пункт');
  });

  it('drops a malformed add_marker payload instead of corrupting the POI list', () => {
    render(<BridgeHarness />);
    dispatch('add_marker', { id: 'poi-2', lat: 'not-a-number', lon: 30.52, name: 'x' });
    expect(useMapStore.getState().pois).toHaveLength(0);
  });

  it('falls back to the custom category for an unrecognised category string', () => {
    render(<BridgeHarness />);
    dispatch('add_marker', { id: 'poi-3', lat: 50.0, lon: 30.0, name: 'y', category: 'bogus' });
    expect(useMapStore.getState().pois[0]?.category).toBe('custom');
  });
});

describe('useMapAgentBridge — map.plan_route lands on the map', () => {
  const PRIMARY = {
    distance_m: 12400,
    duration_s: 1080,
    geometry: {
      type: 'LineString',
      coordinates: [
        [30.5234, 50.4501],
        [30.55, 50.46],
        [30.60, 50.47],
      ],
    },
    summary: '',
    extras: {},
  };

  it('turns a plan_route mutation into mapStore.route (drawn by RouteLayer)', () => {
    render(<BridgeHarness />);
    expect(useMapStore.getState().route).toBeNull();

    dispatch(
      'route',
      { engine: 'osrm', profile: 'car', primary: PRIMARY, alternatives_count: 0 },
      'Маршрут 12.4 км / 18 хв через osrm.',
    );

    const { route, toast } = useMapStore.getState();
    expect(route).not.toBeNull();
    expect(route?.result.primary.geometry.coordinates).toEqual(PRIMARY.geometry.coordinates);
    expect(route?.result.engine).toBe('osrm');
    // Endpoints RouteLayer places its two dot markers at — taken from the
    // geometry's own first/last point, since the backend never resolved
    // place-name labels for an agent-planned route.
    expect(route?.from).toMatchObject({ lat: 50.4501, lon: 30.5234 });
    expect(route?.to).toMatchObject({ lat: 50.47, lon: 30.60 });
    expect(toast).toContain('12.4 км');
  });

  it('ignores a route mutation from isochrone/snap_track/optimize_visit (no primary field) without throwing', () => {
    render(<BridgeHarness />);
    expect(() =>
      dispatch('route', { engine: 'osrm', target: 'isochrone', geometry: { type: 'Polygon', coordinates: [] } }),
    ).not.toThrow();
    expect(useMapStore.getState().route).toBeNull();
  });

  it('ignores a route payload with fewer than two coordinates', () => {
    render(<BridgeHarness />);
    dispatch('route', {
      engine: 'osrm',
      primary: { ...PRIMARY, geometry: { type: 'LineString', coordinates: [[30.5, 50.45]] } },
    });
    expect(useMapStore.getState().route).toBeNull();
  });
});

describe('useMapOpenNavigator — map.open_map actually opens the map', () => {
  it('navigates to /map on an open_map mutation received while on another screen', () => {
    locationState.pathname = '/chat';
    render(<OpenNavigatorHarness />);

    dispatch('open_map', { reason: 'show frontline' }, 'Відкриваю мапу — show frontline.');

    expect(navigateSpy).toHaveBeenCalledWith('/map');
    expect(useMapStore.getState().toast).toContain('Відкриваю мапу');
  });

  it('does not navigate again when already on /map (no-op, not a loop)', () => {
    locationState.pathname = '/map';
    render(<OpenNavigatorHarness />);

    dispatch('open_map', { reason: '' }, 'Відкриваю мапу.');

    expect(navigateSpy).not.toHaveBeenCalled();
    // The toast still fires — the operator gets the "why" even if the
    // screen doesn't change, same as useMapAgentBridge's own toast path.
    expect(useMapStore.getState().toast).toContain('Відкриваю мапу');
  });

  it('ignores non-open_map ops on the same channel', () => {
    locationState.pathname = '/chat';
    render(<OpenNavigatorHarness />);

    dispatch('set_view', { center: [30.5, 50.45], zoom: 12 }, 'jumped');

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('useMapAgentBridge — map.snapshot lands as an honest bookmark, not a fake photo', () => {
  it('records active layers + this tab\'s own live camera, tagged hasImage: false', () => {
    useMapStore.setState({ center: [30.55, 50.46], zoom: 13.5 });
    render(<BridgeHarness />);
    expect(useMapStore.getState().lastSnapshot).toBeNull();

    dispatch(
      'snapshot',
      {
        snapshot_id: 'snap-123',
        label: 'зимовий рейд',
        active_layer_ids: ['frontline', 'wardriving'],
        task_id: 't1',
        step_idx: 0,
      },
      'Зберіг стан мапи «зимовий рейд» (#snap-123): 2 активних шарів. '
        + 'Зображення не знімається — цю можливість ще не підключено.',
    );

    const { lastSnapshot, toast } = useMapStore.getState();
    expect(lastSnapshot).not.toBeNull();
    expect(lastSnapshot).toMatchObject({
      id: 'snap-123',
      label: 'зимовий рейд',
      activeLayerIds: ['frontline', 'wardriving'],
      // The camera comes from THIS tab's own store — the backend never
      // sent it, because it never had it.
      center: [30.55, 50.46],
      zoom: 13.5,
      hasImage: false,
    });
    // The honesty check: the toast must say there is no image, not
    // merely stay silent about it — a snapshot verb that lets the
    // operator assume a picture exists is the defect this fixes.
    expect(toast).toContain('Зображення не знімається');
  });

  it('drops a snapshot payload with no snapshot_id instead of writing a bookmark with no identity', () => {
    render(<BridgeHarness />);
    dispatch('snapshot', { label: 'x', active_layer_ids: [] });
    expect(useMapStore.getState().lastSnapshot).toBeNull();
  });

  it('defaults active_layer_ids to empty rather than throwing on a malformed list', () => {
    render(<BridgeHarness />);
    dispatch('snapshot', { snapshot_id: 'snap-1', active_layer_ids: 'not-an-array' });
    expect(useMapStore.getState().lastSnapshot?.activeLayerIds).toEqual([]);
  });
});
