import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';
import type { CliffScreeFeature, CliffScreeKind } from '@shared/types';

const KIND_LABEL_UA: Record<CliffScreeKind, string> = {
  cliff: 'Скеля',
  scree: 'Осип',
  bare_rock: 'Голий камінь',
};

const FRESH_LABEL: Record<string, string> = {
  pre2015: 'до 2015',
};

function freshLabel(fresh: string): string {
  const known = FRESH_LABEL[fresh];
  if (known) return known;
  const m = /^(\d{4})H([12])$/.exec(fresh);
  if (!m) return fresh;
  return m[2] === '1' ? `перша половина ${m[1]}` : `друга половина ${m[1]}`;
}

const SOURCE_ID = 'phantom-cliff-scree';
const FILL_LAYER_ID = `${SOURCE_ID}-fill`;
const LINE_LAYER_ID = `${SOURCE_ID}-line`;
const POINT_LAYER_ID = `${SOURCE_ID}-points`;
const CLICKABLE_LAYER_IDS = [FILL_LAYER_ID, LINE_LAYER_ID, POINT_LAYER_ID];

const EMPTY_COLLECTION = { type: 'FeatureCollection' as const, features: [] as CliffScreeFeature[] };

/**
 * CliffScreeLayer — baked `natural=cliff|scree|bare_rock` obstacles.
 *
 * This is a hazard/obstacle layer, not a decorative POI set: cliffs render
 * as a dashed hazard-tape edge (not a thin scenic line), scree/bare_rock
 * areas get the same dashed outline plus a hatched-feeling amber fill, and
 * the rare cliff *nodes* (point-only mentions, no line geometry mapped) get
 * small warning-ringed dots. Everything reads via `--signal-warn`, never
 * the accent/POI palette, so it visually says "watch your footing here."
 *
 * Source/layers are created once and updated via `setData` (unlike
 * `ReconLayer`, which tears down and rebuilds every time its data changes)
 * — this layer can carry thousands of features nationally, so rebuilding
 * three GL layers on every viewport pan would be wasteful and would drop
 * click handlers mid-interaction.
 */
export function CliffScreeLayer() {
  const { map, ready } = useMapInstance();
  const features = useMapStore((s) => s.cliffScree);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Setup — runs once per map instance. Click handlers read the feature
  // straight off the MapLibre click event, never off `features`, so they
  // never go stale even though this effect doesn't re-run on data updates.
  useEffect(() => {
    if (!map || !ready) return;

    const tokens = getMapTokens();
    const warn = tokens.signalWarn;

    const openPopup = (e: maplibregl.MapLayerMouseEvent) => {
      const feat = e.features?.[0] as unknown as CliffScreeFeature | undefined;
      if (!feat) return;
      const kind = KIND_LABEL_UA[feat.properties.kind] ?? feat.properties.kind;
      const name = feat.properties.name ? `«${feat.properties.name}»` : '';
      const html = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4;">
          <strong>${kind}</strong> ${name}<br/>
          <span style="opacity:0.7;">OSM, дані ${freshLabel(feat.properties.fresh)}</span>
        </div>
      `;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    try {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION as any });

        map.addLayer({
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': warn, 'fill-opacity': 0.22 },
        });

        // Hazard-tape edge: a dashed amber line reads as "boundary of an
        // obstacle," not a scenic border — used for both the cliff edge
        // (LineString) and the scree/bare_rock outline (Polygon).
        map.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': warn,
            'line-width': ['case', ['==', ['geometry-type'], 'LineString'], 2.5, 1.5],
            'line-dasharray': [2, 1.5],
            'line-opacity': 0.9,
          },
        });

        map.addLayer({
          id: POINT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': warn,
            'circle-opacity': 0.85,
            'circle-stroke-color': tokens.surfaceDeep,
            'circle-stroke-width': 1.5,
          },
        });
      }

      CLICKABLE_LAYER_IDS.forEach((id) => {
        map.on('click', id, openPopup);
        map.on('mouseenter', id, onEnter);
        map.on('mouseleave', id, onLeave);
      });
    } catch {
      /* map style not ready yet */
    }

    return () => {
      try {
        popupRef.current?.remove();
        CLICKABLE_LAYER_IDS.forEach((id) => {
          map.off('click', id, openPopup);
          map.off('mouseenter', id, onEnter);
          map.off('mouseleave', id, onLeave);
          if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* ignore teardown errors */
      }
    };
  }, [map, ready]);

  // Data sync — cheap `setData` on every store update, no layer churn.
  useEffect(() => {
    if (!map || !ready) return;
    try {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({ type: 'FeatureCollection', features } as any);
    } catch {
      /* map style not ready yet */
    }
  }, [map, ready, features]);

  return null;
}
