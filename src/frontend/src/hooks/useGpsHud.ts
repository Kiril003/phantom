import { useMemo } from 'react';
import { useSystemStore } from '../stores/systemStore';

/**
 * Phase 24-D — derive GPS HUD chip data from the live ContextSnapshot.
 *
 * `ContextSnapshot.where` carries the resolver-side estimate (which
 * may come from GPS hardware, browser geolocation, or an IP
 * estimate). The badge's "quality" is computed from the union of
 * `fix`, `accuracy_m`, and `source` so the operator can tell at a
 * glance whether the dot they see on the map is real or just a city
 * centroid from MaxMind.
 */
export type GpsQuality = 'none' | 'estimate' | 'good' | 'precise';

export interface GpsHud {
  quality: GpsQuality;
  fix: boolean;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  speed_kmh: number | null;
  altitude_m: number | null;
  source: string | null;
}

const EMPTY: GpsHud = {
  quality: 'none',
  fix: false,
  lat: null,
  lon: null,
  accuracy_m: null,
  speed_kmh: null,
  altitude_m: null,
  source: null,
};

export function useGpsHud(): GpsHud {
  const context = useSystemStore((s) => s.context);
  return useMemo(() => {
    if (!context?.where) return EMPTY;
    const where = context.where;
    const fix = Boolean(where.fix);
    const accuracy =
      typeof where.accuracy_m === 'number' && Number.isFinite(where.accuracy_m)
        ? where.accuracy_m
        : null;
    let quality: GpsQuality = 'none';
    if (fix) {
      if (accuracy !== null && accuracy <= 15) quality = 'precise';
      else if (accuracy !== null && accuracy <= 100) quality = 'good';
      else quality = 'estimate';
    } else if (where.lat !== null && where.lon !== null) {
      quality = 'estimate';
    }
    const altitude =
      'altitude_m' in where && typeof where.altitude_m === 'number'
        ? where.altitude_m
        : null;
    return {
      quality,
      fix,
      lat: where.lat ?? null,
      lon: where.lon ?? null,
      accuracy_m: accuracy,
      speed_kmh: typeof where.speed_kmh === 'number' ? where.speed_kmh : null,
      altitude_m: altitude,
      source: where.source ?? null,
    };
  }, [context]);
}
