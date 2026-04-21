/**
 * Phase 9.4c audit Q6 — offline-mode banner for location enrichment.
 *
 * Polls /map/services_health every POLL_MS. Renders a compact banner at
 * the top of the tactical map when any tracked service is "down" (recent
 * failure) or "stale" (no recent success). Hidden entirely when all
 * services are ok or unknown — no banner on fresh boots.
 */
import { useEffect, useState } from 'react';
import { mapApi, type ServiceHealth } from '../../services/api';

const POLL_MS = 60_000;

const LABELS: Record<string, string> = {
  nominatim: 'Geocoding',
  overpass: 'Nearby POIs',
  ipapi: 'IP fallback',
};

export function ServicesHealthBanner() {
  const [services, setServices] = useState<Record<string, ServiceHealth>>({});

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const resp = await mapApi.getServicesHealth();
        if (!cancelled) setServices(resp.services || {});
      } catch {
        // Network error — leave last state alone.
      }
    };
    void poll();
    const handle = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const offline = Object.entries(services).filter(
    ([, health]) => health.status === 'down' || health.status === 'stale',
  );
  if (offline.length === 0) return null;

  const names = offline.map(([name]) => LABELS[name] || name).join(', ');
  const worstStatus = offline.some(([, h]) => h.status === 'down') ? 'down' : 'stale';
  const prefix = worstStatus === 'down' ? 'offline' : 'stale';

  return (
    <div
      role="status"
      aria-live="polite"
      className="px-3 py-1.5 text-xs font-medium text-amber-200 bg-amber-900/70 border-b border-amber-700/50"
      data-testid="services-health-banner"
    >
      ⚠ Location enrichment {prefix} — {names}. Showing cached data.
    </div>
  );
}
