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
    accent: resolveCssVar('--accent', '#4fc3f7'),
    accentGlow: resolveCssVar('--accent-glow', 'rgba(79,195,247,0.4)'),
    surfaceVoid: resolveCssVar('--surface-void', '#000000'),
    surfaceDeep: resolveCssVar('--surface-deep', '#0a0b0d'),
    surfaceRaised: resolveCssVar('--surface-raised', '#14161a'),
    inkPrimary: resolveCssVar('--ink-primary', '#e8e9ec'),
    inkSecondary: resolveCssVar('--ink-secondary', '#8b8f98'),
    inkMuted: resolveCssVar('--ink-muted', '#4a4d54'),
    signalOk: resolveCssVar('--signal-ok', '#7ee787'),
    signalWarn: resolveCssVar('--signal-warn', '#f0b72f'),
    signalAlert: resolveCssVar('--signal-alert', '#ff6b6b'),
    signalInfo: resolveCssVar('--signal-info', '#7aa2f7'),
    lineSubtle: resolveCssVar('--line-subtle', 'rgba(255,255,255,0.06)'),
    lineDefault: resolveCssVar('--line-default', 'rgba(255,255,255,0.12)'),
  };
}

export function buildPhantomStyle(tokens: MapTokens) {
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
        paint: { 'background-color': tokens.surfaceVoid },
      },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-opacity': 0.45,
          'raster-brightness-min': 0.0,
          'raster-brightness-max': 0.55,
          'raster-saturation': -0.85,
          'raster-contrast': 0.2,
        },
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
