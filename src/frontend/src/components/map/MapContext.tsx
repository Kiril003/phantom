import { createContext, useContext } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

export interface MapContextValue {
  map: MapLibreMap | null;
  ready: boolean;
}

export const MapContext = createContext<MapContextValue>({ map: null, ready: false });

export function useMapInstance(): MapContextValue {
  return useContext(MapContext);
}
