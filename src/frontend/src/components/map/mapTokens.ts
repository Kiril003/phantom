import type { StyleSpecification } from 'maplibre-gl';

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

/**
 * 'satellite' is kept only so previously-persisted `ui_map_style` settings
 * values keep parsing — there is no free-for-commercial-use satellite tile
 * source, so it is no longer offered in the UI style picker/cycle. See
 * `resolveEffectiveStyle` below for the runtime fallback.
 */
export type PhantomMapStyle = 'dark' | 'satellite' | 'streets';

/**
 * OpenFreeMap vector styles — free for unlimited commercial use, self-hosted
 * planet-wide vector tiles, attribution required. Replaces the legacy raw
 * OSM raster tiles (production/commercial use forbidden under the OSMF tile
 * usage policy) and the keyless Esri World_Imagery raster source (requires
 * a paid ArcGIS license for any real deployment).
 */
const OPENFREEMAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  fiord: 'https://tiles.openfreemap.org/styles/fiord',
} as const;

let satelliteRemovedWarned = false;

/**
 * 'satellite' has no free-for-commercial-use replacement source. Resolve it
 * to 'streets' at the boundary, warning exactly once per session so callers
 * that still hold a stale persisted value degrade gracefully instead of
 * erroring.
 */
function resolveEffectiveStyle(style: PhantomMapStyle): 'dark' | 'streets' {
  if (style !== 'satellite') return style;
  if (!satelliteRemovedWarned) {
    satelliteRemovedWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[phantom-map] 'satellite' map style has been removed (no free-for-commercial-use satellite source available) — falling back to 'streets'.",
    );
  }
  return 'streets';
}

/**
 * Resolve the (style × theme) pair to a concrete OpenFreeMap style URL.
 *
 * `streets` reads the same (liberty) in every theme — the operator
 * explicitly asked for the streets look. `dark` inverts meaning per-theme,
 * mirroring the old raster presets: sunrise-warm wants a bright warm-paper
 * map (positron), cyberdeck-cold wants the cold desaturated look (fiord),
 * amber-night wants the true dark basemap (dark) so amber overlays stay the
 * focal point; any other/unknown theme falls back to positron.
 *
 * GHOST always forces the `dark`-style mapping — the washed-out look
 * itself now comes from a CSS filter TacticalMap applies to the map
 * container (see `buildPhantomStyle` callers), not from raster paint
 * tricks, since vector styles don't expose per-pixel opacity/brightness
 * paint properties the way raster tiles did.
 */
function resolveStyleUrl(style: PhantomMapStyle, theme: string): string {
  const effectiveStyle = theme === 'ghost' ? 'dark' : resolveEffectiveStyle(style);

  if (effectiveStyle === 'streets') return OPENFREEMAP_STYLES.liberty;

  switch (theme) {
    case 'cyberdeck-cold':
      return OPENFREEMAP_STYLES.fiord;
    case 'amber-night':
      return OPENFREEMAP_STYLES.dark;
    case 'sunrise-warm':
    default:
      return OPENFREEMAP_STYLES.positron;
  }
}

/**
 * Resolve `(tokens, style)` to a MapLibre style URL. MapLibre's `Map`
 * constructor and `setStyle()` both accept a URL string directly, so no
 * inline style JSON is built here anymore — OpenFreeMap styles ship their
 * own sources/layers/sprite/glyphs and already embed the required OSM
 * attribution.
 *
 * Callers that swap the style on a live map (i.e. every `setStyle()` call,
 * as opposed to the initial `new maplibregl.Map({style: ...})`) MUST pass
 * `preserveOverlayLayers` as the `transformStyle` option — see below.
 */
export function buildPhantomStyle(tokens: MapTokens, style: PhantomMapStyle = 'dark'): string {
  return resolveStyleUrl(style, tokens.theme);
}

/** Namespace shared by every overlay layer component's runtime-added source/layer ids. */
const OVERLAY_ID_PREFIX = 'phantom-';

/**
 * `transformStyle` callback for MapLibre's `setStyle(style, {transformStyle})`.
 *
 * Overlay layer components (ReconLayer, HeatmapLayer, GeofencesLayer, …)
 * add their own sources/layers directly via `map.addSource`/`addLayer` at
 * runtime — outside `buildPhantomStyle()`'s spec. MapLibre's `Style.setState`
 * diffs the *live* serialized style (which reflects those runtime
 * additions, since `Style.serialize()` walks the actual source caches, not
 * just the originally-loaded spec) against the incoming style; anything
 * runtime-added that's absent from the incoming style is torn down —
 * `{diff: true}` only avoids re-fetching tiles for sources unchanged
 * between old and new, it does NOT protect sources the new spec never
 * mentions. So every overlay source/layer would otherwise flicker out on
 * every base-style swap (theme change, style cycle, SystemState
 * transition).
 *
 * All overlay ids in this codebase are namespaced with a `phantom-` prefix
 * (see ReconLayer/HeatmapLayer/GeofencesLayer), so we carry those forward
 * here rather than blindly preserving every unknown id — that keeps stale
 * *base*-style sources (e.g. the previous OpenFreeMap style's own source,
 * which never uses this prefix) from leaking across swaps. Every base-style
 * `setStyle()` call in this codebase must pass this as `transformStyle` or
 * overlays will silently disappear.
 */
export function preserveOverlayLayers(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  if (!previous) return next;

  const carriedSources = Object.fromEntries(
    Object.entries(previous.sources ?? {}).filter(([id]) => id.startsWith(OVERLAY_ID_PREFIX)),
  );
  const carriedLayers = (previous.layers ?? []).filter((layer) =>
    layer.id.startsWith(OVERLAY_ID_PREFIX),
  );

  if (Object.keys(carriedSources).length === 0 && carriedLayers.length === 0) return next;

  return {
    ...next,
    sources: { ...next.sources, ...carriedSources },
    layers: [...(next.layers ?? []), ...carriedLayers],
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

/**
 * MapLibre штампує на кожній мітці власний `aria-label="Map marker"` — і
 * робить це ПІСЛЯ того, як забирає наш елемент, тобто затирає підпис, який
 * ми поставили до створення. Своєї локалізації бібліотека не має, тож
 * називаємо мітку самі, вже після `addTo`.
 */
export function nameMarker(marker: { getElement(): HTMLElement }, label: string): void {
  const el = marker.getElement();
  el.setAttribute('aria-label', label);
  el.setAttribute('title', label);
}
