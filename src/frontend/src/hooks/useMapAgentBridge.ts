import { useEffect } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';
import { useMapStore, type MapLayerKey } from '../stores/mapStore';

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
 *   - `narrate / open_map / route / snapshot / add_marker`
 *     → toast with the narrative (short, transient)
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
