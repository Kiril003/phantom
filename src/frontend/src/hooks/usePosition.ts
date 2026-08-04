import { useEffect, useRef, useState } from 'react';
import { fuse } from '../services/positioning/fuse';
import type { FusedPosition, PositionCandidate } from '../services/positioning/types';
import { useSystemStore } from '../stores/systemStore';
import { positionFromAps } from '../services/positioning/wifi';
import { mapApi, type PositionSources } from '../services/api';

/**
 * Звідки ПК бере своє місце, коли супутникового приймача в ньому немає.
 *
 * Кандидатів кілька, і жоден із них не «правильний» сам по собі: браузер
 * дає суміш мережі й IP, ядро — те, що встигло дізнатись, телефон — свій
 * GNSS. Рішення ухвалює `fuse`, а не порядок опитування.
 */
export interface PositionView {
  position: FusedPosition | null;
  /** Скільки телефонів спарено. 0 — можна запропонувати підключити. */
  pairedDevices: number;
}

export function usePosition(): PositionView {
  const where = useSystemStore((s) => s.context?.where);
  const [browserFix, setBrowserFix] = useState<PositionCandidate | null>(null);
  const [sources, setSources] = useState<PositionSources | null>(null);
  const [fused, setFused] = useState<FusedPosition | null>(null);
  const previous = useRef<FusedPosition | null>(null);

  // Телефон і точки доступу, які він бачить. Опитуємо рідко: місце людини
  // не міняється щосекунди, а зайвий трафік на слабкій мережі коштує
  // більше, ніж дає.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const s = await mapApi.positionSources();
        if (alive) setSources(s);
      } catch {
        if (alive) setSources(null);
      }
    };
    void pull();
    const t = window.setInterval(pull, 20_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

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

    if (sources?.phone) {
      candidates.push({
        kind: 'phone',
        lat: sources.phone.lat,
        lon: sources.phone.lon,
        accuracyM: sources.phone.accuracy_m ?? 50,
        at: Date.now() - sources.phone.age_s * 1000,
        label: sources.phone.device_name,
      });
    }

    // Точки доступу мають сенс лише коли ми знаємо, де вони. Решту
    // `positionFromAps` відсіє сам і поверне null, а не вигадану точку.
    const wifi = positionFromAps(
      (sources?.aps ?? []).map((a) => ({
        bssid: a.mac,
        ssid: a.ssid,
        rssiDbm: a.rssi,
        lat: a.lat ?? undefined,
        lon: a.lon ?? undefined,
      })),
      Date.now(),
    );
    if (wifi) candidates.push(wifi);

    const next = fuse(candidates, Date.now(), previous.current);
    previous.current = next;
    setFused(next);
  }, [where, browserFix, sources]);

  return { position: fused, pairedDevices: sources?.paired_devices ?? 0 };
}
