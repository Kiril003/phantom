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
  /** Active theme attribute on <html> — "sunrise-warm" | "amber-night" | "cyberdeck-cold". */
  theme: string;
  /** Warm cream backdrop for the map canvas gutter (read in non-cold themes). */
  mapBackdrop: string;
}

/**
 * Resolve the active theme directly from <html data-theme=…> so non-React
 * map primitives (raster paint expressions) can branch on theme without
 * subscribing to settingsStore.
 */
function resolveTheme(): string {
  if (typeof document === 'undefined') return 'sunrise-warm';
  return document.documentElement.getAttribute('data-theme') || 'sunrise-warm';
}

export function getMapTokens(): MapTokens {
  const theme = resolveTheme();
  // The cyberdeck legacy palette wants the dark void as gutter; sunrise &
  // amber-night both want the warm cream/espresso gradient. Falling back
  // to surface-base means a fresh boot before the theme attribute is set
  // still picks the right side per token defaults.
  const fallbackAccent = 
    theme === 'ghost' ? '#16a34a' :
    theme === 'cyberdeck-cold' ? '#22d3ee' : '#b07a10';
  
  const fallbackInkPrimary = theme === 'cyberdeck-cold' || theme === 'ghost' ? '#f1f5f9' : '#1a1612';
  const fallbackInkMuted = theme === 'cyberdeck-cold' || theme === 'ghost' ? '#64748b' : '#8a7f72';
  const fallbackSurfaceDeep =
    theme === 'cyberdeck-cold' ? '#0a0f1a' : 
    theme === 'ghost' ? '#000000' : '#f5f1ea';
    
  return {
    accent: resolveCssVar('--accent', fallbackAccent),
    accentGlow: resolveCssVar(
      '--accent-glow',
      theme === 'cyberdeck-cold'
        ? 'rgba(34,211,238,0.4)' :
      theme === 'ghost'
        ? 'rgba(22,163,74,0.4)'
        : 'rgba(244,175,37,0.4)',
    ),
    surfaceVoid: resolveCssVar('--surface-void', '#000000'),
    surfaceDeep: resolveCssVar('--surface-deep', fallbackSurfaceDeep),
    surfaceRaised: resolveCssVar(
      '--surface-raised',
      theme === 'cyberdeck-cold' ? '#0f172a' : '#fdf6e9',
    ),
    inkPrimary: resolveCssVar('--ink-primary', fallbackInkPrimary),
    inkSecondary: resolveCssVar(
      '--ink-secondary',
      theme === 'cyberdeck-cold' ? '#94a3b8' : '#5b5147',
    ),
    inkMuted: resolveCssVar('--ink-muted', fallbackInkMuted),
    signalOk: resolveCssVar('--signal-ok', '#16a34a'),
    signalWarn: resolveCssVar('--signal-warn', '#f59e0b'),
    signalAlert: resolveCssVar('--signal-alert', '#ef4444'),
    signalInfo: resolveCssVar(
      '--signal-info',
      theme === 'cyberdeck-cold' ? '#22d3ee' : '#2563eb',
    ),
    lineSubtle: resolveCssVar(
      '--line-subtle',
      theme === 'cyberdeck-cold'
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(0,0,0,0.06)',
    ),
    lineDefault: resolveCssVar(
      '--line-default',
      theme === 'cyberdeck-cold'
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(0,0,0,0.10)',
    ),
    theme,
    mapBackdrop:
      theme === 'cyberdeck-cold'
        ? '#020617'
        : theme === 'amber-night'
          ? '#0e0a05'
          : '#fef6e6',
  };
}

export type PhantomMapStyle = 'dark' | 'satellite' | 'streets';

/**
 * Per-(style × theme) raster paint presets.
 *
 * The map has three "style" choices visible to the operator (`dark`,
 * `streets`, `satellite`), but the WARM theme inverts what `dark` should
 * mean. On sunrise-warm we render a luminous warm-paper print — high
 * brightness, gently boosted saturation, slight warm cast via a small
 * negative `raster-hue-rotate` toward amber. On cyberdeck-cold we keep
 * the legacy desaturated near-black look. amber-night dims tiles further
 * so amber overlays remain the focal point.
 *
 * `streets` and `satellite` stay consistent across themes (the operator
 * explicitly asked for them), but the background colour follows the
 * theme so the gutter never flashes the wrong palette.
 */
const OSM_TILES = [
  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
];

const SATELLITE_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];

interface PaintPreset {
  source: { tiles: string[]; attribution: string };
  paint: Record<string, number>;
}

function darkPresetForTheme(theme: string): PaintPreset {
  const source = { tiles: OSM_TILES, attribution: '© OpenStreetMap' };
  if (theme === 'cyberdeck-cold') {
    // Original desaturated phantom look — dark slate baseline.
    return {
      source,
      paint: {
        'raster-opacity': 0.45,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.55,
        'raster-saturation': -0.85,
        'raster-contrast': 0.2,
      },
    };
  }
  if (theme === 'amber-night') {
    // Espresso night — dim tiles, gentle warm tilt; amber roads/markers
    // become the only luminous element.
    return {
      source,
      paint: {
        'raster-opacity': 0.55,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.45,
        'raster-saturation': -0.40,
        'raster-contrast': 0.30,
        'raster-hue-rotate': -8,
      },
    };
  }
  // Default — sunrise-warm. Bright cream-paper feel with a touch of warm
  // cast so OSM neutrals read amber-friendly without obscuring labels.
  return {
    source,
    paint: {
      'raster-opacity': 0.92,
      'raster-brightness-min': 0.20,
      'raster-brightness-max': 1.0,
      'raster-saturation': 0.18,
      'raster-contrast': 0.10,
      'raster-hue-rotate': -10,
    },
  };
}

function streetsPresetForTheme(theme: string): PaintPreset {
  const source = { tiles: OSM_TILES, attribution: '© OpenStreetMap' };
  if (theme === 'amber-night') {
    return {
      source,
      paint: {
        'raster-opacity': 0.85,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.55,
        'raster-saturation': -0.20,
        'raster-contrast': 0.18,
      },
    };
  }
  return {
    source,
    paint: {
      'raster-opacity': 0.95,
      'raster-saturation': 0,
      'raster-contrast': 0,
    },
  };
}

function satellitePresetForTheme(theme: string): PaintPreset {
  const source = {
    tiles: SATELLITE_TILES,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  };
  if (theme === 'amber-night') {
    return {
      source,
      paint: {
        'raster-opacity': 0.85,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.65,
        'raster-saturation': -0.10,
        'raster-contrast': 0.12,
      },
    };
  }
  return {
    source,
    paint: {
      'raster-opacity': 0.95,
      'raster-saturation': -0.1,
      'raster-contrast': 0.0,
    },
  };
}

function ghostPreset(): PaintPreset {
  return {
    source: { tiles: OSM_TILES, attribution: '© OpenStreetMap [GHOST]' },
    paint: {
      'raster-opacity': 0.15,
      'raster-brightness-min': 0.0,
      'raster-brightness-max': 0.25,
      'raster-saturation': -1.0,
      'raster-contrast': 0.5,
    },
  };
}

function presetFor(style: PhantomMapStyle, theme: string): PaintPreset {
  // Phase 24-N — GHOST mode override.
  if (theme === 'ghost') return ghostPreset();
  
  switch (style) {
    case 'satellite':
      return satellitePresetForTheme(theme);
    case 'streets':
      return streetsPresetForTheme(theme);
    case 'dark':
    default:
      return darkPresetForTheme(theme);
  }
}

export function buildPhantomStyle(tokens: MapTokens, style: PhantomMapStyle = 'dark') {
  const preset = presetFor(style, tokens.theme);
  // Background colour matches the theme's gutter so the brief flash
  // before tiles paint never breaks the warm-cream look.
  const bgColor =
    tokens.theme === 'cyberdeck-cold' ? tokens.surfaceVoid : tokens.mapBackdrop;
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
        paint: { 'background-color': bgColor },
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
