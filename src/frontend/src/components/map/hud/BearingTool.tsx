import { useMemo } from 'react';
import { Navigation } from 'lucide-react';
import { haversineKm, initialBearingDeg, type GeoPoint } from '../../../utils/geo';

/**
 * Phase 24-D — bearing chip.
 *
 * Ф2: сферична математика переїхала в utils/geo.ts (тести проти
 * точних властивостей) — чип лишився показом того, що передасть
 * батько. Доти живої точки монтування він не має.
 */

type LatLon = GeoPoint;

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
    return initialBearingDeg(from, to);
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
      className={`min-h-[44px] flex items-center gap-1.5 px-3 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px] ${
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
