import { useState } from 'react';
import { LayerPalette } from './LayerPalette';
import { MapStateBadge } from './MapStateBadge';
import { ScaleBar } from './ScaleBar';
import { SearchOmnibar } from './SearchOmnibar';
import { AirRaidLayer } from '../layers/AirRaidLayer';
import { useMapAgentBridge } from '../../../hooks/useMapAgentBridge';
import { useViewport } from '../../../hooks/useViewport';

/**
 * Phase 24-D — composes the new OmniMap HUD overlays.
 *
 * Sits inside `OmniMap.tsx` on top of the MapLibre canvas. The
 * overlay is intentionally additive to the existing TacticalMap
 * chrome (CompassChip / GpsQualityChip / AttributionDrawer keep their
 * current positions); the new HudShell takes the previously-empty
 * top-left + bottom-left + bottom-center slots. Doctrine §7.1.
 */

export interface HudShellProps {
  bearing?: number | null;
  /** Activate the agent ↔ map WS bridge. Disable in tests / SSR. */
  bridgeAgent?: boolean;
  className?: string;
  onOpenLibrary?: () => void;
}

export function HudShell({
  bearing = null,
  bridgeAgent = true,
  className = '',
  onOpenLibrary,
}: HudShellProps): JSX.Element {
  useMapAgentBridge({ skip: !bridgeAgent });
  const viewport = useViewport(bearing);
  const [libraryOpenedAt, setLibraryOpenedAt] = useState<number | null>(null);

  const lat = viewport.center?.[0] ?? 50.45;

  return (
    <div
      data-testid="hud-shell"
      data-library-opened-at={libraryOpenedAt ?? ''}
      className={`pointer-events-none absolute inset-0 z-30 ${className}`}
    >
      {/* Top-left: SystemState badge */}
      <div className="absolute top-3 left-3 pointer-events-auto">
        <MapStateBadge />
      </div>

      {/* Top-center: AirRaid live strip (24-F) — overrides quiet state. */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto">
        <AirRaidLayer />
      </div>

      {/* Bottom-center: search omnibar */}
      <div className="absolute bottom-[60px] left-1/2 -translate-x-1/2 pointer-events-auto">
        <SearchOmnibar />
      </div>

      {/* Bottom-left: scale bar + layer palette */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-auto">
        <ScaleBar zoom={viewport.zoom} lat={lat} />
        <LayerPalette
          onOpenLibrary={() => {
            setLibraryOpenedAt(Date.now());
            onOpenLibrary?.();
          }}
        />
      </div>
    </div>
  );
}
