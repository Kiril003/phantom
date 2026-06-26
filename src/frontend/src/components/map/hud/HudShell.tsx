import { useState } from 'react';
import { MapStateBadge } from './MapStateBadge';
import { ScaleBar } from './ScaleBar';
import { LayerPalette } from './LayerPalette';
import { TacticalStatsZone } from './TacticalStatsZone';
import { NavigationZone } from './NavigationZone';
import { LayerControlZone } from './LayerControlZone';
import { RoutingTool } from './RoutingTool';
import { GeofenceDrawTool } from './GeofenceDrawTool';
import { CoordinateReadout } from './StatusChips';
import { AirRaidLayer } from '../layers/AirRaidLayer';
import { NearbyPanel } from '../NearbyPanel';

import { useMapStore } from '../../../stores/mapStore';
import { useMapAgentBridge } from '../../../hooks/useMapAgentBridge';
import { useViewport } from '../../../hooks/useViewport';
/**
 * Phase 24-D/PRE — Master HUD Shell for OmniMap.
 *
 * Implements a strict slot-based layout for the 1024x600 display:
 * 
 * [A] Top-Left: System state.
 * [B] Top-Center: Alerts (Air Raid).
 * [C] Top-Right: Tactical stats (GPS, Compass, Sync).
 * [D] Center-Left: Main Layer Selector.
 * [E] Center-Right: Advanced Tools (Routing, Geofence).
 * [F] Bottom-Left: Scale & Coordinates.
 * [G] Bottom-Center: Navigation (Search, TimeMachine, Toolbar).
 */

export interface HudShellProps {
  bearing?: number | null;
  mapStyle: string;
  onCycleStyle: () => void;
  onResetBearing: () => void;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  offlineOpen: boolean;
  onToggleOffline: () => void;
  analysisOpen: boolean;
  onToggleAnalysis: () => void;
  storyOpen: boolean;
  onToggleStory: () => void;
  ghostOpen: boolean;
  onToggleGhost: () => void;

  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onAddPoi: () => void;

  bridgeAgent?: boolean;
  onOpenLibrary?: () => void;
  onSearchResults?: (results: any) => void;
  className?: string;
}

export function HudShell({
  bearing = null,
  mapStyle,
  onCycleStyle,
  onResetBearing,
  timelineOpen,
  onToggleTimeline,
  offlineOpen,
  onToggleOffline,
  analysisOpen,
  onToggleAnalysis,
  storyOpen,
  onToggleStory,
  ghostOpen,
  onToggleGhost,
  onZoomIn,
  onZoomOut,
  onCenter,
  onAddPoi,
  bridgeAgent = true,
  onOpenLibrary,
  onSearchResults,
  className = '',
}: HudShellProps): JSX.Element {
  useMapAgentBridge({ skip: !bridgeAgent });
  const viewport = useViewport(bearing);
  const [routingActive, setRoutingActive] = useState(false);
  const [geofenceActive, setGeofenceActive] = useState(false);

  const { tactical, zoom } = useMapStore((s) => ({
    tactical: s.tactical,
    zoom: s.zoom,
  }));

  const lat = tactical.lat ?? viewport.center?.[0] ?? 50.45;

  return (
    <div
      data-testid="hud-shell"
      className={`pointer-events-none absolute inset-0 z-30 ${className}`}
    >
      {/* [A] Top-Left: SystemState badge */}
      <div className="absolute top-3 left-3 pointer-events-auto">
        <MapStateBadge />
      </div>

      {/* [B] Top-Center: AirRaid live strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto">
        <AirRaidLayer />
      </div>

      {/* [C] Top-Right: Tactical Stats */}
      <div className="absolute top-3 right-3 pointer-events-auto">
        <TacticalStatsZone />
      </div>

      {/* [D] Center-Left: Layer Control (Lateral Bar) */}
      <div className="absolute top-1/2 left-3 -translate-y-1/2 pointer-events-auto">
        <LayerControlZone
          bearing={tactical.bearing}
          mapStyle={mapStyle}
          onCycleStyle={onCycleStyle}
          onResetBearing={onResetBearing}
          timelineOpen={timelineOpen}
          onToggleTimeline={onToggleTimeline}
          offlineOpen={offlineOpen}
          onToggleOffline={onToggleOffline}
          analysisOpen={analysisOpen}
          onToggleAnalysis={onToggleAnalysis}
          storyOpen={storyOpen}
          onToggleStory={onToggleStory}
          ghostOpen={ghostOpen}
          onToggleGhost={onToggleGhost}
        />
      </div>

      {/* [E] Center-Right: Advanced Tools */}
      <div className="absolute top-1/2 right-3 -translate-y-1/2 flex flex-col items-end gap-2 pointer-events-auto">
        <RoutingTool
          active={routingActive}
          onToggle={() => {
            setRoutingActive(!routingActive);
            if (!routingActive) setGeofenceActive(false);
          }}
        />
        <GeofenceDrawTool
          active={geofenceActive}
          onToggle={() => {
            setGeofenceActive(!geofenceActive);
            if (!geofenceActive) setRoutingActive(false);
          }}
        />
      </div>

      {/* [F] Bottom-Left: Scale & Coordinates */}
      <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2 pointer-events-auto">
        <CoordinateReadout
          lat={tactical.lat}
          lon={tactical.lon}
          source={tactical.source}
        />
        <div className="flex items-center gap-2">
          <ScaleBar zoom={zoom} lat={lat} />
          <LayerPalette onOpenLibrary={onOpenLibrary} />
        </div>
      </div>

      {/* [G] Bottom-Center: Navigation Zone */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto">
        <NavigationZone
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onCenter={onCenter}
          onAddPoi={onAddPoi}
          onSearchResults={onSearchResults}
        />
      </div>

      {/* [H] Bottom-Right: Context Panels (Nearby) */}
      <div className="absolute bottom-3 right-3 pointer-events-auto">
        <NearbyPanel
          lat={tactical.lat}
          lon={tactical.lon}
          zoom={zoom}
          onSelect={() => {
            // Forward selection to map via store or direct flyTo
          }}
        />
      </div>
    </div>
  );
}
