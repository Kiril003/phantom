import { create } from 'zustand';
import type { WardrivingRecord, MapPOI, HeatmapPoint, TrackPoint } from '@shared/types';
import { mapApi, type Bounds } from '../services/api';

export type MapLayerKey = 'base' | 'presence' | 'wardriving' | 'heatmap' | 'intel' | 'recon';

export type MapSelection =
  | { kind: 'poi'; poi: MapPOI }
  | { kind: 'wardriving'; record: WardrivingRecord }
  | null;

interface MapStoreState {
  wardrivingRecords: WardrivingRecord[];
  heatmap: HeatmapPoint[];
  pois: MapPOI[];
  track: TrackPoint[];
  center: [number, number] | null;
  zoom: number;
  layers: Record<MapLayerKey, boolean>;
  selection: MapSelection;
  loading: boolean;
  error: string | null;

  setWardrivingRecords: (records: WardrivingRecord[]) => void;
  appendWardrivingRecords: (records: WardrivingRecord[]) => void;
  setHeatmap: (points: HeatmapPoint[]) => void;
  setPOIs: (pois: MapPOI[]) => void;
  appendPOI: (poi: MapPOI) => void;
  removePOI: (id: string) => void;
  setTrack: (points: TrackPoint[]) => void;
  appendTrackPoint: (point: TrackPoint) => void;
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;

  toggleLayer: (key: MapLayerKey) => void;
  setLayer: (key: MapLayerKey, visible: boolean) => void;
  select: (selection: MapSelection) => void;
  setError: (e: string | null) => void;

  loadWardriving: (bounds?: Bounds, since?: string) => Promise<void>;
  loadHeatmap: (bounds?: Bounds, minWeight?: number) => Promise<void>;
  loadPOIs: (category?: string) => Promise<void>;
  loadTrack: (hours?: number) => Promise<void>;
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
};

export const useMapStore = create<MapStoreState>((set, get) => ({
  wardrivingRecords: [],
  heatmap: [],
  pois: [],
  track: [],
  center: null,
  zoom: 15,
  layers: DEFAULT_LAYERS,
  selection: null,
  loading: false,
  error: null,

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
    set((s) => ({ track: [...s.track.slice(-999), point] })),
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),

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
