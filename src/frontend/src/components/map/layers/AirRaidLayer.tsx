import { useLiveAlerts } from '../../../hooks/useLiveAlerts';
import { useLayerObservation, useNow } from '../../../hooks/useLayerObservation';
import { alertAge, formatStamp } from './alertAge';
import { CircleHelp, TriangleAlert } from 'lucide-react';

/**
 * Phase 24-F — AirRaid (alarms.in.ua) live layer.
 *
 * Тиша тут ніколи не малюється зеленою довше, ніж її підтверджували. Досі
 * шар показував «тиша по Україні» одразу після відкриття мапи, ще не почувши
 * від бекенда жодного слова, і тримав ту зелень скільки завгодно довго — то
 * був не стан, а відсутність повідомлень.
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
  const observation = useLayerObservation('air_raid_ua');
  const now = useNow();

  const lastHeardAt = Math.max(snap.receivedAt, observation.lastHeardAt);
  // Підтвердження приходить без геометрії, тож коли воно свіжіше за останній
  // diff — кількість беремо з нього. Інакше мапа, відкрита під час тривоги,
  // рахувала б нуль до першої зміни.
  const count =
    observation.lastHeardAt >= snap.receivedAt ? observation.count : snap.count;
  const { state, ageMs } = alertAge({ count, lastHeardAt, now });
  const stamp = formatStamp(lastHeardAt, ageMs);

  if (state === 'unknown') {
    return (
      <div
        data-testid="air-raid-unknown"
        data-alert-state="unknown"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/70 backdrop-blur-md text-[10px] text-slate-200 border border-slate-400/30 ${className}`}
      >
        <CircleHelp size={12} strokeWidth={1.85} className="opacity-80" />
        <span>стан невідомий</span>
        <span className="opacity-70 font-mono">{stamp}</span>
      </div>
    );
  }

  if (state === 'quiet') {
    return (
      <div
        data-testid="air-raid-quiet"
        data-alert-state="quiet"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50/90 backdrop-blur-md text-[10px] text-emerald-800 border border-emerald-600/30 ${className}`}
      >
        <span>тиша по Україні</span>
        <span className="opacity-70 font-mono">{stamp}</span>
      </div>
    );
  }

  const stale = state === 'active_stale';
  return (
    <div
      data-testid="air-raid-overlay"
      data-alert-count={count}
      data-alert-state={state}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md backdrop-blur-md text-[11px] border shadow-lg ${
        stale
          ? 'bg-red-950/40 text-red-200/80 border-red-500/25 border-dashed shadow-red-950/30'
          : 'bg-red-900/55 text-red-100 border-red-500/40 shadow-red-900/40'
      } ${className}`}
    >
      <TriangleAlert
        size={12}
        strokeWidth={1.85}
        className={stale ? 'opacity-70' : 'opacity-90 animate-pulse'}
      />
      <span className="font-mono">{count}</span>
      <span className="opacity-90">тривога:</span>
      <span className="truncate max-w-[280px]">
        {snap.featureCollection.features
          .slice(0, 4)
          .map((feature) => {
            const props = (feature.properties ?? {}) as AlarmFeatureProps;
            return props.oblast_name_ua ?? props.oblast_id ?? 'oblast';
          })
          .join(', ')}
        {count > 4 ? ` +${count - 4}` : ''}
      </span>
      <span className="opacity-70 font-mono">{stamp}</span>
    </div>
  );
}
