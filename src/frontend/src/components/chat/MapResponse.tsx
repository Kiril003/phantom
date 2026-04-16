import { useEffect, useRef } from 'react';
import maplibregl, { Map as MapLibreMap, Marker } from 'maplibre-gl';

export interface MapMarker {
  lat: number;
  lon: number;
  label?: string;
  color?: string;
}

export interface MapData {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
}

interface MapResponseProps {
  data: MapData;
}

function buildDarkStyle(backgroundColor: string) {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap',
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': backgroundColor },
      },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-opacity': 0.55,
          'raster-brightness-min': 0.0,
          'raster-brightness-max': 0.6,
          'raster-saturation': -0.7,
          'raster-contrast': 0.15,
        },
      },
    ],
  };
}

function resolveCssVar(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

export function MapResponse({ data }: MapResponseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const markers = data.markers ?? [];
    const center: [number, number] = data.center
      ? [data.center[1], data.center[0]] // API gives [lat, lon]; maplibre wants [lon, lat]
      : markers.length > 0
        ? [markers[0].lon, markers[0].lat]
        : [0, 0];

    const surfaceDeepInit = resolveCssVar('--surface-deep', '#0a0b0d');
    const map = new maplibregl.Map({
      container,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: buildDarkStyle(surfaceDeepInit) as any,
      center,
      zoom: data.zoom ?? 13,
      attributionControl: false,
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });
    mapRef.current = map;

    map.on('load', () => {
      const accent = resolveCssVar('--accent', '#7aa2f7');
      const surfaceDeep = resolveCssVar('--surface-deep', '#0a0b0d');
      const inkPrimary = resolveCssVar('--ink-primary', '#e8e9ec');
      markers.forEach((m) => {
        const el = document.createElement('div');
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.borderRadius = '50%';
        el.style.background = m.color ?? accent;
        el.style.boxShadow = `0 0 8px ${m.color ?? accent}`;
        el.style.border = `2px solid ${surfaceDeep}`;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([m.lon, m.lat])
          .addTo(map);

        if (m.label) {
          const popup = new maplibregl.Popup({
            offset: 14,
            closeButton: false,
            className: 'phantom-popup',
          }).setHTML(`<div style="font: 11px/1.3 JetBrains Mono, monospace; color: ${inkPrimary};">${escapeHTML(m.label)}</div>`);
          marker.setPopup(popup);
        }
        markersRef.current.push(marker);
      });

      // Auto-fit if multiple markers and no explicit center
      if (!data.center && markers.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        markers.forEach((m) => bounds.extend([m.lon, m.lat]));
        map.fitBounds(bounds, { padding: 32, maxZoom: 14, duration: 0 });
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-subtle)',
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: 220 }}
        role="region"
        aria-label="map"
      />
      {data.markers && data.markers.length > 0 && (
        <div
          className="px-3 py-1.5 font-mono tracking-wider flex items-center gap-2"
          style={{
            borderTop: '1px solid var(--line-subtle)',
            color: 'var(--ink-muted)',
            fontSize: 'var(--fs-micro)',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>◉</span>
          <span>{data.markers.length} MARKER{data.markers.length === 1 ? '' : 'S'}</span>
        </div>
      )}
    </div>
  );
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
