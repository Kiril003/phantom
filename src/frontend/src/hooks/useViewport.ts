import { useMemo } from 'react';
import { useMapStore } from '../stores/mapStore';

/**
 * Phase 24-D — read-only viewport snapshot.
 *
 * The map's authoritative state lives inside the MapLibre instance,
 * but the surrounding HUD only needs a cheap snapshot for chips +
 * narrative ("zoom 14, bearing 12°"). The wrapping `<TacticalMap>` /
 * `<OmniMap>` push center + zoom into `mapStore` on every move; this
 * hook is the read-only view of those values.
 *
 * `bearing` is supplied as an optional argument because TacticalMap
 * tracks it locally — when callers don't have it the viewport simply
 * reports `null`, so consumers can render a placeholder.
 */
export interface Viewport {
  center: [number, number] | null;
  zoom: number;
  bearing: number | null;
  pitch: number | null;
}

export function useViewport(
  bearing: number | null = null,
  pitch: number | null = null,
): Viewport {
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  return useMemo(
    () => ({
      center,
      zoom,
      bearing,
      pitch,
    }),
    [center, zoom, bearing, pitch],
  );
}
