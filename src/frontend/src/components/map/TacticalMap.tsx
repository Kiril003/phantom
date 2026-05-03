import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import {
  Search,
  Compass,
  Crosshair,
  Plus,
  Minus,
  Route,
  Sparkles,
  Satellite,
  Layers,
  Radar,
  Wifi,
  MapPin,
  Flame,
  Eye,
  EyeOff,
  Clock,
} from 'lucide-react';
import { TimelineDrawer } from './TimelineDrawer';
import { NearbyPanel } from './NearbyPanel';
import { MapContext } from './MapContext';
import { ServicesHealthBanner } from './ServicesHealthBanner';
import { AttributionDrawer } from './hud/AttributionDrawer';
import { BaseLayer } from './layers/BaseLayer';
import { PresenceLayer } from './layers/PresenceLayer';
import { WardrivingLayer } from './layers/WardrivingLayer';
import { IntelLayer } from './layers/IntelLayer';
import { ReconLayer } from './layers/ReconLayer';
import { FactMarkerLayer } from './layers/FactMarkerLayer';
import { HeatmapLayer } from './HeatmapLayer';
import { MarkerCard } from './MarkerCard';
import { useMapStore, type MapLayerKey } from '../../stores/mapStore';
import { useSystemStore } from '../../stores/systemStore';
import { getMapTokens, buildPhantomStyle, type PhantomMapStyle } from './mapTokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { settingsApi, type Bounds } from '../../services/api';
// `geolocationService` is owned by `App.GlobalGeolocationManager` —
// TacticalMap consumes results via `mapStore` polling, no direct import.
import { expandQuery } from '../../services/translit';

interface TacticalMapProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
}

const MAP_STYLE_VALUES: readonly PhantomMapStyle[] = ['dark', 'satellite', 'streets'];

function resolveMapStyle(raw: unknown): PhantomMapStyle {
  return typeof raw === 'string' && (MAP_STYLE_VALUES as readonly string[]).includes(raw)
    ? (raw as PhantomMapStyle)
    : 'dark';
}

function computeBounds(map: MapLibreMap): Bounds {
  const b = map.getBounds();
  return {
    lat1: b.getSouth(),
    lon1: b.getWest(),
    lat2: b.getNorth(),
    lon2: b.getEast(),
  };
}

const LATERAL_ITEMS: Array<{ key: MapLayerKey; icon: React.ReactNode; label: string }> = [
  { key: 'base',       icon: <Layers size={18} strokeWidth={1.75} />,  label: 'Base' },
  { key: 'presence',   icon: <Radar size={18} strokeWidth={1.75} />,   label: 'Presence' },
  { key: 'wardriving', icon: <Wifi size={18} strokeWidth={1.75} />,    label: 'Wardriving' },
  { key: 'heatmap',    icon: <Flame size={18} strokeWidth={1.75} />,   label: 'Heatmap' },
  { key: 'intel',      icon: <MapPin size={18} strokeWidth={1.75} />,  label: 'Intel' },
  { key: 'recon',      icon: <Route size={18} strokeWidth={1.75} />,   label: 'Recon' },
  // Phase 9.4c audit G6 — geo-tagged memory facts.
  { key: 'facts',      icon: <Sparkles size={18} strokeWidth={1.75} />, label: 'Facts' },
];

export function TacticalMap({
  initialCenter,
  initialZoom = 15,
  className = '',
}: TacticalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [styleLoadFailed, setStyleLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const mapStyleSetting = useSettingsStore((s) => s.values.ui_map_style);
  const mapStyle = resolveMapStyle(mapStyleSetting);
  const setSettingValue = useSettingsStore((s) => s.setValue);

  const cycleMapStyle = useCallback(() => {
    const idx = MAP_STYLE_VALUES.indexOf(mapStyle);
    const next = MAP_STYLE_VALUES[(idx + 1) % MAP_STYLE_VALUES.length];
    setSettingValue('ui_map_style', next);
    // Best-effort backend persist; local optimistic state already updated.
    settingsApi.set('ui_map_style', next).catch(() => {
      /* offline / pre-auth — optimistic state survives via settings store. */
    });
  }, [mapStyle, setSettingValue]);

  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const select = useMapStore((s) => s.select);
  const setCenter = useMapStore((s) => s.setCenter);
  const setZoom = useMapStore((s) => s.setZoom);
  const context = useSystemStore((s) => s.context);
  const loadWardriving = useMapStore((s) => s.loadWardriving);
  const loadHeatmap = useMapStore((s) => s.loadHeatmap);
  const loadPOIs = useMapStore((s) => s.loadPOIs);
  const loadTrack = useMapStore((s) => s.loadTrack);
  const loadGeoTaggedFacts = useMapStore((s) => s.loadGeoTaggedFacts);
  const savePOI = useMapStore((s) => s.savePOI);
  const loading = useMapStore((s) => s.loading);
  const searchQuery = useMapStore((s) => s.searchQuery);
  const setSearchQuery = useMapStore((s) => s.setSearchQuery);
  const wardrivingRecords = useMapStore((s) => s.wardrivingRecords);
  const pois = useMapStore((s) => s.pois);
  const toast = useMapStore((s) => s.toast);
  const setToast = useMapStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  const searchResults = useMemo(() => {
    // Phase 9.4b bug-fix — `expandQuery` adds Cyrillic↔Latin transliterations
    // so "парк" matches "Park Komenského" and vice versa. The original query
    // is always first in the list so an exact match still ranks highest.
    const rawQueries = expandQuery(searchQuery).map((q) => q.toLowerCase());
    if (rawQueries.length === 0) return null;
    const matches = (haystack: string) =>
      rawQueries.some((q) => haystack.includes(q));
    const nets = wardrivingRecords
      .filter(
        (r) =>
          matches((r.ssid ?? '').toLowerCase()) ||
          matches(r.mac.toLowerCase()),
      )
      .slice(0, 8);
    const intel = pois
      .filter(
        (p) =>
          matches(p.name.toLowerCase()) ||
          matches((p.notes ?? '').toLowerCase()),
      )
      .slice(0, 6);
    return { nets, intel, total: nets.length + intel.length };
  }, [searchQuery, wardrivingRecords, pois]);

  const resolvedInitialCenter: [number, number] =
    initialCenter ??
    (context?.where.fix && context.where.lat != null && context.where.lon != null
      ? [context.where.lon, context.where.lat]
      : [30.52, 50.45]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const tokens = getMapTokens();
    const map = new maplibregl.Map({
      container,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: buildPhantomStyle(tokens, mapStyle) as any,
      center: resolvedInitialCenter,
      zoom: initialZoom,
      attributionControl: false,
      // Phase 24-PRE — enable rotation so the Compass HUD chip
      // reflects real bearing and the reset button has meaning.
      // Pitch stays linked to rotate (default) for upcoming
      // hillshade / 3D terrain layers.
      dragRotate: true,
      pitchWithRotate: true,
    });
    mapRef.current = map;
    setStyleLoadFailed(false);

    // Phase 24-D — expose the live MapLibre instance so the OmniMap
    // HUD overlay (`OmniMap.tsx`) can subscribe to rotate events and
    // mirror bearing into the new `MapStateBadge` / `BearingTool`
    // chips. Read-only handle; we never mutate via the glob.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const phantom = ((window as any).__phantom = (window as any).__phantom ?? {});
      phantom.map = map;
    }

    const onLoad = () => {
      setReady(true);
      setStyleLoadFailed(false);
    };
    const onRotate = () => setBearing(map.getBearing());
    // Phase 24-PRE — surface tile/style/network errors to operator.
    // The previous behaviour swallowed every map.on('error') silently,
    // which is the root cause of "buttons appear to do nothing" reports
    // (toggling a layer triggered a load failure that was never shown).
    const onError = (e: { error?: { message?: string } }) => {
      const msg = e?.error?.message ?? 'Map source error';
      // Truncate noisy MapLibre stack traces to keep the toast scannable.
      useMapStore.getState().setToast(`Map: ${msg.slice(0, 80)}`);
    };
    const onMove = () => {
      const c = map.getCenter();
      setCenter([c.lat, c.lng]);
      const z = map.getZoom();
      setZoom(z);
      setCurrentZoom(z);
    };
    const onClick = () => select(null);

    /* Long-press drop POI.
     *  - Requires pointer to stay within MOVE_THRESHOLD px for LONG_PRESS_MS.
     *  - ANY map pan (dragstart / zoomstart / rotatestart) cancels the timer.
     *  - Movement of more than MOVE_THRESHOLD px ALSO cancels.
     *  This prevents the confirm dialog from firing when user is panning.
     */
    const LONG_PRESS_MS = 550;
    const MOVE_THRESHOLD = 5;

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressLngLat: { lng: number; lat: number } | null = null;
    let longPressOriginPx: { x: number; y: number } | null = null;
    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressLngLat = null;
      longPressOriginPx = null;
    };
    const onMouseDown = (e: {
      lngLat: { lng: number; lat: number };
      point?: { x: number; y: number };
      originalEvent?: { button?: number };
    }) => {
      // Ignore right/middle click and any existing timer.
      if (e.originalEvent?.button && e.originalEvent.button !== 0) return;
      clearLongPress();
      longPressLngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      longPressOriginPx = e.point ? { x: e.point.x, y: e.point.y } : null;
      longPressTimer = setTimeout(() => {
        if (!longPressLngLat) return;
        setPendingPoi(longPressLngLat);
        longPressTimer = null;
      }, LONG_PRESS_MS);
    };
    const onMouseMove = (e: { point?: { x: number; y: number } }) => {
      if (!longPressTimer || !longPressOriginPx || !e.point) return;
      const dx = e.point.x - longPressOriginPx.x;
      const dy = e.point.y - longPressOriginPx.y;
      if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
        clearLongPress();
      }
    };
    const onMouseUp = () => clearLongPress();

    map.on('load', onLoad);
    map.on('moveend', onMove);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('rotate' as any, onRotate);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('error' as any, onError);
    map.on('click', onClick);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('mousedown' as any, onMouseDown);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('mousemove' as any, onMouseMove);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('mouseup' as any, onMouseUp);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('touchstart' as any, onMouseDown);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('touchmove' as any, onMouseMove);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('touchend' as any, onMouseUp);
    // Any real map gesture cancels the pending long-press immediately.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('dragstart' as any, clearLongPress);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('zoomstart' as any, clearLongPress);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('rotatestart' as any, clearLongPress);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('pitchstart' as any, clearLongPress);

    return () => {
      clearLongPress();
      map.off('load', onLoad);
      map.off('moveend', onMove);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('rotate' as any, onRotate);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('error' as any, onError);
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  // Phase 24-PRE — reactively rebuild MapLibre style when ui_map_style
  // setting changes. Previously the style was set only on mount, so the
  // Satellite HUD button (now wired) had to round-trip through a re-mount
  // to take effect. setStyle({diff: true}) preserves zoom/center/markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const tokens = getMapTokens();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setStyle(buildPhantomStyle(tokens, mapStyle) as any, { diff: true });
  }, [mapStyle, ready]);

  // Phase 24-PRE — ready-timeout fallback. If the map style (OSM tiles
  // or ArcGIS satellite) fails to fetch within 5s — typical when offline,
  // CORS-blocked, or DNS slow — surface a clear inline error with retry
  // instead of leaving operator staring at a black canvas with toggles
  // that "do nothing" (Zustand mutates but no markers ever render
  // because layers gate on `ready`).
  useEffect(() => {
    if (ready) {
      setStyleLoadFailed(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!mapRef.current) return;
      // Only flip into failed state if load really hasn't fired —
      // mapRef.current.loaded() is the MapLibre canonical check.
      if (!mapRef.current.loaded()) setStyleLoadFailed(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [ready, retryNonce]);

  const handleStyleRetry = useCallback(() => {
    setStyleLoadFailed(false);
    setReady(false);
    // Bumping the nonce re-runs the mount effect, which tears down the
    // current MapLibre instance and creates a fresh one.
    setRetryNonce((n) => n + 1);
  }, []);

  const handleResetBearing = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.rotateTo(0, { duration: 400 });
    map.easeTo({ pitch: 0, duration: 400 });
  }, []);

  const [pendingPoi, setPendingPoi] = useState<{ lng: number; lat: number } | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);

  // Phase 9.4b — start the browser geolocation stream when the map mounts.
  // Contributes a mid-trust LocationEstimate to the backend resolver. Stops
  // on unmount; permission prompts are handled by the browser itself, the
  // service is silent on denial and lets the resolver fall through.


  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = computeBounds(map);
    // Phase 24-PRE — surface load failures instead of silent .catch.
    // The store already records `error` per call; we additionally toast
    // the first user-visible failure so the operator never sees a
    // toggle "do nothing" without explanation.
    const reportLoad = (label: string) => (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      useMapStore.getState().setToast(`${label}: ${msg.slice(0, 80)}`);
    };
    if (layers.wardriving) loadWardriving(bounds).catch(reportLoad('Wardriving'));
    if (layers.heatmap) loadHeatmap(bounds).catch(reportLoad('Heatmap'));
    if (layers.intel) loadPOIs().catch(reportLoad('POIs'));
    if (layers.recon) loadTrack(2).catch(reportLoad('Track'));
    if (layers.facts) loadGeoTaggedFacts().catch(reportLoad('Facts'));
  }, [ready, layers.wardriving, layers.heatmap, layers.intel, layers.recon, layers.facts, loadWardriving, loadHeatmap, loadPOIs, loadTrack, loadGeoTaggedFacts]);

  // Refresh facts every 5 minutes while the layer is visible (audit G6 spec).
  useEffect(() => {
    if (!layers.facts) return;
    const handle = window.setInterval(() => {
      loadGeoTaggedFacts().catch(() => {});
    }, 5 * 60_000);
    return () => window.clearInterval(handle);
  }, [layers.facts, loadGeoTaggedFacts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let timer: number | null = null;
    const handler = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const bounds = computeBounds(map);
        if (useMapStore.getState().layers.wardriving) loadWardriving(bounds).catch(() => {});
        if (useMapStore.getState().layers.heatmap) loadHeatmap(bounds).catch(() => {});
      }, 400);
    };
    map.on('moveend', handler);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      map.off('moveend', handler);
    };
  }, [ready, loadWardriving, loadHeatmap]);

  const handleCenterToMe = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (context?.where.fix && context.where.lat != null && context.where.lon != null) {
      map.flyTo({ center: [context.where.lon, context.where.lat], zoom: 17 });
    }
  }, [context]);

  const handleAddPoi = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setPendingPoi({ lng: c.lng, lat: c.lat });
  }, []);

  const confirmPendingPoi = useCallback(async () => {
    if (!pendingPoi) return;
    const name =
      pendingName.trim() ||
      `POI ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
    const saved = await savePOI({
      lat: pendingPoi.lat,
      lon: pendingPoi.lng,
      name,
      category: 'saved',
      notes: '',
      icon: '📍',
      is_secret: false,
    });
    setPendingPoi(null);
    setPendingName('');
    if (saved) setToast(`POI "${saved.name}" dropped`);
    else setToast('POI save failed');
  }, [pendingPoi, pendingName, savePOI, setToast]);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();
  }, []);

  return (
    <div
      className={`phantom-map-frame relative w-full h-full overflow-hidden ${className}`}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="region"
        aria-label="Tactical map"
      />

      <MapContext.Provider value={{ map: mapRef.current, ready }}>
        {layers.base && <BaseLayer />}
        {layers.presence && <PresenceLayer />}
        {layers.wardriving && <WardrivingLayer />}
        {layers.heatmap && <HeatmapLayer />}
        {layers.intel && <IntelLayer />}
        {layers.recon && <ReconLayer />}
        {layers.facts && <FactMarkerLayer />}
        <MarkerCard />
      </MapContext.Provider>

      {/* Phase 9.4c audit Q6 (B-WK-3 fix 2026-04-30) — surfaces Nominatim/
          Overpass/ipapi outages so the operator can tell "empty search"
          from "service down". The banner is now suppressed on cold-boot
          stale (no recorded failure) so the warning isn't permanently
          lit on a healthy session. */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none flex justify-center pt-1">
        <div className="pointer-events-auto">
          <ServicesHealthBanner />
        </div>
      </div>

      {/* Edge vignette — warm cream wash on the borders so glass HUD
          chips read crisply over busy cartography. The colour follows
          `--surface-base` so cyberdeck-cold falls back to the dark
          edge fade automatically. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 60%, color-mix(in srgb, var(--surface-base) 35%, transparent) 100%)',
        }}
      />

      {/* Lateral glass icon bar — left */}
      <aside
        className="absolute top-3 bottom-3 left-3 z-20 pointer-events-auto"
      >
        <div
          className="glass-card flex flex-col items-center py-2 px-1 gap-1"
          style={{ borderRadius: 20, width: 56 }}
        >
          {LATERAL_ITEMS.map((item) => (
            <LateralButton
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={layers[item.key]}
              onClick={() => toggleLayer(item.key)}
            />
          ))}
          <Divider />
          <LateralButton
            icon={<Satellite size={18} strokeWidth={1.75} />}
            label={`Style · ${mapStyle}`}
            active={mapStyle !== 'dark'}
            onClick={cycleMapStyle}
          />
          <LateralButton
            icon={<Compass size={18} strokeWidth={1.75} />}
            label={`Bearing · ${String(Math.round(bearing)).padStart(3, '0')}°`}
            active={Math.abs(bearing) > 0.5}
            onClick={handleResetBearing}
          />
          <LateralButton
            icon={<Clock size={18} strokeWidth={1.75} />}
            label="Timeline"
            active={timelineOpen}
            onClick={() => setTimelineOpen((v) => !v)}
          />
        </div>
      </aside>

      {/* Floating search bar — top. Placeholder is rendered in Playfair
          italic to match the design DNA "voice-first" feel; once the
          operator types, the input switches to Manrope display. */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
        style={{ width: 440 }}
      >
        <div
          className="glass-card flex items-center gap-2 px-3"
          style={{ height: 44, borderRadius: 9999 }}
        >
          <Search size={16} strokeWidth={1.75} style={{ color: 'var(--primary-shadow)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Знайти місце / мережу / точку…"
            aria-label="Map search"
            className="flex-1 bg-transparent outline-none border-none phantom-map-search"
            style={{
              color: 'var(--ink-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-sm)',
              minHeight: 40,
            }}
          />
          <span
            className="uppercase inline-flex items-center gap-1 px-2 rounded-full"
            style={{
              height: 22,
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
            }}
          >
            <Sparkles size={10} strokeWidth={2} />
            <span>AI</span>
          </span>
        </div>
        {searchResults && (
          <div
            className="glass-elevated mt-2"
            style={{
              borderRadius: 14,
              padding: 8,
              maxHeight: 260,
              overflowY: 'auto',
              boxShadow:
                '0 16px 36px -10px rgba(0,0,0,0.55), 0 0 0 1px var(--glass-border)',
            }}
          >
            {searchResults.total === 0 && (
              <div
                className="px-3 py-3 text-center italic"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--ink-muted)',
                }}
              >
                No networks or intel match "{searchQuery}".
              </div>
            )}
            {searchResults.intel.length > 0 && (
              <>
                <div
                  className="uppercase px-3 py-1"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-micro)',
                    letterSpacing: 'var(--tracking-widest)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  Intel · {searchResults.intel.length}
                </div>
                {searchResults.intel.map((poi) => (
                  <button
                    key={poi.id}
                    type="button"
                    onClick={() => {
                      mapRef.current?.flyTo({ center: [poi.lon, poi.lat], zoom: 17 });
                      setSearchQuery('');
                    }}
                    className="w-full flex items-center gap-2 px-3"
                    style={{
                      minHeight: 44,
                      borderRadius: 10,
                      color: 'var(--ink-primary)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-xs)',
                      background: 'transparent',
                      border: 'none',
                      textAlign: 'left',
                    }}
                  >
                    <MapPin size={12} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
                    <span className="flex-1 truncate">{poi.name}</span>
                    <span
                      className="tabular-nums"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-micro)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      {poi.lat.toFixed(3)}, {poi.lon.toFixed(3)}
                    </span>
                  </button>
                ))}
              </>
            )}
            {searchResults.nets.length > 0 && (
              <>
                <div
                  className="uppercase px-3 py-1 mt-1"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-micro)',
                    letterSpacing: 'var(--tracking-widest)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  Networks · {searchResults.nets.length}
                </div>
                {searchResults.nets.map((rec) => (
                  <button
                    key={`${rec.mac}-${rec.first_seen}`}
                    type="button"
                    onClick={() => {
                      mapRef.current?.flyTo({ center: [rec.lon, rec.lat], zoom: 17 });
                      setSearchQuery('');
                    }}
                    className="w-full flex items-center gap-2 px-3"
                    style={{
                      minHeight: 44,
                      borderRadius: 10,
                      color: 'var(--ink-primary)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-xs)',
                      background: 'transparent',
                      border: 'none',
                      textAlign: 'left',
                    }}
                  >
                    <Wifi size={12} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
                    <span className="flex-1 truncate">
                      {rec.ssid?.trim() || <em style={{ color: 'var(--ink-muted)' }}>(hidden)</em>}
                    </span>
                    <span
                      className="tabular-nums"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-micro)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      {rec.rssi ?? '—'} dBm
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* POI confirm dialog. Backdrop blends with the warm theme so the
          modal reads as "the map is paused" rather than "you've left the
          surface". cyberdeck-cold automatically picks up the darker
          surface-void via the inline mix below. */}
      {pendingPoi && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
          style={{
            background:
              'color-mix(in srgb, var(--surface-void) 55%, transparent)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
          onClick={() => {
            setPendingPoi(null);
            setPendingName('');
          }}
        >
          <div
            className="glass-elevated"
            style={{
              width: 340,
              borderRadius: 18,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="uppercase"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-widest)',
                color: 'var(--ink-muted)',
              }}
            >
              Drop POI
            </div>
            <div
              className="tabular-nums"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-secondary)',
              }}
            >
              {pendingPoi.lat.toFixed(5)}, {pendingPoi.lng.toFixed(5)}
            </div>
            <input
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="POI name (optional)"
              aria-label="POI name"
              className="bg-transparent outline-none"
              style={{
                minHeight: 44,
                padding: '0 12px',
                borderRadius: 10,
                color: 'var(--ink-primary)',
                background: 'var(--surface-deep)',
                border: '1px solid var(--glass-border)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-sm)',
              }}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                className="active:scale-95"
                onClick={() => {
                  setPendingPoi(null);
                  setPendingName('');
                }}
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  borderRadius: 9999,
                  background: 'transparent',
                  color: 'var(--ink-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  letterSpacing: 'var(--tracking-wide)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="active:scale-95"
                aria-label="Confirm POI"
                onClick={confirmPendingPoi}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 9999,
                  background: 'var(--accent)',
                  color: 'var(--ink-inverse)',
                  border: '1px solid var(--accent)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  letterSpacing: 'var(--tracking-wider)',
                  textTransform: 'uppercase',
                  boxShadow: '0 0 20px var(--accent-glow)',
                }}
              >
                Drop POI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 24-PRE — style-load timeout overlay.
          Renders when MapLibre fails to fire `load` within 5s — almost
          always offline / DNS / blocked tile CDN. The black canvas
          underneath used to look like "buttons broken" because layers
          gate on `ready` and silently no-op. */}
      {styleLoadFailed && (
        <div
          data-testid="map-style-failed"
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
          style={{
            background:
              'color-mix(in srgb, var(--surface-void) 70%, transparent)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <div
            className="glass-elevated"
            style={{
              maxWidth: 360,
              borderRadius: 18,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              textAlign: 'center',
            }}
          >
            <div
              className="uppercase"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-widest)',
                color: 'var(--signal-alert)',
              }}
            >
              Map style failed to load
            </div>
            <div
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-secondary)',
              }}
            >
              Тайли не завантажились за 5 секунд. Перевір з'єднання
              з мережею або переключи стиль.
            </div>
            <div className="flex items-center gap-2 justify-center">
              <button
                type="button"
                onClick={handleStyleRetry}
                className="active:scale-95"
                style={{
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: 9999,
                  background: 'var(--accent)',
                  color: 'var(--ink-inverse)',
                  border: '1px solid var(--accent)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  letterSpacing: 'var(--tracking-wider)',
                  textTransform: 'uppercase',
                  boxShadow: '0 0 20px var(--accent-glow)',
                }}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={cycleMapStyle}
                className="active:scale-95"
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  borderRadius: 9999,
                  background: 'transparent',
                  color: 'var(--ink-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  letterSpacing: 'var(--tracking-wide)',
                }}
              >
                Switch style
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="absolute top-[70px] left-1/2 -translate-x-1/2 z-30 pointer-events-none"
          style={{
            padding: '8px 16px',
            borderRadius: 9999,
            background: 'var(--glass-elevated)',
            border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
            color: 'var(--ink-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-xs)',
            letterSpacing: 'var(--tracking-wide)',
            boxShadow: '0 0 24px var(--accent-glow)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {toast}
        </div>
      )}

      {/* Coordinate HUD — bottom left */}
      <div className="absolute bottom-3 left-[76px] z-20 pointer-events-none">
        <CoordinateReadout context={context} />
      </div>

      {/* Right-column HUD — compass + GPS quality + attribution drawer (24-A) */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none flex flex-col items-end gap-2">
        <CompassChip bearing={bearing} />
        <GpsQualityChip context={context} />
        <StatusChip loading={loading} zoom={mapRef.current?.getZoom() ?? initialZoom} />
        <div className="pointer-events-auto">
          <AttributionDrawer />
        </div>
      </div>

      {/* Bottom glass toolbar — zoom + centre + add POI */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
      >
        <div
          className="glass-card flex items-center gap-1 px-2"
          style={{ height: 48, borderRadius: 9999 }}
        >
          <ToolbarButton icon={<Minus size={16} strokeWidth={1.75} />} onClick={handleZoomOut} label="Zoom out" />
          <ToolbarButton icon={<Plus size={16} strokeWidth={1.75} />} onClick={handleZoomIn} label="Zoom in" />
          <VerticalDivider />
          <ToolbarButton
            icon={<Crosshair size={16} strokeWidth={1.75} />}
            onClick={handleCenterToMe}
            label="Centre on operator"
            disabled={!context?.where.fix}
          />
          <ToolbarButton icon={<MapPin size={16} strokeWidth={1.75} />} onClick={handleAddPoi} label="Drop POI" accent />
        </div>
      </div>

      {/* Crosshair — thin cross at centre */}
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 pointer-events-none"
        style={{ transform: 'translate(-50%, -50%)', width: 40, height: 40, zIndex: 15 }}
      >
        <span className="absolute top-1/2 left-0 right-0" style={{ height: 1, background: 'var(--accent-glow)', opacity: 0.7 }} />
        <span className="absolute left-1/2 top-0 bottom-0" style={{ width: 1, background: 'var(--accent-glow)', opacity: 0.7 }} />
        <span
          className="absolute"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: '1px solid var(--accent)',
            opacity: 0.8,
          }}
        />
      </div>

      <NearbyPanel
        lat={context?.where?.lat ?? null}
        lon={context?.where?.lon ?? null}
        zoom={currentZoom}
        onSelect={(sel) => {
          const map = mapRef.current;
          if (!map) return;
          if (sel.kind === 'remembered') {
            if (sel.item.place_lat != null && sel.item.place_lon != null) {
              map.flyTo({
                center: [sel.item.place_lon, sel.item.place_lat],
                zoom: 17,
              });
            }
          } else {
            map.flyTo({ center: [sel.item.lon, sel.item.lat], zoom: 17 });
          }
        }}
      />
      <TimelineDrawer
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        onSelect={(e) => {
          mapRef.current?.flyTo({ center: [e.lon, e.lat], zoom: 16 });
        }}
      />
    </div>
  );
}

/* ─── Lateral icon button ─────────────────────────────────────────────── */

function LateralButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center transition-all active:scale-95"
      style={{
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        borderRadius: 14,
        background: active
          ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
          : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-secondary)',
        boxShadow: active ? '0 0 14px var(--accent-glow)' : 'none',
        border: active
          ? '1px solid color-mix(in srgb, var(--accent) 42%, transparent)'
          : '1px solid transparent',
      }}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="block" style={{ width: 24, height: 1, margin: '4px 0', background: 'var(--glass-border)' }} />;
}

function VerticalDivider() {
  return <span className="block self-center" style={{ width: 1, height: 20, background: 'var(--glass-border)', margin: '0 4px' }} />;
}

function ToolbarButton({
  icon,
  onClick,
  label,
  accent = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center transition-all active:scale-95"
      style={{
        width: 40,
        height: 40,
        minWidth: 44,
        minHeight: 44,
        borderRadius: 9999,
        background: accent
          ? 'var(--accent)'
          : 'transparent',
        color: accent ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
        border: accent
          ? '1px solid var(--accent)'
          : '1px solid transparent',
        boxShadow: accent ? '0 0 14px var(--accent-glow)' : 'none',
        opacity: disabled ? 0.4 : 1,
      }}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

/* ─── HUD chips ──────────────────────────────────────────────────────── */

interface CtxShape {
  where?: {
    lat: number | null;
    lon: number | null;
    fix: boolean;
    satellites: number;
    speed_kmh: number;
    source?: 'gps_hardware' | 'browser_geolocation' | 'ip_estimate' | 'user_stated' | 'none';
    confidence?: number;
    accuracy_m?: number | null;
  };
}

/**
 * Phase 9.4b bug-fix — Replace the old binary "3D FIX / NO FIX" label with a
 * source-aware readout. The resolver now supplies browser or IP positions
 * long before hardware GPS locks, so "NO FIX" was misleading the operator
 * into thinking nothing worked.
 */
function sourceLabel(
  source: string | undefined,
  fix: boolean,
  confidence: number,
): { text: string; color: string } {
  const pct = Math.round(confidence * 100);
  if (source === 'gps_hardware' && fix) {
    return { text: '3D FIX', color: 'var(--signal-ok)' };
  }
  if (source === 'browser_geolocation') {
    return { text: `BROWSER · ${pct}%`, color: 'var(--signal-info, #22d3ee)' };
  }
  if (source === 'ip_estimate') {
    return { text: `IP · ${pct}%`, color: 'var(--signal-warn)' };
  }
  if (source === 'user_stated') {
    return { text: `STATED · ${pct}%`, color: 'var(--accent)' };
  }
  if (source === 'gps_hardware' && !fix) {
    return { text: 'GPS SEARCHING', color: 'var(--signal-warn)' };
  }
  return { text: 'NO LOCATION', color: 'var(--signal-alert)' };
}

function CoordinateReadout({ context }: { context: CtxShape | null | undefined }) {
  const where = context?.where;
  const fix = !!where?.fix;
  const lat = where?.lat;
  const lon = where?.lon;
  const source = where?.source;
  const confidence = where?.confidence ?? 0;
  const hasPosition = lat != null && lon != null;
  const label = sourceLabel(source, fix, confidence);
  const active = hasPosition && source !== 'none';
  return (
    <div
      className="glass-card flex flex-col gap-1 px-3 py-2 rounded-2xl"
      style={{ minWidth: 190 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: label.color,
            boxShadow: `0 0 6px ${label.color}`,
          }}
        />
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: active ? 'var(--ink-primary)' : 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          {label.text}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-micro)' }}>
          LAT
        </span>
        <span
          className="tabular-nums"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--ink-primary)' }}
        >
          {lat != null ? lat.toFixed(5) : '—'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-micro)' }}>
          LON
        </span>
        <span
          className="tabular-nums"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--ink-primary)' }}
        >
          {lon != null ? lon.toFixed(5) : '—'}
        </span>
      </div>
    </div>
  );
}

function CompassChip({ bearing }: { bearing: number }) {
  return (
    <div
      className="glass-card flex items-center gap-2 px-3 rounded-full"
      style={{ height: 30 }}
    >
      <Compass
        size={14}
        strokeWidth={1.75}
        style={{ color: 'var(--accent)', transform: `rotate(${bearing}deg)` }}
      />
      <span
        className="tabular-nums uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-primary)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        N · {String(Math.round(bearing)).padStart(3, '0')}°
      </span>
    </div>
  );
}

function GpsQualityChip({ context }: { context: CtxShape | null | undefined }) {
  const sats = context?.where?.satellites ?? 0;
  const fix = !!context?.where?.fix;
  const speed = context?.where?.speed_kmh ?? 0;
  return (
    <div
      className="glass-card flex items-center gap-3 px-3 rounded-full"
      style={{ height: 30 }}
    >
      <span className="flex items-center gap-1">
        <Satellite size={12} strokeWidth={1.75} style={{ color: 'var(--ink-muted)' }} />
        <span
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-micro)',
            color:
              sats >= 6 ? 'var(--signal-ok)' :
              sats >= 4 ? 'var(--signal-warn)' :
              'var(--signal-alert)',
          }}
        >
          {String(sats).padStart(2, '0')}
        </span>
      </span>
      <span style={{ color: 'var(--glass-border)' }}>|</span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color: fix ? 'var(--ink-primary)' : 'var(--ink-muted)',
        }}
      >
        {speed.toFixed(0)} km/h
      </span>
    </div>
  );
}

function StatusChip({ loading, zoom }: { loading: boolean; zoom: number }) {
  return (
    <div
      className="glass-card flex items-center gap-2 px-3 rounded-full"
      style={{ height: 30 }}
    >
      {loading ? (
        <EyeOff size={12} strokeWidth={1.75} style={{ color: 'var(--signal-warn)' }} />
      ) : (
        <Eye size={12} strokeWidth={1.75} style={{ color: 'var(--signal-ok)' }} />
      )}
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: loading ? 'var(--signal-warn)' : 'var(--signal-ok)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        {loading ? 'Syncing' : 'Live'}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
        }}
      >
        z{zoom.toFixed(0)}
      </span>
    </div>
  );
}
