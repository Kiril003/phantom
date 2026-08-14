import { useEffect } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';
import { useMapStore, type MapLayerKey, type PlannedRoute, type RoutePoint } from '../stores/mapStore';
import type { RouteAlternative, RouteResult } from '../services/api';
import type { MapPOI } from '@shared/types';

/**
 * Phase 24-D — desktop ↔ agent bridge over the `"map"` WebSocket
 * channel (Phase 24-B).
 *
 * Every mutating `map.*` action the agent runs hits this channel; the
 * hook subscribes once and applies known mutations to `mapStore` so
 * the renderer reacts in lock-step with the chat without polling.
 *
 * Recognised ops (others are surfaced via the toast for now):
 *   - `set_view {center: [lon, lat], zoom}` → mapStore.setCenter/setZoom
 *   - `fly_to {center, zoom}`               → same
 *   - `enable_layer {layer_id}`             → mapStore.setLayer(true)
 *   - `disable_layer {layer_id}`            → mapStore.setLayer(false)
 *   - `add_marker {id, lat, lon, name, ...}` → mapStore.appendPOI (renders
 *     immediately via IntelLayer, same as a marker the operator drew by hand)
 *   - `route {primary: RouteAlternative, ...}` (from `map.plan_route`)
 *     → mapStore.setRoute, drawn by the always-mounted `RouteLayer`. The
 *     other three actions that also emit `op: "route"`
 *     (`map.isochrone` / `map.snap_track` / `map.optimize_visit` — an area,
 *     a matched line, and a stop ordering, none shaped like a two-point
 *     route) are not yet handled here and still fall through to the toast;
 *     tracked separately, not silently claimed as done.
 *   - `narrate / open_map / snapshot`
 *     → toast with the narrative (short, transient) — `open_map` is also
 *     handled, separately, by `useMapOpenNavigator` so it works even when
 *     this hook (mounted only inside the map screen's HudShell) isn't.
 */

interface MapWSPayload {
  op?: string;
  target?: string | null;
  payload?: Record<string, unknown>;
  narrative?: string;
}

const KNOWN_LAYER_KEYS: ReadonlySet<MapLayerKey> = new Set<MapLayerKey>([
  'base',
  'presence',
  'wardriving',
  'heatmap',
  'intel',
  'recon',
  'facts',
]);

function asLayerKey(value: unknown): MapLayerKey | null {
  if (typeof value !== 'string') return null;
  return KNOWN_LAYER_KEYS.has(value as MapLayerKey) ? (value as MapLayerKey) : null;
}

function asLonLatPair(payload: Record<string, unknown> | undefined): [number, number] | null {
  if (!payload) return null;
  const center = payload.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const lon = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function asZoom(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null;
  const z = Number(payload.zoom);
  return Number.isFinite(z) ? z : null;
}

const VALID_POI_CATEGORIES: ReadonlySet<string> = new Set([
  'intel', 'threat', 'saved', 'home', 'work', 'custom',
]);

/**
 * `map.add_marker`'s mutation payload (`agent/actions/map/add_marker.py`)
 * is already exactly the fields `MapPOI` needs — this just validates and
 * narrows it. Returns null (marker dropped, nothing rendered) rather than
 * throwing on a malformed payload; the caller decides whether that's worth
 * a toast.
 */
function asMarkerPoi(payload: Record<string, unknown>): MapPOI | null {
  const { id, lat, lon, name } = payload;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;
  if (typeof name !== 'string' || !name) return null;
  const category = typeof payload.category === 'string' && VALID_POI_CATEGORIES.has(payload.category)
    ? (payload.category as MapPOI['category'])
    : 'custom';
  return {
    id: String(id),
    // Not carried on the WS payload — the hub already scoped this broadcast
    // to the owning user's own connections (`broadcast_map_mutation(...,
    // user_id=owner)` in add_marker.py), so whoever receives this message
    // is that owner. IntelLayer never reads user_id for rendering.
    user_id: 'agent',
    lat: latN,
    lon: lonN,
    name,
    category,
    notes: '',
    icon: typeof payload.icon === 'string' && payload.icon ? payload.icon : '📍',
    is_secret: payload.is_secret === true,
    created_at: typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString(),
  };
}

/**
 * `map.plan_route`'s mutation payload (`agent/actions/map/plan_route.py`)
 * is `{engine, profile, primary: RouteAlternative, alternatives_count}` —
 * a `RouteAlternative` is exactly what `PlannedRoute.result.primary` needs.
 * The three other `"route"`-emitting actions (isochrone/snap_track/
 * optimize_visit) don't have a `primary` field, so this correctly returns
 * null for them rather than misreading their payload as a route.
 *
 * `from`/`to` labels aren't on the wire (the backend never resolved place
 * names, just coordinates) — derive them from the geometry's own
 * endpoints rather than inventing text. `RouteLayer` only reads
 * `from.lat/lon` and `to.lat/lon` to place its two dot markers; the label
 * is HUD-only.
 */
function asPlannedRoute(payload: Record<string, unknown>): PlannedRoute | null {
  const primary = payload.primary as Partial<RouteAlternative> | undefined;
  const geometry = primary?.geometry as { coordinates?: unknown } | undefined;
  const coords = geometry?.coordinates;
  if (!primary || !Array.isArray(coords) || coords.length < 2) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return null;
  const from: RoutePoint = { lat: Number(first[1]), lon: Number(first[0]), label: 'Початок (агент)' };
  const to: RoutePoint = { lat: Number(last[1]), lon: Number(last[0]), label: 'Кінець (агент)' };
  if (![from.lat, from.lon, to.lat, to.lon].every(Number.isFinite)) return null;
  if (typeof primary.distance_m !== 'number' || typeof primary.duration_s !== 'number') return null;

  const result: RouteResult = {
    primary: primary as RouteAlternative,
    alternatives: [],
    profile: typeof payload.profile === 'string' ? payload.profile : 'car',
    engine: typeof payload.engine === 'string' ? payload.engine : '',
    cached: false,
    extras: {},
  };
  return { result, from, to };
}

export interface UseMapAgentBridgeOptions {
  /** Skip the WS subscription (used by tests + SSR). */
  skip?: boolean;
}

export function useMapAgentBridge(options: UseMapAgentBridgeOptions = {}): void {
  const { skip = false } = options;
  useEffect(() => {
    if (skip) return;
    const unsubscribe = wsClient.on<WSMessage>('map', (msg) => {
      const data = (msg.data ?? {}) as MapWSPayload;
      const op = data.op ?? msg.type ?? '';
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      const narrative = typeof data.narrative === 'string' ? data.narrative : '';

      const store = useMapStore.getState();
      if (op === 'set_view' || op === 'fly_to') {
        const lonlat = asLonLatPair(payload);
        if (lonlat) {
          store.setCenter([lonlat[0], lonlat[1]]);
        }
        const zoom = asZoom(payload);
        if (zoom !== null) {
          store.setZoom(zoom);
        }
      } else if (op === 'enable_layer') {
        const key = asLayerKey(payload.layer_id);
        if (key) store.setLayer(key, true);
      } else if (op === 'disable_layer') {
        const key = asLayerKey(payload.layer_id);
        if (key) store.setLayer(key, false);
      } else if (op === 'time_travel') {
        const iso = payload.iso_date;
        if (typeof iso === 'string') {
          store.setTemporalDate(iso);
        }
      } else if (op === 'add_marker') {
        const poi = asMarkerPoi(payload);
        if (poi) store.appendPOI(poi);
      } else if (op === 'route') {
        const route = asPlannedRoute(payload);
        if (route) store.setRoute(route);
      }

      if (narrative) {
        store.setToast(narrative.slice(0, 96));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [skip]);
}
