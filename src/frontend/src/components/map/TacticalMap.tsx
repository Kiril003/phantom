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
} from 'lucide-react';
import { MapContext } from './MapContext';
import { BaseLayer } from './layers/BaseLayer';
import { PresenceLayer } from './layers/PresenceLayer';
import { WardrivingLayer } from './layers/WardrivingLayer';
import { IntelLayer } from './layers/IntelLayer';
import { ReconLayer } from './layers/ReconLayer';
import { HeatmapLayer } from './HeatmapLayer';
import { MarkerCard } from './MarkerCard';
import { useMapStore, type MapLayerKey } from '../../stores/mapStore';
import { useSystemStore } from '../../stores/systemStore';
import { getMapTokens, buildPhantomStyle } from './mapTokens';
import type { Bounds } from '../../services/api';

interface TacticalMapProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
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
];

export function TacticalMap({
  initialCenter,
  initialZoom = 15,
  className = '',
}: TacticalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

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
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const nets = wardrivingRecords
      .filter(
        (r) =>
          (r.ssid ?? '').toLowerCase().includes(q) ||
          r.mac.toLowerCase().includes(q)
      )
      .slice(0, 8);
    const intel = pois
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.notes ?? '').toLowerCase().includes(q)
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
      style: buildPhantomStyle(tokens) as any,
      center: resolvedInitialCenter,
      zoom: initialZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    const onLoad = () => setReady(true);
    const onMove = () => {
      const c = map.getCenter();
      setCenter([c.lat, c.lng]);
      setZoom(map.getZoom());
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
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingPoi, setPendingPoi] = useState<{ lng: number; lat: number } | null>(null);
  const [pendingName, setPendingName] = useState('');

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = computeBounds(map);
    if (layers.wardriving) loadWardriving(bounds).catch(() => {});
    if (layers.heatmap) loadHeatmap(bounds).catch(() => {});
    if (layers.intel) loadPOIs().catch(() => {});
    if (layers.recon) loadTrack(2).catch(() => {});
  }, [ready, layers.wardriving, layers.heatmap, layers.intel, layers.recon, loadWardriving, loadHeatmap, loadPOIs, loadTrack]);

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
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ background: 'var(--surface-base)' }}
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
        <MarkerCard />
      </MapContext.Provider>

      {/* Dark overlay gradient around edges */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, color-mix(in srgb, var(--surface-base) 85%, transparent) 100%)',
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
            label="Satellite"
          />
          <LateralButton
            icon={<Compass size={18} strokeWidth={1.75} />}
            label="Compass"
          />
        </div>
      </aside>

      {/* Floating search bar — top */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
        style={{ width: 440 }}
      >
        <div
          className="glass-card flex items-center gap-2 px-3"
          style={{ height: 44, borderRadius: 9999 }}
        >
          <Search size={16} strokeWidth={1.75} style={{ color: 'var(--ink-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search locations, networks, intel…"
            aria-label="Map search"
            className="flex-1 bg-transparent outline-none border-none"
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

      {/* POI confirm dialog */}
      {pendingPoi && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.45)' }}
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

      {/* Right-column HUD — compass + GPS quality */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none flex flex-col items-end gap-2">
        <CompassChip bearing={0} />
        <GpsQualityChip context={context} />
        <StatusChip loading={loading} zoom={mapRef.current?.getZoom() ?? initialZoom} />
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
  };
}

function CoordinateReadout({ context }: { context: CtxShape | null | undefined }) {
  const where = context?.where;
  const fix = !!where?.fix;
  const lat = where?.lat;
  const lon = where?.lon;
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
            background: fix ? 'var(--signal-ok)' : 'var(--signal-alert)',
            boxShadow: fix ? '0 0 6px var(--signal-ok)' : '0 0 6px var(--signal-alert)',
          }}
        />
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: fix ? 'var(--ink-primary)' : 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          {fix ? '3D fix' : 'No fix'}
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
