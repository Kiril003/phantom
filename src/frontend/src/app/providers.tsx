import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { wsClient } from '../services/websocket';
import type { SensorMessage, StateMessage } from '../services/websocket';
import { useSystemStore } from '../stores/systemStore';
import { useAuthStore } from '../stores/authStore';
import { useOledStore, type OledFrame } from '../stores/oledStore';
import { bootstrapSettings } from '../services/settingsBootstrap';
import { registerWsHandlers } from '../services/wsHandlers';
import { SystemState } from '@shared/types';

/* ─── QueryClient ─────────────────────────────────────────────────────────── */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

/* ─── WebSocket Context ───────────────────────────────────────────────────── */

// NOTE: WSContext / useWS hook removed (audit-2026-04-29) — no consumer
// ever imported it. The WebSocketProvider manages connection lifecycle
// internally; downstream components read wsClient directly.

/**
 * Module-level mount counter lets us survive React.StrictMode's
 * double mount/unmount without tearing down the live WebSocket.
 *
 * Under StrictMode the dev sequence is: mount → unmount → remount, all synchronous.
 * We schedule the real disconnect behind a short timeout; if a remount happens
 * inside that window the ref count stays ≥ 1 and no disconnect fires.
 */
const wsMountState = {
  mounts: 0,
  pendingDisconnect: null as ReturnType<typeof setTimeout> | null,
};

function SettingsBootstrap() {
  // Fire-and-forget: paint uses the in-file token defaults until this resolves,
  // then we update the DOM. Failures are intentional no-ops — the app is
  // usable with defaults if the backend is momentarily unreachable.
  useEffect(() => {
    void bootstrapSettings().catch(() => undefined);
  }, []);
  return null;
}

interface HealthPayload {
  serial_enabled?: boolean;
  esp32_connected?: boolean;
}

// TanStack Query owns the /health poll instead of a hand-rolled setInterval:
// it dedups, applies the shared retry/backoff, and — with the default
// refetchIntervalInBackground:false — parks the poll while the kiosk tab is
// hidden, so a backgrounded panel stops hammering the board. A transient
// failure keeps the last-good `data` (v5 preserves it across a refetch error),
// so the ESP32 status holds steady instead of flickering — same intent as the
// old `catch {}` that left status untouched.
function HealthPoller() {
  const { data } = useQuery<HealthPayload>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health', { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as HealthPayload;
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  useEffect(() => {
    if (!data) return;
    const status = data.serial_enabled === false
      ? 'disabled'
      : data.esp32_connected
        ? 'online'
        : 'offline';
    useSystemStore.getState().setEsp32(status);
  }, [data]);

  return null;
}

function WebSocketProvider({ children }: { children: React.ReactNode }) {
  // Audit fix: subscribe to the authStore token so we remount and reconnect
  // whenever the session starts/ends. The previous [] dependency array
  // left the WS unauthenticated (user=None) if the app booted to a login
  // screen, even after a successful PIN entry.
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      wsClient.onConnect(() => {
        useSystemStore.getState().setWsConnected(true);
      })
    );

    unsubs.push(
      wsClient.onDisconnect(() => {
        useSystemStore.getState().setWsConnected(false);
      })
    );

    unsubs.push(
      wsClient.on<StateMessage>('state', (msg) => {
        if (msg.type === 'transition') {
          const to = msg.data.to as SystemState;
          if (Object.values(SystemState).includes(to)) {
            useSystemStore.getState().setState(to, {
              trigger: msg.data.trigger as string,
              timestamp: msg.ts ?? Date.now(),
              auto: (msg.data.auto as boolean) ?? true,
            });
          }
        }
      })
    );

    unsubs.push(
      wsClient.on<SensorMessage>('sensor', (msg) => {
        if (msg.type === 'snapshot' && msg.data.snapshot) {
          useSystemStore.getState().setContext(msg.data.snapshot);
        }
      })
    );

    unsubs.push(
      wsClient.on('oled', (msg) => {
        if (msg.type === 'frame') {
          useOledStore.getState().setFrame(msg.data as unknown as OledFrame);
        }
      })
    );

    // Phase-5 R1-FAMILIAR-1 — register peripheral WS handlers (Familiar
    // and any future channels) through the wsHandlers barrel so this
    // file doesn't keep growing per-channel inline subscribers.
    unsubs.push(registerWsHandlers());

    wsMountState.mounts += 1;
    if (wsMountState.pendingDisconnect) {
      clearTimeout(wsMountState.pendingDisconnect);
      wsMountState.pendingDisconnect = null;
    }
    // Connect with the current token. If null, we connect unauthenticated
    // (sensors only); once authStore updates the token, this effect re-runs,
    // disconnects the old socket, and reconnects with auth.
    wsClient.connect(token ?? undefined);

    return () => {
      unsubs.forEach((u) => u());
      wsMountState.mounts -= 1;
      if (wsMountState.mounts <= 0) {
        wsMountState.mounts = 0;
        // Defer real teardown — StrictMode will re-mount within this window.
        if (wsMountState.pendingDisconnect) {
          clearTimeout(wsMountState.pendingDisconnect);
        }
        wsMountState.pendingDisconnect = setTimeout(() => {
          wsMountState.pendingDisconnect = null;
          if (wsMountState.mounts === 0) {
            wsClient.disconnect();
          }
        }, 100);
      }
    };
  }, [token]);

  return <>{children}</>;
}

/* ─── Root Providers ──────────────────────────────────────────────────────── */

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <SettingsBootstrap />
        <HealthPoller />
        {children}
      </WebSocketProvider>
    </QueryClientProvider>
  );
}
