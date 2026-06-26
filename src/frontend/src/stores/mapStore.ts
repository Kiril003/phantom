import { create } from 'zustand';
import type { WardrivingRecord, MapPOI, HeatmapPoint, TrackPoint } from '@shared/types';
import { mapApi, type Bounds, type GeoTaggedFact } from '../services/api';

// Keep the most recent N track points client-side. Older points are
// dropped on append; full history is re-hydrated from the backend via
// `loadTrack(hours)` when the user widens the time window.
export const MAX_TRACK_HISTORY = 1000;

export type MapLayerKey =
  | 'base'
  | 'presence'
  | 'wardriving'
  | 'heatmap'
  | 'intel'
  | 'recon'
  // Phase 9.4c audit G6 — geo-tagged memory facts rendered as subtle markers.
  | 'facts';

export type MapSelection =
  | { kind: 'poi'; poi: MapPOI }
  | { kind: 'wardriving'; record: WardrivingRecord }
  | { kind: 'fact'; fact: GeoTaggedFact }
  | { kind: 'geofence'; geofence: any }
  | null;

interface MapStoreState {
  wardrivingRecords: WardrivingRecord[];
  heatmap: HeatmapPoint[];
  pois: MapPOI[];
  track: TrackPoint[];
  geoTaggedFacts: GeoTaggedFact[];
  geofences: any[];
  center: [number, number] | null;
  zoom: number;
  layers: Record<MapLayerKey, boolean>;
  selection: MapSelection;
  loading: boolean;
  error: string | null;
  /** Phase 24-H — Time Machine date (ISO string). Defaults to 'today'. */
  temporalDate: string;
  
  /** Phase 24-PRE — Tactical HUD info synced from context. */
  tactical: {
    lat: number | null;
    lon: number | null;
    bearing: number;
    satellites: number;
    speed: number;
    fix: boolean;
    source: string;
  };

  setWardrivingRecords: (records: WardrivingRecord[]) => void;
  appendWardrivingRecords: (records: WardrivingRecord[]) => void;
  setHeatmap: (points: HeatmapPoint[]) => void;
  setPOIs: (pois: MapPOI[]) => void;
  appendPOI: (poi: MapPOI) => void;
  removePOI: (id: string) => void;
  setTrack: (points: TrackPoint[]) => void;
  appendTrackPoint: (point: TrackPoint) => void;
  setGeofences: (gfs: any[]) => void;
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
  setTemporalDate: (date: string) => void;
  setTactical: (info: Partial<MapStoreState['tactical']>) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  toast: string | null;
  setToast: (t: string | null) => void;

  toggleLayer: (key: MapLayerKey) => void;
  setLayer: (key: MapLayerKey, visible: boolean) => void;
  select: (selection: MapSelection) => void;
  setError: (e: string | null) => void;

  loadWardriving: (bounds?: Bounds, since?: string) => Promise<void>;
  loadHeatmap: (bounds?: Bounds, minWeight?: number) => Promise<void>;
  loadPOIs: (category?: string) => Promise<void>;
  loadTrack: (hours?: number) => Promise<void>;
  loadGeoTaggedFacts: () => Promise<void>;
  loadGeofences: () => Promise<void>;
  savePOI: (poi: Omit<MapPOI, 'id' | 'created_at' | 'user_id'>) => Promise<MapPOI | null>;
  deletePOI: (id: string) => Promise<boolean>;
}

const DEFAULT_LAYERS: Record<MapLayerKey, boolean> = {
  base: true,
  presence: true,
  wardriving: true,
  heatmap: false,
  intel: true,
  recon: false,
  facts: true,
};

export const useMapStore = create<MapStoreState>((set, get) => ({
  wardrivingRecords: [],
  heatmap: [],
  pois: [],
  track: [],
  geoTaggedFacts: [],
  geofences: [],
  center: null,
  zoom: 15,
  layers: DEFAULT_LAYERS,
  selection: null,
  loading: false,
  error: null,
  temporalDate: new Date().toISOString().split('T')[0],
  tactical: {
    lat: null,
    lon: null,
    bearing: 0,
    satellites: 0,
    speed: 0,
    fix: false,
    source: 'none',
  },

  setWardrivingRecords: (records) => set({ wardrivingRecords: records }),
  appendWardrivingRecords: (records) =>
    set((s) => {
      const map = new Map(s.wardrivingRecords.map((r) => [`${r.mac}|${r.lat}|${r.lon}`, r]));
      records.forEach((r) => map.set(`${r.mac}|${r.lat}|${r.lon}`, r));
      return { wardrivingRecords: Array.from(map.values()) };
    }),
  setHeatmap: (points) => set({ heatmap: points }),
  setPOIs: (pois) => set({ pois }),
  appendPOI: (poi) =>
    set((s) => ({ pois: [poi, ...s.pois.filter((p) => p.id !== poi.id)] })),
  removePOI: (id) =>
    set((s) => ({ pois: s.pois.filter((p) => p.id !== id) })),
  setTrack: (points) => set({ track: points }),
  appendTrackPoint: (point) =>
    set((s) => ({ track: [...s.track.slice(-(MAX_TRACK_HISTORY - 1)), point] })),
  setGeofences: (gfs) => set({ geofences: gfs }),
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setTemporalDate: (date) => set({ temporalDate: date }),
  setTactical: (info) => set((s) => ({ tactical: { ...s.tactical, ...info } })),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  toast: null,
  setToast: (t) => set({ toast: t }),

  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setLayer: (key, visible) =>
    set((s) => ({ layers: { ...s.layers, [key]: visible } })),
  select: (selection) => set({ selection }),
  setError: (e) => set({ error: e }),

  loadWardriving: async (bounds, since) => {
    set({ loading: true, error: null });
    try {
      const resp = await mapApi.getWardriving(bounds, since);
      set({ wardrivingRecords: resp.records, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load wardriving',
      });
    }
  },

  loadHeatmap: async (bounds, minWeight = 0) => {
    set({ loading: true, error: null });
    try {
      const resp = await mapApi.getHeatmap(bounds, minWeight);
      set({ heatmap: resp.points, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load heatmap',
      });
    }
  },

  loadPOIs: async (category) => {
    set({ loading: true, error: null });
    try {
      const resp = await mapApi.getPOIs(category);
      set({ pois: resp.pois, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load POIs',
      });
    }
  },

  loadTrack: async (hours = 2) => {
    set({ loading: true, error: null });
    try {
      const resp = await mapApi.getTrack(hours);
      set({ track: resp.points, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load track',
      });
    }
  },

  loadGeoTaggedFacts: async () => {
    try {
      const resp = await mapApi.getGeoTaggedFacts();
      set({ geoTaggedFacts: resp.facts });
    } catch (err) {
      // Non-critical — silently leave previous facts in place.
      console.warn('Failed to load geo-tagged facts:', err);
    }
  },

  loadGeofences: async () => {
    try {
      const data = await mapApi.getGeofences();
      set({ geofences: data });
    } catch (err) {
      console.warn('Failed to load geofences:', err);
    }
  },

  savePOI: async (poi) => {
    try {
      const saved = await mapApi.createPOI(poi);
      get().appendPOI(saved);
      return saved;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save POI' });
      return null;
    }
  },

  deletePOI: async (id) => {
    try {
      await mapApi.deletePOI(id);
      get().removePOI(id);
      const sel = get().selection;
      if (sel && sel.kind === 'poi' && sel.poi.id === id) {
        set({ selection: null });
      }
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete POI' });
      return false;
    }
  },
}));
