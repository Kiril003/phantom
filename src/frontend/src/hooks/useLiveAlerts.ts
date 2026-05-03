import { useEffect, useState } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';

/**
 * Phase 24-F — subscribe to backend live-tasker alert broadcasts.
 *
 * Backend `geo.live_tasker.default_on_diff` broadcasts on the `"map"`
 * WS channel with `op: "alert", target: <layer_id>, payload:
 * { feature_collection, count }`. This hook keeps a per-layer
 * GeoJSON FeatureCollection in React state so the corresponding
 * layer component can render markers without polling REST.
 *
 * `target=null` means the broadcast carries no layer id — we ignore
 * those (they're regular HUD chatter from `narrate` mutations).
 */

export interface LiveAlertSnapshot {
  layerId: string;
  featureCollection: GeoJSON.FeatureCollection;
  count: number;
  receivedAt: number;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function useLiveAlerts(layerId: string): LiveAlertSnapshot {
  const [snapshot, setSnapshot] = useState<LiveAlertSnapshot>({
    layerId,
    featureCollection: EMPTY_FC,
    count: 0,
    receivedAt: 0,
  });

  useEffect(() => {
    const unsubscribe = wsClient.on<WSMessage>('map', (msg) => {
      const data = (msg.data ?? {}) as Record<string, unknown>;
      const op = String(data.op ?? msg.type ?? '');
      if (op !== 'alert') return;
      const target = data.target;
      if (target !== layerId) return;
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      const fcRaw = payload.feature_collection;
      const fc =
        fcRaw && typeof fcRaw === 'object' && (fcRaw as { type?: string }).type === 'FeatureCollection'
          ? (fcRaw as GeoJSON.FeatureCollection)
          : EMPTY_FC;
      const count = Number(payload.count ?? fc.features?.length ?? 0);
      setSnapshot({
        layerId,
        featureCollection: fc,
        count: Number.isFinite(count) ? count : 0,
        receivedAt: Date.now(),
      });
    });
    return () => {
      unsubscribe();
    };
  }, [layerId]);

  return snapshot;
}
