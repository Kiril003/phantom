import { useEffect, useRef } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import { useMapInstance } from './MapContext';
import { getMapTokens } from './mapTokens';
import { useMapStore } from '../../stores/mapStore';

/**
 * HeatmapLayer — renders the wardriving RSSI heatmap using MapLibre's built-in
 * heatmap layer type. Data comes from GET /map/heatmap, which returns
 * pre-aggregated weighted cells.
 */
export function HeatmapLayer() {
  const { map, ready } = useMapInstance();
  const heatmap = useMapStore((s) => s.heatmap);
  const sourceIdRef = useRef<string>('phantom-heatmap-src');
  const layerIdRef = useRef<string>('phantom-heatmap-layer');

  useEffect(() => {
    if (!map || !ready) return;

    const tokens = getMapTokens();
    const sourceId = sourceIdRef.current;
    const layerId = layerIdRef.current;

    const geojson = {
      type: 'FeatureCollection',
      features: heatmap.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          weight: p.weight,
          network_count: p.network_count ?? 0,
          rssi: p.strongest_rssi ?? -100,
        },
      })),
    };

    try {
      let source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!source) {
        map.addSource(sourceId, {
          type: 'geojson',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: geojson as any,
        });
        map.addLayer({
          id: layerId,
          type: 'heatmap',
          source: sourceId,
          paint: {
            'heatmap-weight': ['get', 'weight'],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              10, 0.6,
              18, 2.0,
            ],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,   'rgba(0,0,0,0)',
              0.2, tokens.signalInfo,
              0.5, tokens.accent,
              0.8, tokens.signalWarn,
              1.0, tokens.signalAlert,
            ],
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              10, 10,
              18, 40,
            ],
            'heatmap-opacity': 0.75,
          },
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source.setData(geojson as any);
      }
    } catch {
      /* style not ready */
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        /* ignore */
      }
    };
  }, [map, ready, heatmap]);

  return null;
}
