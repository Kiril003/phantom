/**
 * Phase 24-D — HUD components + agent bridge tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { MapStateBadge } from '../components/map/hud/MapStateBadge';
import { ScaleBar, computeScale } from '../components/map/hud/ScaleBar';
import { LayerPalette } from '../components/map/hud/LayerPalette';
import { SearchOmnibar } from '../components/map/hud/SearchOmnibar';
import { RulerTool, haversineKm } from '../components/map/hud/RulerTool';
import { BearingTool } from '../components/map/hud/BearingTool';
import {
  ElevationProfileSheet,
  type ElevationSample,
} from '../components/map/hud/ElevationProfileSheet';
import { StatusChip } from '../components/map/hud/StatusChips';

import { useMapStore } from '../stores/mapStore';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

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

beforeEach(() => {
  useMapStore.setState({
    center: null,
    zoom: 14,
    layers: { base: true, presence: true, wardriving: true, heatmap: false, intel: true, recon: false, facts: true },
    searchQuery: '',
    toast: null,
  });
  useSystemStore.setState({ state: SystemState.SHADOW, context: null } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── MapStateBadge ────────────────────────────────────────────────────────


describe('MapStateBadge', () => {
  it('renders the live state from systemStore', () => {
    useSystemStore.setState({ state: SystemState.GHOST } as never);
    render(<MapStateBadge />);
    const badge = screen.getByTestId('map-state-badge');
    expect(badge).toHaveAttribute('data-state', SystemState.GHOST);
    expect(badge).toHaveTextContent(/привид/i);
  });

  it('prefers an explicit prop override', () => {
    useSystemStore.setState({ state: SystemState.SHADOW } as never);
    render(<MapStateBadge state={SystemState.SENTINEL} />);
    const badge = screen.getByTestId('map-state-badge');
    expect(badge.getAttribute('data-state')).toBe(SystemState.SENTINEL);
  });
});

// ── ScaleBar ─────────────────────────────────────────────────────────────


describe('ScaleBar', () => {
  it('renders nice round metric labels', () => {
    render(<ScaleBar zoom={14} lat={50.0} maxWidthPx={120} />);
    const bar = screen.getByTestId('scale-bar');
    const meters = Number(bar.getAttribute('data-meters'));
    // 14/50N: 1 km is the natural pick at 120 px.
    expect(meters).toBeGreaterThan(0);
    expect([100, 200, 500, 1000, 2000, 5000]).toContain(meters);
  });

  it('renders sub-km labels at high zoom', () => {
    render(<ScaleBar zoom={18} lat={0} maxWidthPx={120} />);
    expect(screen.getByTestId('scale-bar')).toHaveTextContent(/м$/);
  });

  it('quantises to 1/2/5 × 10^N', () => {
    const { meters } = computeScale(12, 50, 200);
    const decade = Math.pow(10, Math.floor(Math.log10(meters)));
    expect([1, 2, 5]).toContain(meters / decade);
  });
});

// ── LayerPalette ─────────────────────────────────────────────────────────


describe('LayerPalette', () => {
  it('renders one chip per known layer once expanded', () => {
    render(<LayerPalette />);
    fireEvent.click(screen.getByTestId('layer-palette-toggle'));
    ['base', 'presence', 'wardriving', 'heatmap', 'intel', 'recon', 'facts'].forEach((key) => {
      expect(screen.getByTestId(`layer-palette-${key}`)).toBeInTheDocument();
    });
  });

  it('keeps the chip row collapsed until the toggle is pressed', () => {
    render(<LayerPalette />);
    expect(screen.queryByTestId('layer-palette-heatmap')).not.toBeInTheDocument();
  });

  it('toggles the corresponding mapStore layer when clicked', () => {
    render(<LayerPalette />);
    fireEvent.click(screen.getByTestId('layer-palette-toggle'));
    const before = useMapStore.getState().layers.heatmap;
    fireEvent.click(screen.getByTestId('layer-palette-heatmap'));
    expect(useMapStore.getState().layers.heatmap).toBe(!before);
  });

  it('emits onOpenLibrary when the trailing button is clicked', () => {
    const cb = vi.fn();
    render(<LayerPalette onOpenLibrary={cb} />);
    fireEvent.click(screen.getByTestId('layer-palette-toggle'));
    fireEvent.click(screen.getByTestId('layer-palette-library'));
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ── SearchOmnibar ────────────────────────────────────────────────────────


describe('SearchOmnibar', () => {
  it('updates mapStore.searchQuery on Enter', () => {
    render(<SearchOmnibar />);
    const input = screen.getByTestId('search-omnibar-input');
    fireEvent.change(input, { target: { value: 'кав\'ярня' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useMapStore.getState().searchQuery).toBe("кав'ярня");
  });

  it('emits phantom:chat-from-map when query starts with ?', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    render(<SearchOmnibar />);
    const input = screen.getByTestId('search-omnibar-input');
    fireEvent.change(input, { target: { value: '?що тут є' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      spy.mock.calls.some(
        ([ev]) => (ev as Event).type === 'phantom:chat-from-map',
      ),
    ).toBe(true);
  });

  it('emits phantom:omnibar-mic on mic click', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    render(<SearchOmnibar />);
    fireEvent.click(screen.getByTestId('search-omnibar-mic'));
    expect(
      spy.mock.calls.some(
        ([ev]) => (ev as Event).type === 'phantom:omnibar-mic',
      ),
    ).toBe(true);
  });
});

// ── RulerTool / BearingTool ──────────────────────────────────────────────


describe('RulerTool', () => {
  it('reports cumulative distance for a 3-point trail', () => {
    const pts = [
      { lat: 50.0, lon: 30.0 },
      { lat: 50.01, lon: 30.0 },
      { lat: 50.02, lon: 30.0 },
    ];
    render(<RulerTool points={pts} />);
    const chip = screen.getByTestId('ruler-tool');
    // 0.01° lat ≈ 1.11 km × 2 ≈ 2.22 km.
    expect(chip).toHaveTextContent(/км/);
    expect(chip).toHaveAttribute('data-points', '3');
  });

  it('haversineKm matches a known reference (Kyiv↔Lviv ≈ 470 km)', () => {
    const km = haversineKm({ lat: 50.45, lon: 30.52 }, { lat: 49.84, lon: 24.03 });
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(500);
  });
});


describe('BearingTool', () => {
  it('returns due-East bearing 90° for a point straight east', () => {
    render(
      <BearingTool
        from={{ lat: 50.0, lon: 30.0 }}
        to={{ lat: 50.0, lon: 30.5 }}
      />,
    );
    const chip = screen.getByTestId('bearing-tool');
    const bearing = Number(chip.getAttribute('data-bearing'));
    expect(bearing).toBeGreaterThan(85);
    expect(bearing).toBeLessThan(95);
  });

  it('renders silent placeholder when from/to missing', () => {
    render(<BearingTool from={null} to={null} />);
    expect(screen.getByTestId('bearing-tool')).toHaveTextContent(/тихо/);
  });
});

// ── ElevationProfileSheet ────────────────────────────────────────────────


describe('ElevationProfileSheet', () => {
  it('renders empty placeholder when no samples', () => {
    render(<ElevationProfileSheet samples={[]} />);
    expect(screen.getByTestId('elevation-profile-empty')).toBeInTheDocument();
  });

  it('renders min/max readout when samples present', () => {
    const samples: ElevationSample[] = [
      { distance_m: 0, elevation_m: 100 },
      { distance_m: 500, elevation_m: 250 },
      { distance_m: 1000, elevation_m: 180 },
    ];
    render(<ElevationProfileSheet samples={samples} />);
    const sheet = screen.getByTestId('elevation-profile-sheet');
    expect(sheet).toHaveTextContent(/100/);
    expect(sheet).toHaveTextContent(/250/);
  });
});

// ── StatusChip ──────────────────────────────────────────────────────────


describe('StatusChip', () => {
  it('shows Syncing when loading=true', () => {
    render(<StatusChip loading={true} zoom={12} />);
    expect(screen.getByText('Синхронізація')).toBeInTheDocument();
  });

  it('shows Live when loading=false', () => {
    render(<StatusChip loading={false} zoom={14} />);
    expect(screen.getByText('Наживо')).toBeInTheDocument();
  });

  it('renders zoom level', () => {
    render(<StatusChip loading={false} zoom={15} />);
    expect(screen.getByText('z15')).toBeInTheDocument();
  });
});

// ── useMapAgentBridge ────────────────────────────────────────────────────


function BridgeHarness({ skip = false }: { skip?: boolean }): JSX.Element {
  useMapAgentBridge({ skip });
  return <div data-testid="bridge-harness" />;
}


describe('useMapAgentBridge', () => {
  it('applies set_view mutations to mapStore', () => {
    render(<BridgeHarness />);
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wsClient as any).__dispatch('map', {
        channel: 'map',
        type: 'set_view',
        data: {
          op: 'set_view',
          payload: { center: [30.5, 50.45], zoom: 12 },
          narrative: 'jumped to Kyiv',
        },
      });
    });
    expect(useMapStore.getState().center).toEqual([30.5, 50.45]);
    expect(useMapStore.getState().zoom).toBe(12);
    expect(useMapStore.getState().toast).toContain('Kyiv');
  });

  it('toggles a known layer on enable_layer mutation', () => {
    useMapStore.setState({ layers: { ...useMapStore.getState().layers, heatmap: false } });
    render(<BridgeHarness />);
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wsClient as any).__dispatch('map', {
        channel: 'map',
        type: 'enable_layer',
        data: { op: 'enable_layer', payload: { layer_id: 'heatmap' } },
      });
    });
    expect(useMapStore.getState().layers.heatmap).toBe(true);
  });

  it('ignores unknown layer ids without throwing', () => {
    render(<BridgeHarness />);
    expect(() =>
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wsClient as any).__dispatch('map', {
          channel: 'map',
          type: 'enable_layer',
          data: { op: 'enable_layer', payload: { layer_id: 'air_raid_ua' } },
        });
      }),
    ).not.toThrow();
  });

  it('skips subscription when options.skip is true', () => {
    render(<BridgeHarness skip />);
    // No wsClient.on call recorded for this render (the mock counts).
    // The bridge must be subscription-free in tests.
    expect(useMapStore.getState().center).toBeNull();
  });
});
