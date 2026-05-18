import { useEffect, useState } from 'react';
import { request } from '../services/api';

interface StandingOrderRow {
  id: number | string;
  enabled: boolean;
  fire_count: number;
  last_fired_at: string | null;
}

export interface Heartbeat {
  /** Number of currently-enabled standing orders. */
  enabled: number;
  /** Total fire count across all orders (proxy for fired24h until backend exposes that field). */
  totalFired: number;
  /** ISO-8601 timestamp of the most-recently-fired order, or null. */
  lastFireAt: string | null;
  /** True only during the very first fetch before any response arrives. */
  loading: boolean;
}

const POLL_MS = 10_000;

export function useStandingOrdersHeartbeat(): Heartbeat {
  const [hb, setHb] = useState<Heartbeat>({
    enabled: 0,
    totalFired: 0,
    lastFireAt: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;

    async function tick() {
      try {
        const resp = await request<{ orders: StandingOrderRow[] }>(
          'GET',
          '/agent/standing_orders',
        );
        if (!active) return;
        const orders = resp?.orders ?? [];
        const enabled = orders.filter((o) => o.enabled).length;
        const totalFired = orders.reduce((s, o) => s + (o.fire_count ?? 0), 0);
        const lastFireAt =
          orders
            .map((o) => o.last_fired_at)
            .filter((x): x is string => !!x)
            .sort()
            .pop() ?? null;
        setHb({ enabled, totalFired, lastFireAt, loading: false });
      } catch {
        // Heartbeat is best-effort: silently keep the last known values.
        // Only clear the loading flag so callers don't spin forever.
        if (active) {
          setHb((prev) => (prev.loading ? { ...prev, loading: false } : prev));
        }
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return hb;
}
