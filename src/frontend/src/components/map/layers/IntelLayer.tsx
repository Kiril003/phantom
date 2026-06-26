import { useEffect, useRef } from 'react';
import maplibregl, { Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens, poiColor } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';
import type { MapPOI } from '@shared/types';

/**
 * IntelLayer — renders POIs grouped by category (intel, threat, saved, home, work, custom).
 * Tap a marker to open MarkerCard with details.
 */
export function IntelLayer() {
  const { map, ready } = useMapInstance();
  const pois = useMapStore((s) => s.pois);
  const select = useMapStore((s) => s.select);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const tokens = getMapTokens();

    pois.forEach((poi: MapPOI) => {
      const el = document.createElement('div');
      el.className = 'phantom-poi';
      el.setAttribute('aria-label', `poi-${poi.category}`);
      el.style.minWidth = '44px';
      el.style.minHeight = '44px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.cursor = 'pointer';

      const inner = document.createElement('div');
      inner.style.width = '18px';
      inner.style.height = '18px';
      inner.style.borderRadius = poi.category === 'threat' ? '3px' : '50%';
      
      // Phase 24-N — GHOST mode styling for secret markers.
      const baseColor = poiColor(tokens, poi.category);
      const isSecret = poi.is_secret;
      
      inner.style.background = isSecret ? '#16a34a' : baseColor;
      inner.style.border = `2px solid ${tokens.surfaceDeep}`;
      inner.style.boxShadow = isSecret 
        ? `0 0 12px #16a34a, 0 0 4px #16a34a`
        : `0 0 10px ${baseColor}`;
        
      inner.style.display = 'flex';
      inner.style.alignItems = 'center';
      inner.style.justifyContent = 'center';
      inner.style.fontSize = '11px';
      inner.style.color = tokens.surfaceDeep;

      if (poi.icon && poi.icon !== '📍') {
        inner.textContent = poi.icon;
      }

      el.appendChild(inner);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        select({ kind: 'poi', poi });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([poi.lon, poi.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, ready, pois, select]);

  return null;
}
