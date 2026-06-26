/**
 * Phase 9.4b — NearbyPanel rendering + fetch behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NearbyPanel } from '../components/map/NearbyPanel';

vi.mock('../services/api', () => ({
  mapApi: {
    getNearby: vi.fn(),
  },
}));

import { mapApi } from '../services/api';

const emptyResponse = { remembered: [], osm: [], pois: [] };
const populatedResponse = {
  remembered: [
    {
      id: 'm1',
      content: 'Вечір з друзями',
      category: 'location_reference',
      importance: 0.5,
      place_name: 'Кав\'ярня',
      place_lat: 50.45,
      place_lon: 30.52,
      place_source: 'ner_extracted',
      place_confidence: 0.7,
      distance_m: 120,
      created_at: new Date().toISOString(),
    },
  ],
  osm: [
    {
      osm_id: 1,
      name: 'Parkava',
      type: 'leisure=park',
      lat: 50.45,
      lon: 30.52,
      tags: {},
      distance_m: 250,
    },
  ],
  pois: [
    {
      id: 'p1',
      name: 'Home',
      category: 'home',
      lat: 50.45,
      lon: 30.52,
      distance_m: 80,
    },
  ],
};

describe('NearbyPanel', () => {
  beforeEach(() => {
    vi.mocked(mapApi.getNearby).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render below zoom threshold', () => {
    vi.mocked(mapApi.getNearby).mockResolvedValue(emptyResponse);
    const { container } = render(
      <NearbyPanel lat={50.45} lon={30.52} zoom={12} />
    );
    expect(container.firstChild).toBeNull();
    expect(mapApi.getNearby).not.toHaveBeenCalled();
  });

  it('does not render when position missing', () => {
    const { container } = render(<NearbyPanel lat={null} lon={null} zoom={16} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows empty-state pill when nothing nearby (does not disappear)', async () => {
    vi.mocked(mapApi.getNearby).mockResolvedValue(emptyResponse);
    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);
    await waitFor(() => expect(mapApi.getNearby).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(/Околиці пусті/i)).toBeInTheDocument();
    });
  });

  it('shows retry pill on fetch error', async () => {
    vi.mocked(mapApi.getNearby).mockRejectedValue(new Error('overpass timeout'));
    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Nearby lookup failed — retry/i })
      ).toBeInTheDocument();
    });
  });

  it('shows collapsed pill with combined count', async () => {
    vi.mocked(mapApi.getNearby).mockResolvedValue(populatedResponse);
    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);
    await waitFor(() => {
      expect(screen.getByText(/3 поруч/)).toBeInTheDocument();
    });
  });

  it('expands to show three sections on click', async () => {
    vi.mocked(mapApi.getNearby).mockResolvedValue(populatedResponse);
    render(<NearbyPanel lat={50.45} lon={30.52} zoom={16} />);
    await waitFor(() => screen.getByText(/3 поруч/));
    fireEvent.click(screen.getByRole('button', { name: /3 places nearby/i }));
    expect(screen.getByText("Пам'ять")).toBeInTheDocument();
    expect(screen.getByText("Об'єкти")).toBeInTheDocument();
    expect(screen.getByText("Збережене")).toBeInTheDocument();
  });

  it('invokes onSelect with the correct kind when entry clicked', async () => {
    vi.mocked(mapApi.getNearby).mockResolvedValue(populatedResponse);
    const onSelect = vi.fn();
    render(
      <NearbyPanel lat={50.45} lon={30.52} zoom={16} onSelect={onSelect} />
    );
    await waitFor(() => screen.getByText(/3 поруч/));
    fireEvent.click(screen.getByRole('button', { name: /3 places nearby/i }));
    fireEvent.click(screen.getByText('Home'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'poi' })
    );
  });
});
