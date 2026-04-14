import { create } from 'zustand';
import { WardrivingRecord, MapPOI } from '@shared/types';

interface TrackPoint {
  lat: number;
  lon: number;
  ts: string;
  speed: number;
}

interface MapStoreState {
  wardrivingRecords: WardrivingRecord[];
  pois: MapPOI[];
  track: TrackPoint[];
  center: [number, number] | null;
  zoom: number;

  setWardrivingRecords: (records: WardrivingRecord[]) => void;
  appendWardrivingRecords: (records: WardrivingRecord[]) => void;
  setPOIs: (pois: MapPOI[]) => void;
  appendPOI: (poi: MapPOI) => void;
  setTrack: (points: TrackPoint[]) => void;
  appendTrackPoint: (point: TrackPoint) => void;
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
}

export const useMapStore = create<MapStoreState>((set) => ({
  wardrivingRecords: [],
  pois: [],
  track: [],
  center: null,
  zoom: 15,

  setWardrivingRecords: (records) => set({ wardrivingRecords: records }),
  appendWardrivingRecords: (records) =>
    set((s) => {
      const existing = new Map(s.wardrivingRecords.map((r) => [r.mac + r.lat + r.lon, r]));
      records.forEach((r) => existing.set(r.mac + r.lat + r.lon, r));
      return { wardrivingRecords: Array.from(existing.values()) };
    }),
  setPOIs: (pois) => set({ pois }),
  appendPOI: (poi) => set((s) => ({ pois: [...s.pois, poi] })),
  setTrack: (points) => set({ track: points }),
  appendTrackPoint: (point) =>
    set((s) => ({ track: [...s.track.slice(-999), point] })),
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
}));
