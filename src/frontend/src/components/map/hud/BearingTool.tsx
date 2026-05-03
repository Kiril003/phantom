import { useMemo } from 'react';
import { Navigation } from 'lucide-react';
import { haversineKm, type LatLon } from './RulerTool';

/**
 * Phase 24-D — bearing chip.
 *
 * Computes the initial-bearing (forward azimuth) between two points
 * using the spherical-trig formula. The 24-Q draw tool will set the
 * two points; for 24-D the chip simply shows whatever the parent
 * passes in. Doctrine §7.1.
 */

function initialBearingDegrees(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

const COMPASS_LABELS = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];

function compassLetter(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_LABELS[idx];
}

export interface BearingToolProps {
  from: LatLon | null;
  to: LatLon | null;
  active?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function BearingTool({
  from,
  to,
  active = false,
  onToggle,
  className = '',
}: BearingToolProps): JSX.Element {
  const bearing = useMemo(() => {
    if (!from || !to) return null;
    if (haversineKm(from, to) < 0.0005) return null;
    return initialBearingDegrees(from, to);
  }, [from, to]);
  const label =
    bearing === null
      ? 'тихо'
      : `${Math.round(bearing)}° ${compassLetter(bearing)}`;
  return (
    <button
      type="button"
      data-testid="bearing-tool"
      data-active={active}
      data-bearing={bearing ?? ''}
      aria-pressed={active}
      onClick={onToggle}
      className={`min-h-[28px] flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px] ${
        active ? 'text-cyan-200' : 'text-white/85'
      } ${className}`}
    >
      <Navigation
        size={11}
        strokeWidth={1.75}
        className="opacity-70"
        style={{ transform: bearing === null ? undefined : `rotate(${bearing}deg)` }}
      />
      <span className="opacity-50">Курс</span>
      <span className="font-mono">{label}</span>
    </button>
  );
}
