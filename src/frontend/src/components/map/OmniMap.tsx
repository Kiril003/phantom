import { useCallback, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { TacticalMap } from './TacticalMap';
import { HudShell } from './hud/HudShell';
import { LayerLibraryPanel } from './panels/LayerLibraryPanel';
import { OfflinePanel } from './panels/OfflinePanel';
import { AnalysisPanel } from './panels/AnalysisPanel';
import { SearchResultsPanel, type SearchResult } from './panels/SearchResultsPanel';
import { StoryPanel } from './panels/StoryPanel';
import { GhostPanel } from './panels/GhostPanel';
import { TimelineDrawer } from './TimelineDrawer';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMapStore } from '../../stores/mapStore';
import { settingsApi } from '../../services/api';

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
  const [pitch, setPitch] = useState(0);
  const [toggleTilt, setToggleTilt] = useState<() => void>(() => () => {});
  // Phase 24-E — LayerLibrary slide-in panel state.
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Phase 24-G — Offline region manager state.
  const [offlineOpen, setOfflineOpen] = useState(false);
  // Phase 9.4b — Timeline drawer state.
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Phase 24-G — Analysis panel state.
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const measurePath = useMapStore((s) => s.measurePath);
  // Phase 24-G — Search results state.
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    remembered: SearchResult[];
    osm: SearchResult[];
    pois: SearchResult[];
    /** Стан геокодера: порожньо при 'unreachable' — не відповідь. */
    sourceStatus?: 'ok' | 'unreachable' | 'disabled';
    sourceDetail?: string | null;
  }>({ remembered: [], osm: [], pois: [] });

  // Phase 24-PRE — HUD action handlers.
  const [zoomIn, setZoomIn] = useState<() => void>(() => { });
  const [zoomOut, setZoomOut] = useState<() => void>(() => { });
  const [centerToMe, setCenterToMe] = useState<() => void>(() => { });
  const [addPoi, setAddPoi] = useState<() => void>(() => { });
  const [resetBearing, setResetBearing] = useState<() => void>(() => { });

  // TacticalMap re-registers its zoom/center/add-poi/reset-bearing/tilt
  // callbacks in a single effect keyed on these six props (see the
  // `onZoomIn?.(...)` block near its bottom). Passing fresh inline arrows
  // here on every render made that dependency array change every render,
  // so the effect re-ran, called setZoomIn/setCenterToMe/etc with new
  // closures, which changed OmniMap's state, which re-rendered OmniMap,
  // which produced fresh inline arrows again — an unbounded render loop
  // that pegged the CPU the moment OmniMap mounted (confirmed via
  // `node --prof`: the hot path was TacticalMap's effect commit cycle,
  // never a single synchronous re-entrant render, so React's built-in
  // "Maximum update depth exceeded" guard never caught it). Memoizing
  // these with an empty dep array keeps their identity stable across
  // renders, so the effect only re-runs when the map's own callbacks
  // actually change.
  const registerZoomIn = useCallback((fn: () => void) => setZoomIn(() => fn), []);
  const registerZoomOut = useCallback((fn: () => void) => setZoomOut(() => fn), []);
  const registerCenterToMe = useCallback((fn: () => void) => setCenterToMe(() => fn), []);
  const registerAddPoi = useCallback((fn: () => void) => setAddPoi(() => fn), []);
  const registerResetBearing = useCallback((fn: () => void) => setResetBearing(() => fn), []);
  const registerToggleTilt = useCallback((fn: () => void) => setToggleTilt(() => fn), []);

  const mapStyle = useSettingsStore((s) => s.values.ui_map_style as string) || 'dark';
  const setSettingValue = useSettingsStore((s) => s.setValue);
  const center = useMapStore((s) => s.center);

  const cycleMapStyle = () => {
    // 'satellite' removed from the cycle — no free-for-commercial-use
    // satellite source (see mapTokens.ts). Stale persisted 'satellite'
    // values still resolve via buildPhantomStyle(); this only controls
    // what the cycle button walks through.
    const styles = ['dark', 'streets'];
    const idx = styles.indexOf(mapStyle);
    const next = styles[(idx + 1) % styles.length];
    setSettingValue('ui_map_style', next);
    settingsApi.set('ui_map_style', next).catch(() => {});
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // The DEV debug glob exposes the live MapLibre instance the moment
    // TacticalMap mounts. We poll once via rAF and bail out if the
    // glob isn't present (production / SSR / tests).
    const probe = () => {
       
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
      <TacticalMap
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        onZoomIn={registerZoomIn}
        onZoomOut={registerZoomOut}
        onCenterToMe={registerCenterToMe}
        onAddPoi={registerAddPoi}
        onResetBearing={registerResetBearing}
        onToggleTilt={registerToggleTilt}
        onTiltChange={setPitch}
      />
      <HudShell
        bearing={bearing}
        bridgeAgent={bridgeAgent}
        mapStyle={mapStyle}
        onCycleStyle={cycleMapStyle}
        onResetBearing={resetBearing}
        onToggleTilt={toggleTilt}
        tilted={pitch > 10}
        timelineOpen={timelineOpen}
        onToggleTimeline={() => setTimelineOpen(!timelineOpen)}
        offlineOpen={offlineOpen}
        onToggleOffline={() => setOfflineOpen(!offlineOpen)}
        analysisOpen={analysisOpen}
        onToggleAnalysis={() => setAnalysisOpen(!analysisOpen)}
        storyOpen={storyOpen}
        onToggleStory={() => setStoryOpen(!storyOpen)}
        ghostOpen={ghostOpen}
        onToggleGhost={() => setGhostOpen(!ghostOpen)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onCenter={centerToMe}
        onAddPoi={addPoi}
        onOpenLibrary={() => {
          setLibraryOpen(true);
          onOpenLibrary?.();
        }}
        onSearchResults={(res) => {
          setSearchResults(res as any);
          setSearchResultsOpen(true);
        }}
      />
      <LayerLibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <OfflinePanel open={offlineOpen} onClose={() => setOfflineOpen(false)} />
      {/* Шлях приходить зі стору. Раніше сюди не передавали НІЧОГО, тож
          обидва інструменти панелі — «Лінійка» і «Рельєф» — не могли
          спрацювати ніколи: вони чекали на лінію, якої не існувало. */}
      <AnalysisPanel
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        selectedPath={measurePath}
      />
      <StoryPanel open={storyOpen} onClose={() => setStoryOpen(false)} viewportCenter={(center ?? [30.52, 50.45]) as any} />
      <GhostPanel open={ghostOpen} onClose={() => setGhostOpen(false)} systemState="SHADOW" />
      <SearchResultsPanel
        open={searchResultsOpen}
        onClose={() => setSearchResultsOpen(false)}
        results={searchResults}
        sourceStatus={searchResults.sourceStatus ?? 'ok'}
        sourceDetail={searchResults.sourceDetail ?? null}
        onSelect={(res) => {
          useMapStore.getState().setCenter([res.lon, res.lat]);
          useMapStore.getState().setZoom(17);
        }}
      />
      <TimelineDrawer
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        onSelect={(e) => {
          // This should ideally use the mapRef from TacticalMap
          // I'll ensure setCenter/setZoom is called via store
          useMapStore.getState().setCenter([e.lon, e.lat]);
          useMapStore.getState().setZoom(17);
        }}
      />
    </div>
  );
}
