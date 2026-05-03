import { useMemo } from 'react';

/**
 * Phase 24-D — MapLibre-equivalent scale bar.
 *
 * Computes the on-screen length of a "nice" round metric distance for
 * the current zoom + latitude. The math is the standard Web-Mercator
 * "meters per pixel" formula; we then quantise to one of {1, 2, 5} ×
 * 10^N so the legend always reads "1 km", "2 km", "500 m" rather than
 * "1.273 km". Doctrine §7.1.
 */

export interface ScaleBarProps {
  /** Current zoom level from MapLibre (`map.getZoom()`). */
  zoom: number;
  /** Latitude of the viewport center, in degrees. */
  lat: number;
  /** Maximum on-screen width allowed for the bar, in pixels. */
  maxWidthPx?: number;
  className?: string;
}

const NICE_STEPS = [1, 2, 5];

export interface ScaleSpec {
  meters: number;
  pixels: number;
  label: string;
}

export function computeScale(
  zoom: number,
  lat: number,
  maxWidthPx: number,
): ScaleSpec {
  const safeLat = Math.max(-85, Math.min(85, lat));
  const metersPerPixel =
    (40075016.686 * Math.cos((safeLat * Math.PI) / 180)) /
    Math.pow(2, zoom + 8);
  const maxMeters = metersPerPixel * maxWidthPx;
  // Pick the largest "nice" multiple ≤ maxMeters.
  const exponent = Math.floor(Math.log10(maxMeters));
  const decade = Math.pow(10, exponent);
  let meters = decade;
  for (const step of NICE_STEPS) {
    if (step * decade <= maxMeters) meters = step * decade;
  }
  const pixels = meters / metersPerPixel;
  const label =
    meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} км` : `${meters} м`;
  return { meters, pixels: Math.max(20, Math.round(pixels)), label };
}

export function ScaleBar({
  zoom,
  lat,
  maxWidthPx = 120,
  className = '',
}: ScaleBarProps): JSX.Element {
  const spec = useMemo(() => computeScale(zoom, lat, maxWidthPx), [zoom, lat, maxWidthPx]);
  return (
    <div
      data-testid="scale-bar"
      data-meters={spec.meters}
      className={`select-none flex items-end gap-1 text-[10px] text-white/85 ${className}`}
    >
      <div
        className="border-2 border-white/80 border-t-0"
        style={{ width: `${spec.pixels}px`, height: 8 }}
      />
      <span className="font-mono leading-none translate-y-[2px]">{spec.label}</span>
    </div>
  );
}
