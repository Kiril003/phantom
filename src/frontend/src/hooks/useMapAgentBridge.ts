import { useEffect } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';
import { useMapStore, type MapLayerKey } from '../stores/mapStore';
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
 *   - `narrate / open_map / route / snapshot`
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
