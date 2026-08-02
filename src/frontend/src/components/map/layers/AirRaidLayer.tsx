import { useLiveAlerts } from '../../../hooks/useLiveAlerts';
import { TriangleAlert } from 'lucide-react';

/**
 * Phase 24-F — AirRaid (alarms.in.ua) live layer.
 *
 * Renders a small DOM overlay listing every active oblast — the
 * MapLibre source/layer wiring lands in 24-G alongside the bundled
 * UA admin GeoJSON. For now the operator sees a top-center "active
 * alerts" strip so the alarm is unmistakable even when the map
 * itself isn't focused.
 *
 * Subscribes via `useLiveAlerts('air_raid_ua')`; backend
 * `geo.live_tasker` broadcasts a FeatureCollection of oblast
 * centroids every 30 s (or on diff).
 */

export interface AirRaidLayerProps {
  className?: string;
}

interface AlarmFeatureProps {
  oblast_id?: string;
  oblast_name_ua?: string;
  alert_type?: string;
  started_at?: string | null;
}

export function AirRaidLayer({ className = '' }: AirRaidLayerProps): JSX.Element | null {
  const snap = useLiveAlerts('air_raid_ua');
  if (snap.count === 0) {
    return (
      <div
        data-testid="air-raid-quiet"
        className={`px-2 py-1 rounded-md bg-emerald-50/90 backdrop-blur-md text-[10px] text-emerald-800 border border-emerald-600/30 ${className}`}
      >
        тиша по Україні
      </div>
    );
  }
  return (
    <div
      data-testid="air-raid-overlay"
      data-alert-count={snap.count}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-900/55 backdrop-blur-md text-[11px] text-red-100 border border-red-500/40 shadow-lg shadow-red-900/40 ${className}`}
    >
      <TriangleAlert size={12} strokeWidth={1.85} className="opacity-90 animate-pulse" />
      <span className="font-mono">{snap.count}</span>
      <span className="opacity-90">тривога:</span>
      <span className="truncate max-w-[280px]">
        {snap.featureCollection.features
          .slice(0, 4)
          .map((feature) => {
            const props = (feature.properties ?? {}) as AlarmFeatureProps;
            return props.oblast_name_ua ?? props.oblast_id ?? 'oblast';
          })
          .join(', ')}
        {snap.count > 4 ? ` +${snap.count - 4}` : ''}
      </span>
    </div>
  );
}
