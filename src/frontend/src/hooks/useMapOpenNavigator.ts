import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { wsClient, type WSMessage } from '../services/websocket';
import { useMapStore } from '../stores/mapStore';

interface MapWSPayload {
  op?: string;
  narrative?: string;
}

/**
 * `map.open_map` (`agent/actions/map/open_map.py`) broadcasts an
 * `op: "open_map"` mutation meaning "focus the map screen" — but the
 * only listener for the `"map"` WS channel, `useMapAgentBridge`, is
 * mounted inside `HudShell`, which only exists once `/map` is *already*
 * the active route (`OmniMap` → `HudShell`, rendered by `MapLayout`
 * from `MainRouter`'s `path="map"` route). So an `open_map` mutation
 * issued while the operator is looking at chat, settings, anything
 * else, was received by nobody — the one action whose entire job is
 * "switch to the map" could only ever fire when the map was already
 * open.
 *
 * This hook is the other half. It is mounted once, at `DashboardLayout`
 * — the layout every in-app route (`/`, `/map`, `/chat`, `/settings`,
 * ...) renders inside of — so it is alive regardless of which screen is
 * currently showing, and does exactly one thing: on `open_map`,
 * navigate to `/map`. `useMapAgentBridge` keeps its own toast-only
 * handling of `open_map` for the case where the operator is already on
 * the map screen; both firing is harmless (`navigate('/map')` while
 * already on `/map` is a no-op, and the toast text is identical either
 * way — idempotent, not doubled).
 */
export function useMapOpenNavigator(): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = wsClient.on<WSMessage>('map', (msg) => {
      const data = (msg.data ?? {}) as MapWSPayload;
      const op = data.op ?? msg.type ?? '';
      if (op !== 'open_map') return;

      const narrative = typeof data.narrative === 'string' ? data.narrative : '';
      if (narrative) {
        useMapStore.getState().setToast(narrative.slice(0, 96));
      }
      if (location.pathname !== '/map') {
        navigate('/map');
      }
    });
    return () => {
      unsubscribe();
    };
    // `location.pathname` is read fresh on every dispatch via the
    // closure — re-subscribing when it changes keeps that read current
    // without needing a ref.
  }, [navigate, location.pathname]);
}
