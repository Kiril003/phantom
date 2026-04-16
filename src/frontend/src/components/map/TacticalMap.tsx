import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import {
  Layers,
  Radar,
  Wifi,
  MapPin,
  Route,
  Flame,
  Crosshair,
  Plus,
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
  /** Initial centre. Falls back to ContextEngine GPS or (50.45, 30.52). */
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

  // Derive initial center
  const resolvedInitialCenter: [number, number] =
    initialCenter ??
    (context?.where.fix && context.where.lat != null && context.where.lon != null
      ? [context.where.lon, context.where.lat]
      : [30.52, 50.45]); // Kyiv default

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
    const onClick = () => {
      // Click on empty map area closes the marker card
      select(null);
    };

    map.on('load', onLoad);
    map.on('moveend', onMove);
    map.on('click', onClick);

    return () => {
      map.off('load', onLoad);
      map.off('moveend', onMove);
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load layer data when map ready
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = computeBounds(map);

    if (layers.wardriving) loadWardriving(bounds).catch(() => {});
    if (layers.heatmap) loadHeatmap(bounds).catch(() => {});
    if (layers.intel) loadPOIs().catch(() => {});
    if (layers.recon) loadTrack(2).catch(() => {});
  }, [ready, layers.wardriving, layers.heatmap, layers.intel, layers.recon, loadWardriving, loadHeatmap, loadPOIs, loadTrack]);

  // Debounced refresh on pan/zoom
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
    await savePOI({
      lat: c.lat,
      lon: c.lng,
      name: `POI ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`,
      category: 'saved',
      notes: '',
      icon: '📍',
      is_secret: false,
    });
  }, [savePOI]);

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ background: 'var(--surface-void)' }}
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

      <LayerPanel layers={layers} onToggle={toggleLayer} />

      {/* Crosshair — centre of view */}
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 pointer-events-none"
        style={{
          transform: 'translate(-50%, -50%)',
          width: 28,
          height: 28,
          border: '1px solid var(--accent)',
          borderRadius: '50%',
          opacity: 0.25,
        }}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            transform: 'translate(-50%, -50%)',
            width: 2,
            height: 2,
            background: 'var(--accent)',
          }}
        />
      </div>

      {/* Bottom-left action cluster */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-2 z-10">
        <MapControl
          icon={<Crosshair size={18} strokeWidth={1.75} />}
          onClick={handleCenterToMe}
          disabled={!context?.where.fix}
          label="Centre on operator"
        />
        <MapControl
          icon={<Plus size={18} strokeWidth={1.75} />}
          onClick={handleAddPoi}
          label="Drop POI at centre"
          accent
        />
      </div>

      {/* Status chip */}
      <div
        className="absolute bottom-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded font-mono tracking-wider uppercase z-10"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line-default)',
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-micro)',
        }}
      >
        <span
          className="block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: loading ? 'var(--signal-warn)' : 'var(--signal-ok)',
          }}
        />
        {loading ? 'SYNC' : 'LIVE'}
      </div>

      <style>{`
        @keyframes phantom-presence-pulse {
          0%   { transform: scale(1);   opacity: 0.55; }
          50%  { transform: scale(1.6); opacity: 0;    }
          100% { transform: scale(1);   opacity: 0;    }
        }
      `}</style>
    </div>
  );
}

const LAYER_META: Array<{ key: MapLayerKey; icon: React.ReactNode; label: string }> = [
  { key: 'base',       icon: <Layers size={16} strokeWidth={1.75} />,    label: 'BASE' },
  { key: 'presence',   icon: <Radar size={16} strokeWidth={1.75} />,     label: 'PRES' },
  { key: 'wardriving', icon: <Wifi size={16} strokeWidth={1.75} />,      label: 'WARD' },
  { key: 'heatmap',    icon: <Flame size={16} strokeWidth={1.75} />,     label: 'HEAT' },
  { key: 'intel',      icon: <MapPin size={16} strokeWidth={1.75} />,    label: 'INTEL' },
  { key: 'recon',      icon: <Route size={16} strokeWidth={1.75} />,     label: 'RECON' },
];

function LayerPanel({
  layers,
  onToggle,
}: {
  layers: Record<MapLayerKey, boolean>;
  onToggle: (key: MapLayerKey) => void;
}) {
  return (
    <div
      className="absolute top-3 left-3 flex flex-col rounded z-10"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-default)',
      }}
      role="group"
      aria-label="Layer controls"
    >
      {LAYER_META.map((l) => {
        const active = layers[l.key];
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => onToggle(l.key)}
            className="flex items-center gap-2 px-3 transition-colors"
            style={{
              minWidth: 44,
              minHeight: 44,
              color: active ? 'var(--accent)' : 'var(--ink-muted)',
              background: active ? 'var(--accent-glow)' : 'transparent',
              borderBottom: '1px solid var(--line-subtle)',
              fontSize: 'var(--fs-micro)',
              fontFamily: 'var(--font-tech)',
              letterSpacing: '0.08em',
            }}
            aria-pressed={active}
            aria-label={`Toggle ${l.label} layer`}
          >
            {l.icon}
            <span>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MapControl({
  icon,
  onClick,
  disabled = false,
  label,
  accent = false,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center rounded transition-colors"
      style={{
        minWidth: 44,
        minHeight: 44,
        background: accent ? 'var(--accent)' : 'var(--surface-raised)',
        color: accent ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--line-default)'}`,
        opacity: disabled ? 0.4 : 1,
      }}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}
