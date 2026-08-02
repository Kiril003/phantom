import { useEffect, useRef } from 'react';
import maplibregl, { Marker } from 'maplibre-gl';
import { useMapInstance } from '../MapContext';
import { getMapTokens, nameMarker } from '../mapTokens';
import { useMapStore } from '../../../stores/mapStore';
import type { WardrivingRecord } from '@shared/types';

const ENCRYPTION_CRITICAL = new Set(['OPEN', 'WEP']);

/**
 * WardrivingLayer — plots every observed WiFi AP as a small dot.
 * Colour encodes encryption severity: open/WEP = alert, WPA2+ = info, WPA3 = OK.
 */
export function WardrivingLayer() {
  const { map, ready } = useMapInstance();
  const records = useMapStore((s) => s.wardrivingRecords);
  const select = useMapStore((s) => s.select);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const tokens = getMapTokens();
    const colorFor = (enc: string) => {
      const up = enc.toUpperCase();
      if (ENCRYPTION_CRITICAL.has(up)) return tokens.signalAlert;
      if (up.startsWith('WPA3')) return tokens.signalOk;
      if (up.startsWith('WPA')) return tokens.signalInfo;
      return tokens.inkMuted;
    };

    records.forEach((r: WardrivingRecord) => {
      const el = document.createElement('div');
      el.className = 'phantom-wardriving';
      el.setAttribute('aria-label', 'Точка доступу Wi-Fi');
      el.style.width = '9px';
      el.style.height = '9px';
      el.style.borderRadius = '50%';
      el.style.background = colorFor(r.encryption);
      el.style.border = `1px solid ${tokens.surfaceDeep}`;
      el.style.boxShadow = `0 0 6px ${colorFor(r.encryption)}`;
      el.style.cursor = 'pointer';
      el.style.opacity = '0.85';

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        select({ kind: 'wardriving', record: r });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([r.lon, r.lat])
        .addTo(map);
      nameMarker(marker, 'Точка доступу Wi-Fi');
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, ready, records, select]);

  return null;
}
