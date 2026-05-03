import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { TacticalMap } from './TacticalMap';
import { HudShell } from './hud/HudShell';
import { LayerLibraryPanel } from './panels/LayerLibraryPanel';

/**
 * Phase 24-D — root OmniMap shell.
 *
 * Wraps the existing `<TacticalMap>` (which still owns the MapLibre
 * canvas + base/intel/wardriving layers) and overlays the new HUD
 * components. Existing tests that import TacticalMap directly keep
 * passing; new mount sites import OmniMap to get the additional HUD.
 *
 * 24-D deliberately does NOT replace TacticalMap. The full
 * orchestration migration lands in 24-E/24-U once the layer library
 * + clustering work has stabilised the canvas-side primitives.
 */

export interface OmniMapProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
  /** Pass false in unit tests so the WS bridge effect is skipped. */
  bridgeAgent?: boolean;
  onOpenLibrary?: () => void;
}

export function OmniMap({
  initialCenter,
  initialZoom = 15,
  className = '',
  bridgeAgent = true,
  onOpenLibrary,
}: OmniMapProps): JSX.Element {
  // Bearing tracking — TacticalMap keeps its own copy internally;
  // OmniMap mirrors it for the HUD overlay so the StateBadge / ScaleBar
  // can react. The shared MapLibre instance lives on `window.__phantomMap`
  // when the dev `__phantom` debug glob is on; otherwise we just live
  // without the bearing chip until the operator rotates the map.
  const [bearing, setBearing] = useState<number | null>(null);
  // Phase 24-E — LayerLibrary slide-in panel state.
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // The DEV debug glob exposes the live MapLibre instance the moment
    // TacticalMap mounts. We poll once via rAF and bail out if the
    // glob isn't present (production / SSR / tests).
    const probe = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const phantom = (window as any).__phantom;
      const map: maplibregl.Map | undefined = phantom?.map;
      if (!map) return;
      const onRotate = () => setBearing(map.getBearing());
      onRotate();
      map.on('rotate', onRotate);
      return () => map.off('rotate', onRotate);
    };
    let cleanup: (() => void) | undefined;
    const handle = window.requestAnimationFrame(() => {
      cleanup = probe();
    });
    return () => {
      window.cancelAnimationFrame(handle);
      cleanup?.();
    };
  }, []);

  return (
    <div
      data-testid="omnimap"
      className={`relative w-full h-full ${className}`}
    >
      <TacticalMap initialCenter={initialCenter} initialZoom={initialZoom} />
      <HudShell
        bearing={bearing}
        bridgeAgent={bridgeAgent}
        onOpenLibrary={() => {
          setLibraryOpen(true);
          onOpenLibrary?.();
        }}
      />
      <LayerLibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  );
}
