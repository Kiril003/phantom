import { useEffect, useRef, useState } from 'react';
import { fuse } from '../services/positioning/fuse';
import type { FusedPosition, PositionCandidate } from '../services/positioning/types';
import { useSystemStore } from '../stores/systemStore';

/**
 * Звідки ПК бере своє місце, коли супутникового приймача в ньому немає.
 *
 * Кандидатів кілька, і жоден із них не «правильний» сам по собі: браузер
 * дає суміш мережі й IP, ядро — те, що встигло дізнатись, телефон — свій
 * GNSS. Рішення ухвалює `fuse`, а не порядок опитування.
 */
export function usePosition(): FusedPosition | null {
  const where = useSystemStore((s) => s.context?.where);
  const [browserFix, setBrowserFix] = useState<PositionCandidate | null>(null);
  const [fused, setFused] = useState<FusedPosition | null>(null);
  const previous = useRef<FusedPosition | null>(null);

  // Живе стеження браузера. Питаємо один раз; відмова — теж відповідь, і
  // вона просто лишає нас з тим, що дало ядро.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setBrowserFix({
          kind: 'browser',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? 5000,
          at: pos.timestamp,
          speedKmh: pos.coords.speed != null ? pos.coords.speed * 3.6 : undefined,
        });
      },
      () => setBrowserFix(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    const candidates: PositionCandidate[] = [];

    if (where?.lat != null && where?.lon != null) {
      const kind =
        where.source === 'gps_hardware' ? 'gnss'
          : where.source === 'ip_estimate' ? 'ip'
            : where.source === 'user_stated' ? 'manual'
              : 'browser';
      candidates.push({
        kind,
        lat: where.lat,
        lon: where.lon,
        accuracyM: where.accuracy_m ?? (kind === 'ip' ? 20_000 : 3_000),
        at: Date.now(),
        speedKmh: where.speed_kmh ?? undefined,
        label: where.place_name ?? undefined,
      });
    }
    if (browserFix) candidates.push(browserFix);

    const next = fuse(candidates, Date.now(), previous.current);
    previous.current = next;
    setFused(next);
  }, [where, browserFix]);

  return fused;
}
