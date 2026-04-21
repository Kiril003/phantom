/**
 * Phase 9.4c audit G6 — FactMarkerLayer data-flow tests.
 *
 * Exercises:
 *   1. mapStore.loadGeoTaggedFacts populates state.geoTaggedFacts
 *   2. MapSelection carries a 'fact' kind so MarkerCard can render it
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('../services/api', () => ({
  mapApi: {
    getGeoTaggedFacts: vi.fn(),
  },
}));

import { mapApi } from '../services/api';
import { useMapStore } from '../stores/mapStore';

describe('mapStore.loadGeoTaggedFacts', () => {
  beforeEach(() => {
    vi.mocked(mapApi.getGeoTaggedFacts).mockReset();
    useMapStore.setState({ geoTaggedFacts: [], selection: null });
  });
  afterEach(() => {
    useMapStore.setState({ geoTaggedFacts: [], selection: null });
  });

  it('fetches facts and stores them', async () => {
    const mockFacts = [
      {
        id: 'f1',
        content: 'Had coffee here',
        category: 'location_reference',
        importance: 0.7,
        place_name: 'Кав\'ярня',
        place_lat: 50.45,
        place_lon: 30.52,
        place_source: 'ner_extracted',
        place_confidence: 0.85,
        created_at: new Date().toISOString(),
      },
    ];
    vi.mocked(mapApi.getGeoTaggedFacts).mockResolvedValue({
      facts: mockFacts,
      total: 1,
    });

    await act(async () => {
      await useMapStore.getState().loadGeoTaggedFacts();
    });

    expect(mapApi.getGeoTaggedFacts).toHaveBeenCalledTimes(1);
    const facts = useMapStore.getState().geoTaggedFacts;
    expect(facts.length).toBe(1);
    expect(facts[0].id).toBe('f1');
  });

  it('preserves previous facts on fetch error', async () => {
    useMapStore.setState({
      geoTaggedFacts: [
        {
          id: 'pre',
          content: 'existing',
          category: 'fact',
          importance: 0.3,
          place_name: null,
          place_lat: 1,
          place_lon: 2,
          place_source: null,
          place_confidence: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(mapApi.getGeoTaggedFacts).mockRejectedValue(new Error('network'));

    await act(async () => {
      await useMapStore.getState().loadGeoTaggedFacts();
    });

    const facts = useMapStore.getState().geoTaggedFacts;
    expect(facts.length).toBe(1);
    expect(facts[0].id).toBe('pre');
  });
});

describe('mapStore.select with fact kind', () => {
  it('stores a fact selection for MarkerCard to render', () => {
    const fact = {
      id: 'x',
      content: 'x',
      category: 'fact',
      importance: 0.5,
      place_name: null,
      place_lat: 1,
      place_lon: 2,
      place_source: null,
      place_confidence: null,
      created_at: new Date().toISOString(),
    };
    useMapStore.getState().select({ kind: 'fact', fact });
    const sel = useMapStore.getState().selection;
    expect(sel?.kind).toBe('fact');
    if (sel?.kind === 'fact') {
      expect(sel.fact.id).toBe('x');
    }
  });
});
