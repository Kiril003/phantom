import { useEffect, useRef } from 'react';
import maplibregl, { Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens, nameMarker } from '../mapTokens';
import { useSystemStore } from '../../../stores/systemStore';

/**
 * PresenceLayer — renders the operator's current position with a pulsing halo.
 *
 * Phase 9.4b bug-fix — the old implementation gated on `where.fix === true`
 * which only fired for hardware GPS. With the multi-source localization
 * resolver, valid positions now arrive from browser geolocation, IP
 * estimate, or explicit user-stated sources as well. We now render for
 * any source with a valid lat/lon above the minimum confidence floor, and
 * honestly reflect uncertainty with opacity + accuracy circle.
 */
const MIN_CONFIDENCE = 0.2;
const HIGH_CONF = 0.7;
const MID_CONF = 0.5;

type HaloStyle = { opacity: number; dashed: boolean; radiusPx: number };

function styleForConfidence(confidence: number): HaloStyle {
  if (confidence >= HIGH_CONF) return { opacity: 0.6, dashed: false, radiusPx: 32 };
  if (confidence >= MID_CONF) return { opacity: 0.42, dashed: true, radiusPx: 28 };
  return { opacity: 0.28, dashed: true, radiusPx: 22 };
}

export function PresenceLayer() {
  const { map, ready } = useMapInstance();
  const context = useSystemStore((s) => s.context);
  const markerRef = useRef<Marker | null>(null);
  const accuracyMarkerRef = useRef<Marker | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const accuracyElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map || !ready) return;

    const where = context?.where;
    const lat = where?.lat ?? null;
    const lon = where?.lon ?? null;
    const confidence = where?.confidence ?? (where?.fix ? 1.0 : 0);
    const source = where?.source ?? (where?.fix ? 'gps_hardware' : 'none');
    const accuracyM = where?.accuracy_m ?? null;

    const hidden =
      lat == null ||
      lon == null ||
      source === 'none' ||
      confidence < MIN_CONFIDENCE;

    if (hidden) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (accuracyMarkerRef.current) {
        accuracyMarkerRef.current.remove();
        accuracyMarkerRef.current = null;
      }
      return;
    }

    const tokens = getMapTokens();
    const style = styleForConfidence(confidence);

    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'phantom-presence';
      el.setAttribute('aria-label', 'Ти тут');
      el.style.position = 'relative';
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.pointerEvents = 'none';

      const halo = document.createElement('div');
      halo.style.position = 'absolute';
      halo.style.inset = '-12px';
      halo.style.borderStyle = style.dashed ? 'dashed' : 'solid';
      halo.style.borderWidth = '1px';
      halo.style.borderColor = tokens.accent;
      halo.style.borderRadius = '50%';
      halo.style.opacity = String(style.opacity);
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
      haloRef.current = halo;

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map);
      nameMarker(markerRef.current, 'Ти тут');
    } else {
      markerRef.current.setLngLat([lon, lat]);
      if (haloRef.current) {
        haloRef.current.style.borderStyle = style.dashed ? 'dashed' : 'solid';
        haloRef.current.style.opacity = String(style.opacity);
      }
    }

    // Accuracy circle — drawn in screen pixels using the map's projection.
    // Only render when the source supplied accuracy_m; honestly shows
    // uncertainty instead of implying meter-level precision for browser/IP.
    if (accuracyM != null && accuracyM > 0) {
      const accuracyPx = metersToPixelsAt(map, lat, accuracyM);
      if (!accuracyMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'phantom-presence-accuracy';
        el.setAttribute('aria-label', 'Похибка визначення місця');
        el.style.pointerEvents = 'none';
        el.style.borderRadius = '50%';
        el.style.border = `1px dashed ${tokens.accent}`;
        el.style.opacity = '0.22';
        el.style.background = `radial-gradient(circle, transparent 60%, ${tokens.accent}22 100%)`;
        accuracyElRef.current = el;
        accuracyMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([lon, lat])
          .addTo(map);
        nameMarker(accuracyMarkerRef.current, 'Похибка визначення місця');
      } else {
        accuracyMarkerRef.current.setLngLat([lon, lat]);
      }
      if (accuracyElRef.current) {
        const diameter = Math.max(12, Math.min(600, accuracyPx * 2));
        accuracyElRef.current.style.width = `${diameter}px`;
        accuracyElRef.current.style.height = `${diameter}px`;
      }
    } else if (accuracyMarkerRef.current) {
      accuracyMarkerRef.current.remove();
      accuracyMarkerRef.current = null;
    }
  }, [map, ready, context]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (accuracyMarkerRef.current) {
        accuracyMarkerRef.current.remove();
        accuracyMarkerRef.current = null;
      }
    };
  }, []);

  return null;
}

/**
 * Convert a ground distance in meters to pixels on screen at the given
 * latitude. Uses MapLibre's project() when available; falls back to the
 * standard Web Mercator formula so tests that stub the map still render.
 */
function metersToPixelsAt(
  map: { project?: (lnglat: [number, number]) => { x: number; y: number }; getZoom?: () => number },
  lat: number,
  meters: number,
): number {
  try {
    if (typeof map.project === 'function') {
      const here = map.project([0, lat]);
      const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
      const there = map.project([dLon, lat]);
      return Math.abs(there.x - here.x);
    }
  } catch {
    /* fall through */
  }
  const zoom = typeof map.getZoom === 'function' ? map.getZoom() : 15;
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return meters / Math.max(metersPerPixel, 0.01);
}
