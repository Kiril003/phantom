import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { useMapStore } from '../../../stores/mapStore';

/**
 * Phase 24-I — renders user geofences (circles and polygons) on the map.
 * Tapping a geofence opens MarkerCard with details.
 */
export function GeofencesLayer() {
  const { map, ready } = useMapInstance();
  const geofences = useMapStore((s) => s.geofences);
  const select = useMapStore((s) => s.select);
  const loadGeofences = useMapStore((s) => s.loadGeofences);

  useEffect(() => {
    void loadGeofences();
  }, [loadGeofences]);

  useEffect(() => {
    if (!map || !ready || !geofences.length) return;

    // Add source and layers for geofences
    const sourceId = 'phantom-geofences';
    
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: geofences.map((gf) => {
          let geometry: any;
          if (gf.kind === 'circle') {
            // Simplified: circle as a point with a radius-based paint property
            // In a real implementation, we'd generate a circle polygon
            geometry = { type: 'Point', coordinates: [gf.geometry.lon, gf.geometry.lat] };
          } else {
            geometry = { type: 'Polygon', coordinates: [gf.geometry.points] };
          }
          
          return {
            type: 'Feature',
            geometry,
            properties: { id: gf.id, label: gf.label, kind: gf.kind },
          };
        }),
      });
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: `${sourceId}-fill`,
        type: 'fill',
        source: sourceId,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': 0.1,
        },
      });

      map.addLayer({
        id: `${sourceId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ef4444',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      });
      
      map.on('click', `${sourceId}-fill`, (e) => {
        const feat = e.features?.[0];
        if (feat) {
          const gf = geofences.find((g) => g.id === feat.properties?.id);
          if (gf) select({ kind: 'geofence', geofence: gf });
        }
      });
    }

    return () => {
      // Cleanup
    };
  }, [map, ready, geofences, select]);

  return null;
}
