/**
 * Phase 24-E — LayerLibraryPanel tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../services/api', () => ({
  mapApi: {
    getLayers: vi.fn(),
    enableLayer: vi.fn(),
    disableLayer: vi.fn(),
  },
}));

import { mapApi } from '../services/api';
import { LayerLibraryPanel } from '../components/map/panels/LayerLibraryPanel';

const sample = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'frontline',
  name_ua: 'Лінія фронту',
  name_en: 'Frontline',
  category: 'ukraine',
  license: 'CC-BY-NC-SA',
  attribution: 'DeepStateMap.live',
  source: { type: 'rest_polling', ttl_s: 600, bbox_required: false, extras: {} },
  geometry: 'polygon',
  style: { fill_opacity: 0.18, stroke_width: 2, point_radius: 4, pulse: false, legend: [] },
  agent_verbs: ['map.frontline_status'],
  require_internet: true,
  require_setting: 'alerts.frontline.enabled',
  require_root: false,
  private: false,
  priority: 'critical',
  default_active: false,
  available_offline: false,
  tags: ['ukraine'],
  active: false,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(mapApi.getLayers).mockReset();
  vi.mocked(mapApi.enableLayer).mockReset();
  vi.mocked(mapApi.disableLayer).mockReset();
  vi.mocked(mapApi.getLayers).mockResolvedValue({
    layers: [
      sample(),
      sample({
        id: 'bunkers',
        name_ua: 'Бункери',
        name_en: 'Bunkers',
        category: 'hacker',
        attribution: '© OSM',
        require_root: true,
        active: false,
      }),
      sample({
        id: 'sun_moon',
        name_ua: 'Сонце / Місяць',
        name_en: 'Sun & Moon',
        category: 'astronomy',
        attribution: 'PHANTOM suncalc',
        require_internet: false,
        available_offline: true,
        active: true,
      }),
    ],
    total: 26,
    categories: ['ukraine', 'hacker', 'astronomy'],
    load_errors: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LayerLibraryPanel', () => {
  it('renders nothing when closed', () => {
    const { queryByTestId } = render(
      <LayerLibraryPanel open={false} onClose={() => {}} />,
    );
    expect(queryByTestId('layer-library-panel')).not.toBeInTheDocument();
  });

  it('loads and lists layers when opened', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('layer-library-list')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('layer-row-frontline')).toBeInTheDocument();
    expect(screen.getByTestId('layer-row-bunkers')).toBeInTheDocument();
    expect(screen.getByTestId('layer-row-sun_moon')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('filters by search query (id / name / attribution)', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-frontline');
    fireEvent.change(screen.getByTestId('layer-library-search'), {
      target: { value: 'бункер' },
    });
    expect(screen.getByTestId('layer-row-bunkers')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-frontline')).not.toBeInTheDocument();
  });

  it('filters by category chip', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-frontline');
    fireEvent.click(screen.getByTestId('filter-cat-astronomy'));
    expect(screen.getByTestId('layer-row-sun_moon')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-frontline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-bunkers')).not.toBeInTheDocument();
  });

  it('filters by offline mode', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-frontline');
    fireEvent.click(screen.getByTestId('filter-offline'));
    expect(screen.getByTestId('layer-row-sun_moon')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-frontline')).not.toBeInTheDocument();
  });

  it('filters by ROOT-only mode', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-frontline');
    fireEvent.click(screen.getByTestId('filter-root'));
    expect(screen.getByTestId('layer-row-bunkers')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-frontline')).not.toBeInTheDocument();
  });

  it('toggles a layer ON when off chip clicked', async () => {
    vi.mocked(mapApi.enableLayer).mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: ['frontline'],
      attribution: [],
    });
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-frontline');
    await act(async () => {
      fireEvent.click(screen.getByTestId('layer-row-frontline-toggle'));
    });
    expect(mapApi.enableLayer).toHaveBeenCalledWith('frontline');
  });

  it('toggles a layer OFF when on chip clicked', async () => {
    vi.mocked(mapApi.disableLayer).mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: [],
      attribution: [],
    });
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-sun_moon');
    await act(async () => {
      fireEvent.click(screen.getByTestId('layer-row-sun_moon-toggle'));
    });
    expect(mapApi.disableLayer).toHaveBeenCalledWith('sun_moon');
  });

  it('renders ROOT marker only on root-required rows', async () => {
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await screen.findByTestId('layer-row-bunkers');
    expect(screen.getByTestId('layer-row-bunkers-root')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-row-frontline-root')).not.toBeInTheDocument();
  });

  it('shows error state on getLayers failure', async () => {
    vi.mocked(mapApi.getLayers).mockRejectedValue(new Error('500 oh no'));
    render(<LayerLibraryPanel open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('layer-library-error')).toBeInTheDocument(),
    );
  });

  it('calls onClose when close button clicked', async () => {
    const close = vi.fn();
    render(<LayerLibraryPanel open onClose={close} />);
    await screen.findByTestId('layer-row-frontline');
    fireEvent.click(screen.getByTestId('layer-library-close'));
    expect(close).toHaveBeenCalledOnce();
  });
});
