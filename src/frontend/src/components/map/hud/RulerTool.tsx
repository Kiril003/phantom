import { useMemo } from 'react';
import { Ruler } from 'lucide-react';

/**
 * Phase 24-D — distance ruler chip.
 *
 * The interactive draw tool lands in 24-Q (annotations); the chip
 * here is the read-out of however many points the parent passes in.
 * Total length is the sum of haversine distances between consecutive
 * points. Switches between km and m at the 1 km boundary.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RulerToolProps {
  points: LatLon[];
  active?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(sa)));
}

export function RulerTool({
  points,
  active = false,
  onToggle,
  className = '',
}: RulerToolProps): JSX.Element {
  const total = useMemo(() => {
    if (points.length < 2) return 0;
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      acc += haversineKm(points[i - 1], points[i]);
    }
    return acc;
  }, [points]);
  const label =
    points.length < 2
      ? 'тихо'
      : total >= 1
        ? `${total.toFixed(2)} км`
        : `${Math.round(total * 1000)} м`;
  return (
    <button
      type="button"
      data-testid="ruler-tool"
      data-active={active}
      data-points={points.length}
      aria-pressed={active}
      onClick={onToggle}
      className={`min-h-[44px] flex items-center gap-1.5 px-3 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px] ${
        active ? 'text-cyan-200' : 'text-white/85'
      } ${className}`}
    >
      <Ruler size={11} strokeWidth={1.75} className="opacity-70" />
      <span className="opacity-50">Лінійка</span>
      <span className="font-mono">{label}</span>
    </button>
  );
}
