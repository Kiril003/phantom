import { Crosshair, Mountain, Gauge, Compass } from 'lucide-react';
import { useGpsHud } from '../../../hooks/useGpsHud';

/**
 * Phase 24-D — vertical chip stack with GPS / altitude / speed /
 * heading / battery (battery omitted in v1: ContextSnapshot doesn't
 * carry one yet). Doctrine §7.1.
 */

const QUALITY_TINT: Record<string, string> = {
  none: 'text-white/35',
  estimate: 'text-amber-300/85',
  good: 'text-emerald-300/85',
  precise: 'text-cyan-300/90',
};

export interface StatusChipsProps {
  className?: string;
  bearing?: number | null;
}

export function StatusChips({ className = '', bearing = null }: StatusChipsProps): JSX.Element {
  const gps = useGpsHud();
  const quality = QUALITY_TINT[gps.quality] ?? QUALITY_TINT.none;
  const altitude =
    gps.altitude_m !== null ? `${Math.round(gps.altitude_m)} м` : '—';
  const speed =
    gps.speed_kmh !== null ? `${gps.speed_kmh.toFixed(1)} км/г` : '—';
  const headingLabel =
    bearing !== null && Number.isFinite(bearing)
      ? `${Math.round(((bearing % 360) + 360) % 360)}°`
      : '—';
  return (
    <div
      data-testid="status-chips"
      className={`flex flex-col items-end gap-1 ${className}`}
    >
      <Chip label="GPS" value={gps.quality.toUpperCase()} tint={quality} icon={<Crosshair size={11} strokeWidth={1.75} />} testid="status-chip-gps" />
      <Chip label="Висота" value={altitude} icon={<Mountain size={11} strokeWidth={1.75} />} testid="status-chip-altitude" />
      <Chip label="Швидкість" value={speed} icon={<Gauge size={11} strokeWidth={1.75} />} testid="status-chip-speed" />
      <Chip label="Курс" value={headingLabel} icon={<Compass size={11} strokeWidth={1.75} />} testid="status-chip-heading" />
    </div>
  );
}

interface ChipProps {
  label: string;
  value: string;
  tint?: string;
  icon: React.ReactNode;
  testid: string;
}

function Chip({ label, value, tint = 'text-white/85', icon, testid }: ChipProps): JSX.Element {
  return (
    <div
      data-testid={testid}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/5 text-[10px]"
    >
      <span className="opacity-60">{icon}</span>
      <span className="opacity-50">{label}</span>
      <span className={`font-mono ${tint}`}>{value}</span>
    </div>
  );
}
