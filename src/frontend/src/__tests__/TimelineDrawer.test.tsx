/**
 * Phase 9.4b — TimelineDrawer rendering + fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimelineDrawer } from '../components/map/TimelineDrawer';

vi.mock('../services/api', () => ({
  mapApi: {
    getLocationHistory: vi.fn(),
  },
}));

import { mapApi } from '../services/api';

const sampleEntries = [
  {
    id: 'h1',
    lat: 50.45, lon: 30.52,
    source: 'gps_hardware', confidence: 0.9, accuracy_m: 10,
    place_name: 'Київ', country: 'Україна', country_code: 'UA', city: 'Київ',
    timestamp: '2026-04-20T10:00:00Z',
  },
  {
    id: 'h2',
    lat: 50.46, lon: 30.53,
    source: 'browser_geolocation', confidence: 0.8, accuracy_m: 20,
    place_name: null, country: null, country_code: null, city: null,
    timestamp: '2026-04-20T09:30:00Z',
  },
];

describe('TimelineDrawer', () => {
  beforeEach(() => {
    vi.mocked(mapApi.getLocationHistory).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is hidden when open=false', () => {
    const { container } = render(
      <TimelineDrawer open={false} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('fetches history when opened', async () => {
    vi.mocked(mapApi.getLocationHistory).mockResolvedValue({
      entries: sampleEntries, total: 2,
    });
    render(<TimelineDrawer open={true} onClose={() => {}} />);
    await waitFor(() => expect(mapApi.getLocationHistory).toHaveBeenCalled());
    expect(screen.getByText('Київ')).toBeInTheDocument();
  });

  it('close button invokes onClose', async () => {
    vi.mocked(mapApi.getLocationHistory).mockResolvedValue({
      entries: [], total: 0,
    });
    const onClose = vi.fn();
    render(<TimelineDrawer open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close timeline/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking an entry invokes onSelect with that entry', async () => {
    vi.mocked(mapApi.getLocationHistory).mockResolvedValue({
      entries: sampleEntries, total: 2,
    });
    const onSelect = vi.fn();
    render(<TimelineDrawer open={true} onClose={() => {}} onSelect={onSelect} />);
    await waitFor(() => screen.getByText('Київ'));
    fireEvent.click(screen.getByText('Київ'));
    expect(onSelect).toHaveBeenCalledWith(sampleEntries[0]);
  });

  it('shows coordinates when place_name is null', async () => {
    vi.mocked(mapApi.getLocationHistory).mockResolvedValue({
      entries: [sampleEntries[1]], total: 1,
    });
    render(<TimelineDrawer open={true} onClose={() => {}} />);
    await waitFor(() => expect(mapApi.getLocationHistory).toHaveBeenCalled());
    expect(screen.getByText(/50\.4600, 30\.5300/)).toBeInTheDocument();
  });

  it('empty state hint renders when no entries', async () => {
    vi.mocked(mapApi.getLocationHistory).mockResolvedValue({
      entries: [], total: 0,
    });
    render(<TimelineDrawer open={true} onClose={() => {}} />);
    await waitFor(() => expect(mapApi.getLocationHistory).toHaveBeenCalled());
    expect(screen.getByText(/No entries yet/i)).toBeInTheDocument();
  });
});
