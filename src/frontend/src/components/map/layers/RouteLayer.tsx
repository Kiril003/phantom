import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';

/**
 * RouteLayer — renders the currently planned route as a polyline with a
 * dark casing beneath a bright line (so it reads over any basemap), plus
 * origin/destination dot markers. Always mounted; paints nothing until a
 * route exists in the store.
 *
 * Phase 24-C — this is the missing renderer that made the routing tool a
 * dead end: the HUD collected from/to and the backend could plan, but no
 * layer ever drew the result. Ids carry the `phantom-` prefix so
 * `preserveOverlayLayers` keeps the route across base-style swaps.
 */
const SOURCE_ID = 'phantom-route-src';
const CASING_ID = 'phantom-route-casing';
const LINE_ID = 'phantom-route-line';

function makeDot(color: string, ring: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '14px';
  el.style.height = '14px';
  el.style.borderRadius = '50%';
  el.style.background = color;
  el.style.border = `2px solid ${ring}`;
  el.style.boxShadow = `0 0 8px ${color}`;
  el.style.pointerEvents = 'none';
  return el;
}

export function RouteLayer() {
  const { map, ready } = useMapInstance();
  const route = useMapStore((s) => s.route);
  const fromMarkerRef = useRef<Marker | null>(null);
  const toMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!map || !ready) return;

    const tokens = getMapTokens();
    const coords = route ? route.result.primary.geometry.coordinates : [];
    const hasLine = coords.length > 1;

    const geojson = {
      type: 'FeatureCollection' as const,
      features: hasLine
        ? [{
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: coords },
            properties: {},
          }]
        : [],
    };

    try {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: geojson as any,
        });
        map.addLayer({
          id: CASING_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': tokens.surfaceDeep,
            'line-width': 8,
            'line-opacity': 0.55,
          },
        });
        map.addLayer({
          id: LINE_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': tokens.signalInfo,
            'line-width': 4,
            'line-opacity': 0.95,
          },
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source.setData(geojson as any);
      }
    } catch {
      /* map style not ready yet */
    }

    // Endpoint markers.
    if (route) {
      const { from, to } = route;
      if (!fromMarkerRef.current) {
        fromMarkerRef.current = new maplibregl.Marker({
          element: makeDot(tokens.signalOk, tokens.surfaceDeep),
        })
          .setLngLat([from.lon, from.lat])
          .addTo(map);
      } else {
        fromMarkerRef.current.setLngLat([from.lon, from.lat]);
      }
      if (!toMarkerRef.current) {
        toMarkerRef.current = new maplibregl.Marker({
          element: makeDot(tokens.signalAlert, tokens.surfaceDeep),
        })
          .setLngLat([to.lon, to.lat])
          .addTo(map);
      } else {
        toMarkerRef.current.setLngLat([to.lon, to.lat]);
      }
    } else {
      fromMarkerRef.current?.remove();
      fromMarkerRef.current = null;
      toMarkerRef.current?.remove();
      toMarkerRef.current = null;
    }
  }, [map, ready, route]);

  // Fit the viewport to the route whenever a new one is planned.
  const fittedRef = useRef<PlannedRouteKey>(null);
  useEffect(() => {
    if (!map || !ready || !route) return;
    const coords = route.result.primary.geometry.coordinates;
    if (coords.length < 2) return;
    const key = `${coords.length}:${coords[0].join(',')}:${coords[coords.length - 1].join(',')}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    try {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 16 });
    } catch {
      /* projection not ready */
    }
  }, [map, ready, route]);

  // Full teardown on unmount.
  useEffect(() => {
    return () => {
      fromMarkerRef.current?.remove();
      fromMarkerRef.current = null;
      toMarkerRef.current?.remove();
      toMarkerRef.current = null;
      if (!map) return;
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
        if (map.getLayer(CASING_ID)) map.removeLayer(CASING_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* ignore teardown errors */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

type PlannedRouteKey = string | null;
