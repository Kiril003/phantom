/**
 * pulses — хуки живлення стрічки організму (Ф1, §3 майстерплану).
 *
 * Доктрина чесності + ATLAS v0.2: значення пульсу буває «виміряно»
 * (пряма відповідь джерела), «виведено» (порахуване з виміряного —
 * звичайний ink, без маркера) і «припущено» (у стрічці ЗАБОРОНЕНО).
 * Свіжість — окремий маркер віку, не перефарбовування: коли джерело
 * замовкло після успіху, останнє виміряне показується З віком; коли
 * джерело не відповідало ніколи — «мовчить», не нуль.
 */

import { useEffect, useRef, useState } from 'react';
import {
  fetchHealth,
  fetchLinuxResources,
  fetchNodeManifest,
  resolveBackendPort,
  type HealthPulse,
  type LinuxResources,
  type NodeManifest,
  type Pulse,
  type SilenceReason,
} from '../../services/organismApi';
import { wsClient } from '../../services/websocket';

/* ─── Загальна модель пульсу для подання ──────────────────────────────── */

export interface PulseView<T> {
  /** Останні виміряні дані; null — джерело не відповідало ніколи. */
  data: T | null;
  /** Вік останнього виміру, с; null — виміру не було. */
  ageS: number | null;
  /**
   * Джерело зараз мовчить (останній цикл не відповів). data при цьому
   * може лишатись — подання показує її З маркером віку.
   */
  silent: boolean;
  reason: SilenceReason | null;
}

const NEVER: PulseView<never> = { data: null, ageS: null, silent: true, reason: null };

/**
 * Полінг джерела з чесним віком. Тік раз на intervalMs; вік
 * перераховується кожен тік, тож маркер свіжості не відстає більш як
 * на один цикл.
 */
function usePolledPulse<T>(
  fetcher: () => Promise<Pulse<T>>,
  intervalMs: number,
): PulseView<T> {
  const [view, setView] = useState<PulseView<T>>(NEVER);
  const lastOkRef = useRef<{ data: T; at: number } | null>(null);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const pulse = await fetcher();
      if (!alive) return;
      if (pulse.ok) {
        lastOkRef.current = { data: pulse.data, at: Date.now() };
        setView({ data: pulse.data, ageS: 0, silent: false, reason: null });
      } else {
        const last = lastOkRef.current;
        setView({
          data: last ? last.data : null,
          ageS: last ? Math.round((Date.now() - last.at) / 1000) : null,
          silent: true,
          reason: pulse.reason,
        });
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // fetcher навмисно поза deps: викликачі передають стабільні функції
    // модуля organismApi, а нестабільний inline-фетчер перезапускав би
    // полінг кожен рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return view;
}

/* ─── Конкретні пульси ────────────────────────────────────────────────── */

/** /health — виміряно, полінг 5 с. */
export function useHealthPulse(): PulseView<HealthPulse> {
  return usePolledPulse<HealthPulse>(fetchHealth, 5000);
}

/**
 * /api/v1/linux/resources — виміряно, полінг 5 с. Без operator-прав
 * джерело чесно мовчить (reason 'unauthorized'), стрічка НЕ малює нулі.
 */
export function useResourcesPulse(): PulseView<LinuxResources> {
  return usePolledPulse<LinuxResources>(fetchLinuxResources, 5000);
}

/**
 * Ідентичність вузла: порт — з env/window-контракту (синхронно),
 * манфест — /node/manifest (публічний, підписаний). У dev-проксі
 * шляху /node сьогодні нема — манфест чесно мовчить, порт лишається
 * доказом адресата. Полінг рідкий (30 с): ідентичність не мерехтить.
 */
export interface NodeIdentity {
  port: number | null;
  manifest: NodeManifest | null;
}

export function useNodeIdentity(): NodeIdentity {
  const manifest = usePolledPulse<NodeManifest>(fetchNodeManifest, 30000);
  return { port: resolveBackendPort(), manifest: manifest.data };
}

/**
 * Стан власного WS-з'єднання фронтенда — читання wsClient без його
 * редагування: початкове значення з isConnected, далі підписки
 * onConnect/onDisconnect (обидві повертають відписку).
 */
export function useWsPulse(): boolean {
  const [connected, setConnected] = useState<boolean>(wsClient.isConnected);
  useEffect(() => {
    const offConnect = wsClient.onConnect(() => setConnected(true));
    const offDisconnect = wsClient.onDisconnect(() => setConnected(false));
    // Стан міг змінитись між рендером і підпискою.
    setConnected(wsClient.isConnected);
    return () => {
      offConnect();
      offDisconnect();
    };
  }, []);
  return connected;
}

/** Годинник, тік 1 с. */
export function useClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/* ─── Форматування (виведене зі свіжовиміряного — звичайний ink) ─────── */

const GIB = 1024 ** 3;

export function formatGiB(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

/** uptime_s → «3д 04:12» — виведено з виміряного, без маркера. */
export function formatUptime(uptimeS: number): string {
  const d = Math.floor(uptimeS / 86400);
  const h = Math.floor((uptimeS % 86400) / 3600);
  const m = Math.floor((uptimeS % 3600) / 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return d > 0 ? `${d}д ${hh}:${mm}` : `${hh}:${mm}`;
}

/** Маркер віку: показуємо лише коли джерело мовчить довше за цикл. */
export function formatAge(ageS: number): string {
  if (ageS < 60) return `${ageS}с`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)}хв`;
  return `${Math.floor(ageS / 3600)}г`;
}

export function formatClock(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
