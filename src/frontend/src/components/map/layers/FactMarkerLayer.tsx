/**
 * Phase 9.4c audit G6 — renders geo-tagged MemoryFacts on the tactical
 * map as subtle markers. Tap opens MarkerCard with the fact content,
 * category, place name, and timestamp.
 *
 * Data flow:
 *   mapStore.loadGeoTaggedFacts() → /map/geo_tagged_facts → state.geoTaggedFacts
 *   FactMarkerLayer reads state.geoTaggedFacts, renders one marker per fact.
 */
import { useEffect, useRef } from 'react';
import maplibregl, { Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';

const CATEGORY_COLORS: Record<string, string> = {
  location_reference: '#8b5cf6',
  fact: '#38bdf8',
  preference: '#f59e0b',
  relationship: '#f472b6',
  goal: '#4ade80',
};

const DEFAULT_COLOR = '#60a5fa';

function ageOpacity(createdAt: string): number {
  // Fresher facts render more opaque; 30+ days old drops to 0.35.
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return 0.7;
  const ageDays = (Date.now() - ts) / (24 * 3600 * 1000);
  if (ageDays <= 1) return 0.95;
  if (ageDays <= 7) return 0.8;
  if (ageDays <= 30) return 0.6;
  return 0.35;
}

export function FactMarkerLayer() {
  const { map, ready } = useMapInstance();
  const facts = useMapStore((s) => s.geoTaggedFacts);
  const select = useMapStore((s) => s.select);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const tokens = getMapTokens();

    facts.forEach((fact) => {
      if (fact.place_lat == null || fact.place_lon == null) return;
      const color = CATEGORY_COLORS[fact.category] || DEFAULT_COLOR;
      const opacity = ageOpacity(fact.created_at);

      const el = document.createElement('div');
      el.className = 'phantom-fact-marker';
      el.setAttribute('aria-label', `memory-${fact.category}`);
      el.style.minWidth = '44px';
      el.style.minHeight = '44px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.cursor = 'pointer';

      const dot = document.createElement('div');
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.background = color;
      dot.style.opacity = String(opacity);
      dot.style.border = `1.5px solid ${tokens.surfaceDeep}`;
      dot.style.boxShadow = `0 0 6px ${color}`;
      el.appendChild(dot);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        select({ kind: 'fact', fact });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([fact.place_lon, fact.place_lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, ready, facts, select]);

  return null;
}
