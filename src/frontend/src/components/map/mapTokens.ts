/**
 * Resolve CSS custom properties to concrete values for non-React map primitives
 * (MapLibre DOM markers, D3, Canvas). Components must *never* hardcode colors —
 * always read through this helper so state-driven accent changes propagate.
 */
export function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const trimmed = raw.trim();
  return trimmed || fallback;
}

export interface MapTokens {
  accent: string;
  accentGlow: string;
  surfaceVoid: string;
  surfaceDeep: string;
  surfaceRaised: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  signalOk: string;
  signalWarn: string;
  signalAlert: string;
  signalInfo: string;
  lineSubtle: string;
  lineDefault: string;
}

export function getMapTokens(): MapTokens {
  return {
    accent: resolveCssVar('--accent', '#22d3ee'),
    accentGlow: resolveCssVar('--accent-glow', 'rgba(34,211,238,0.4)'),
    surfaceVoid: resolveCssVar('--surface-void', '#000000'),
    surfaceDeep: resolveCssVar('--surface-deep', '#0a0f1a'),
    surfaceRaised: resolveCssVar('--surface-raised', '#0f172a'),
    inkPrimary: resolveCssVar('--ink-primary', '#f1f5f9'),
    inkSecondary: resolveCssVar('--ink-secondary', '#94a3b8'),
    inkMuted: resolveCssVar('--ink-muted', '#64748b'),
    signalOk: resolveCssVar('--signal-ok', '#10b981'),
    signalWarn: resolveCssVar('--signal-warn', '#f59e0b'),
    signalAlert: resolveCssVar('--signal-alert', '#f43f5e'),
    signalInfo: resolveCssVar('--signal-info', '#22d3ee'),
    lineSubtle: resolveCssVar('--line-subtle', 'rgba(255,255,255,0.06)'),
    lineDefault: resolveCssVar('--line-default', 'rgba(255,255,255,0.10)'),
  };
}

export type PhantomMapStyle = 'dark' | 'satellite' | 'streets';

/**
 * Per-style raster paint presets. 'dark' is the original desaturated phantom
 * look; 'streets' is an almost-neutral OSM view; 'satellite' swaps the source
 * to ESRI world imagery and pulls the paint ops back so labels stay legible.
 */
const STYLE_PAINT: Record<
  PhantomMapStyle,
  {
    source: { tiles: string[]; attribution: string };
    paint: Record<string, number>;
  }
> = {
  dark: {
    source: {
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      attribution: '© OpenStreetMap',
    },
    paint: {
      'raster-opacity': 0.45,
      'raster-brightness-min': 0.0,
      'raster-brightness-max': 0.55,
      'raster-saturation': -0.85,
      'raster-contrast': 0.2,
    },
  },
  streets: {
    source: {
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      attribution: '© OpenStreetMap',
    },
    paint: {
      'raster-opacity': 0.95,
      'raster-saturation': 0,
      'raster-contrast': 0,
    },
  },
  satellite: {
    source: {
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution: '© Esri, Maxar, Earthstar Geographics',
    },
    paint: {
      'raster-opacity': 0.95,
      'raster-saturation': -0.1,
      'raster-contrast': 0.0,
    },
  },
};

export function buildPhantomStyle(tokens: MapTokens, style: PhantomMapStyle = 'dark') {
  const preset = STYLE_PAINT[style] ?? STYLE_PAINT.dark;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: preset.source.tiles,
        tileSize: 256,
        attribution: preset.source.attribution,
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': tokens.surfaceVoid },
      },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: preset.paint,
      },
    ],
  };
}

export const POI_COLORS: Record<string, keyof MapTokens> = {
  intel: 'signalInfo',
  threat: 'signalAlert',
  saved: 'accent',
  home: 'signalOk',
  work: 'signalWarn',
  custom: 'inkSecondary',
};

export function poiColor(tokens: MapTokens, category: string): string {
  const key = POI_COLORS[category] ?? 'inkSecondary';
  return tokens[key];
}
