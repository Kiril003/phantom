/**
 * ServicesHealthBanner — sunrise-warm offline indicator for the tactical map.
 *
 * Polls /map/services_health every POLL_MS. Renders a compact warm-glass
 * banner at the top of the tactical map only when at least one tracked
 * service is genuinely offline.
 *
 * B-WK-3 fix (2026-04-30): the previous implementation surfaced the banner
 * for any service flagged "stale" — even on a fresh cold boot where stale
 * just means "haven't called the service yet". That is misleading and
 * permanently lit the banner for the first 60+ minutes of every session.
 * The trigger is now:
 *   - any service with status === "down"  → banner (offline)
 *   - any service with status === "stale" AND with a recorded
 *     `last_failure_at` (i.e. it really failed at some point) → banner (stale)
 * Pure-stale services with no recorded failure (= "we just haven't talked
 * yet") are silently ignored. Operators can also explicitly dismiss the
 * banner; dismissal is sticky for the current degraded set so a flapping
 * service does not re-pop the banner every minute.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { mapApi, type ServiceHealth } from '../../services/api';

const POLL_MS = 60_000;

const LABELS: Record<string, string> = {
  nominatim: 'Geocoding',
  overpass: 'Nearby POIs',
  ipapi: 'IP fallback',
};

/**
 * Decide whether a service should contribute to the banner.
 *
 * - "down": always include (we know it's broken).
 * - "stale" + last_failure_at present: include (recent or historical
 *   failure observed on the BE side, just not yet recovered).
 * - "stale" + last_failure_at null: SKIP. This is the cold-boot signal
 *   and represents "we have not exercised this service yet", not failure.
 * - everything else (ok / unknown): skip.
 */
function isDegraded(health: ServiceHealth): boolean {
  if (health.status === 'down') return true;
  if (health.status === 'stale' && health.last_failure_at != null) return true;
  return false;
}

export function ServicesHealthBanner() {
  const [services, setServices] = useState<Record<string, ServiceHealth>>({});
  const [refreshing, setRefreshing] = useState(false);
  // Sticky dismissal — the operator's "I see it, don't keep nagging me"
  // signal. Re-armed only when the *set* of degraded services changes
  // (so a new outage on a different service still surfaces).
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(
    null,
  );
  const inFlightRef = useRef<boolean>(false);

  const poll = useMemo(
    () => async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setRefreshing(true);
      try {
        const resp = await mapApi.getServicesHealth();
        setServices(resp.services || {});
      } catch {
        // Network error — leave last state alone. The banner reflects
        // what the BE last told us, not browser↔BE health.
      } finally {
        inFlightRef.current = false;
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void poll().catch(() => {});
    const handle = window.setInterval(() => {
      if (!cancelled) void poll().catch(() => {});
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [poll]);

  const offline = useMemo(
    () => Object.entries(services).filter(([, health]) => isDegraded(health)),
    [services],
  );

  // Signature of the degraded set — order-independent so toggling between
  // {nominatim,overpass} and {overpass,nominatim} doesn't re-arm.
  const signature = useMemo(
    () =>
      offline
        .map(([name, h]) => `${name}:${h.status}`)
        .sort()
        .join('|'),
    [offline],
  );

  if (offline.length === 0) return null;
  if (signature && dismissedSignature === signature) return null;

  const names = offline.map(([name]) => LABELS[name] || name).join(', ');
  const worstStatus = offline.some(([, h]) => h.status === 'down')
    ? 'down'
    : 'stale';
  const prefix = worstStatus === 'down' ? 'offline' : 'stale';
  const accent =
    worstStatus === 'down' ? 'var(--coral-deep)' : 'var(--primary-shadow)';
  const accentBg =
    worstStatus === 'down'
      ? 'rgba(239, 68, 68, 0.12)'
      : 'rgba(244, 175, 37, 0.16)';
  const accentBorder =
    worstStatus === 'down'
      ? 'rgba(239, 68, 68, 0.32)'
      : 'rgba(244, 175, 37, 0.36)';

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass flex items-center gap-2 px-3"
      data-testid="services-health-banner"
      style={{
        height: 36,
        margin: '0 auto',
        marginTop: 4,
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        color: accent,
        borderRadius: 12,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        letterSpacing: 'var(--tracking-wide)',
        maxWidth: 720,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <AlertTriangle size={14} strokeWidth={2} aria-hidden />
      <span>
        Location enrichment {prefix} — {names}. Showing cached data.
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => void poll().catch(() => {})}
        disabled={refreshing}
        className="flex items-center justify-center transition-all active:scale-95"
        style={{
          minWidth: 28,
          minHeight: 28,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: 'transparent',
          color: accent,
          border: '1px solid transparent',
          opacity: refreshing ? 0.5 : 1,
        }}
        aria-label="Retry services health"
        title="Retry"
      >
        <RefreshCw
          size={12}
          strokeWidth={2}
          className={refreshing ? 'animate-spin' : ''}
        />
      </button>
      <button
        type="button"
        onClick={() => setDismissedSignature(signature)}
        className="flex items-center justify-center transition-all active:scale-95"
        style={{
          minWidth: 28,
          minHeight: 28,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: 'transparent',
          color: accent,
          border: '1px solid transparent',
        }}
        aria-label="Dismiss services health banner"
        title="Dismiss"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
