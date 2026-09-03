import { useEffect, useRef } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';

/**
 * ReconLayer — renders the recent GPS track as a glowing polyline.
 * Updates incrementally as new track points arrive from ContextEngine.
 */
export function ReconLayer() {
  const { map, ready } = useMapInstance();
  const track = useMapStore((s) => s.track);
  const sourceIdRef = useRef<string>('phantom-track-src');
  const layerIdRef = useRef<string>('phantom-track-layer');

  useEffect(() => {
    if (!map || !ready) return;
    const tokens = getMapTokens();

    const sourceId = sourceIdRef.current;
    const layerId = layerIdRef.current;

    const geojson = {
      type: 'FeatureCollection',
      features: track.length > 1
        ? [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: track.map((p) => [p.lon, p.lat]),
            },
            properties: {},
          }]
        : [],
    };

    try {
      let source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!source) {
        map.addSource(sourceId, {
          type: 'geojson',
           
          data: geojson as any,
        });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': tokens.accent,
            'line-width': 3,
            'line-opacity': 0.7,
            'line-blur': 0.5,
          },
        });
      } else {
         
        source.setData(geojson as any);
      }
    } catch {
      /* map style not ready yet */
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        /* ignore teardown errors */
      }
    };
  }, [map, ready, track]);

  return null;
}
