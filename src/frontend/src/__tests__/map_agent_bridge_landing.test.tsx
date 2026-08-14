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
import { useMapStore } from '../stores/mapStore';

function dispatch(op: string, payload: Record<string, unknown>, narrative = ''): void {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  });
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
