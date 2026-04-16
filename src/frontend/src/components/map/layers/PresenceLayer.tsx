import { useEffect, useRef } from 'react';
import maplibregl, { Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens } from '../mapTokens';
import { useSystemStore } from '../../../stores/systemStore';

/**
 * PresenceLayer — renders the operator's current position with a pulsing halo.
 * Follows the GPS fix stream from ContextEngine.
 */
export function PresenceLayer() {
  const { map, ready } = useMapInstance();
  const context = useSystemStore((s) => s.context);
  const markerRef = useRef<Marker | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map || !ready) return;
    if (!context || !context.where.fix || context.where.lat == null || context.where.lon == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const tokens = getMapTokens();
    const lat = context.where.lat;
    const lon = context.where.lon;

    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'phantom-presence';
      el.setAttribute('aria-label', 'presence');
      el.style.position = 'relative';
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.pointerEvents = 'none';

      const halo = document.createElement('div');
      halo.style.position = 'absolute';
      halo.style.inset = '-12px';
      halo.style.border = `1px solid ${tokens.accent}`;
      halo.style.borderRadius = '50%';
      halo.style.opacity = '0.5';
      halo.style.animation = 'phantom-presence-pulse 2s ease-in-out infinite';

      const core = document.createElement('div');
      core.style.position = 'absolute';
      core.style.inset = '0';
      core.style.background = tokens.accent;
      core.style.border = `2px solid ${tokens.surfaceDeep}`;
      core.style.borderRadius = '50%';
      core.style.boxShadow = `0 0 10px ${tokens.accent}`;

      el.appendChild(halo);
      el.appendChild(core);
      elRef.current = el;

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([lon, lat]);
    }

    return () => {
      /* keep marker mounted as long as we have fix */
    };
  }, [map, ready, context]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  return null;
}
