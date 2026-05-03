import { useMemo } from 'react';
import { Mountain } from 'lucide-react';

/**
 * Phase 24-D — elevation profile sheet.
 *
 * Renders an inline mini-chart for an array of `[distance_m,
 * elevation_m]` samples. Sources of samples land in 24-N (DEM-based
 * profile) — this component is the rendering primitive every caller
 * (route planning, hike preview, recon brief) shares.
 *
 * The sheet is collapsible: when no samples are passed it renders an
 * empty placeholder; when samples are present it shows the SVG chart
 * with min/max readouts and the cumulative distance.
 */

export interface ElevationSample {
  distance_m: number;
  elevation_m: number;
}

export interface ElevationProfileSheetProps {
  samples: ElevationSample[];
  className?: string;
  width?: number;
  height?: number;
}

export function ElevationProfileSheet({
  samples,
  className = '',
  width = 280,
  height = 80,
}: ElevationProfileSheetProps): JSX.Element {
  const stats = useMemo(() => {
    if (samples.length < 2) return null;
    const elevations = samples.map((s) => s.elevation_m);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const totalDist = samples[samples.length - 1].distance_m;
    const span = max - min || 1;
    const path = samples
      .map((s, i) => {
        const x = (s.distance_m / totalDist) * width;
        const y = height - ((s.elevation_m - min) / span) * height;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return { min, max, totalDist, path, span };
  }, [samples, width, height]);

  if (!stats) {
    return (
      <div
        data-testid="elevation-profile-empty"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px] text-white/35 ${className}`}
      >
        <Mountain size={11} strokeWidth={1.75} />
        <span>профіль порожній</span>
      </div>
    );
  }

  return (
    <div
      data-testid="elevation-profile-sheet"
      className={`flex flex-col gap-1 px-2 py-1.5 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px] text-white/85 ${className}`}
    >
      <div className="flex items-center gap-1.5">
        <Mountain size={11} strokeWidth={1.75} className="opacity-70" />
        <span className="opacity-50">Профіль висоти</span>
        <span className="ml-auto font-mono">
          {Math.round(stats.min)} — {Math.round(stats.max)} м
        </span>
      </div>
      <svg width={width} height={height} aria-hidden viewBox={`0 0 ${width} ${height}`}>
        <path
          d={`${stats.path} L ${width} ${height} L 0 ${height} Z`}
          fill="rgba(125, 211, 252, 0.15)"
          stroke="none"
        />
        <path d={stats.path} fill="none" stroke="rgba(125, 211, 252, 0.85)" strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between font-mono opacity-60">
        <span>0</span>
        <span>
          {stats.totalDist >= 1000
            ? `${(stats.totalDist / 1000).toFixed(1)} км`
            : `${Math.round(stats.totalDist)} м`}
        </span>
      </div>
    </div>
  );
}
