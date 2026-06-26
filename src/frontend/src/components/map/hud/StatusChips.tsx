import { Compass, Satellite, Eye, EyeOff } from 'lucide-react';

export function CoordinateReadout({ lat, lon, source }: {
  lat: number | null;
  lon: number | null;
  source: string;
}) {
  if (lat == null || lon == null || source === 'none') {
    return (
      <div className="glass-card flex items-center gap-2 px-3 py-2 rounded-full opacity-50">
        <EyeOff size={10} className="text-white/40" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-ink-muted">No Fix</span>
      </div>
    );
  }

  return (
    <div className="glass-card flex flex-col gap-1 px-3 py-2 rounded-2xl min-w-[190px]">
      <div className="flex items-center gap-2">
        <span className="block w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-ink-muted">
          {source?.replace('_', ' ') || 'NO LOCATION'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-bold text-ink-muted">LAT</span>
        <span className="font-mono text-xs text-ink-primary tabular-nums">
          {lat != null ? lat.toFixed(5) : '—'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-bold text-ink-muted">LON</span>
        <span className="font-mono text-xs text-ink-primary tabular-nums">
          {lon != null ? lon.toFixed(5) : '—'}
        </span>
      </div>
    </div>
  );
}

export function CompassChip({ bearing }: { bearing: number }) {
  return (
    <div className="glass-card flex items-center gap-2 px-3 h-[30px] rounded-full">
      <Compass
        size={14}
        strokeWidth={1.75}
        className="text-amber-500"
        style={{ transform: `rotate(${bearing}deg)` }}
      />
      <span className="font-display text-[9px] font-bold uppercase tracking-widest text-ink-primary tabular-nums">
        N · {String(Math.round(bearing)).padStart(3, '0')}°
      </span>
    </div>
  );
}

export function GpsQualityChip({ satellites, fix, speed }: {
  satellites: number;
  fix: boolean;
  speed: number;
}) {
  return (
    <div className="glass-card flex items-center gap-3 px-3 h-[30px] rounded-full">
      <span className="flex items-center gap-1">
        <Satellite size={12} strokeWidth={1.75} className="text-ink-muted" />
        <span className={`font-mono text-[9px] tabular-nums ${satellites >= 6 ? 'text-emerald-500' : satellites >= 4 ? 'text-amber-500' : 'text-rose-500'
          }`}>
          {String(satellites).padStart(2, '0')}
        </span>
      </span>
      <span className="text-white/10">|</span>
      <span className={`font-mono text-[9px] tabular-nums ${fix ? 'text-ink-primary' : 'text-ink-muted'}`}>
        {speed.toFixed(0)} km/h
      </span>
    </div>
  );
}

export function StatusChip({ loading, zoom }: { loading: boolean; zoom: number }) {
  return (
    <div className="glass-card flex items-center gap-2 px-3 h-[30px] rounded-full">
      {loading ? (
        <EyeOff size={12} strokeWidth={1.75} className="text-amber-500" />
      ) : (
        <Eye size={12} strokeWidth={1.75} className="text-emerald-500" />
      )}
      <span className={`text-[9px] font-bold uppercase tracking-widest ${loading ? 'text-amber-500' : 'text-emerald-500'}`}>
        {loading ? 'Syncing' : 'Live'}
      </span>
      <span className="font-mono text-[9px] text-ink-muted tabular-nums">
        z{zoom.toFixed(0)}
      </span>
    </div>
  );
}
