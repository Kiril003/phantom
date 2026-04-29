import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wsClient } from '../services/websocket';
import type { SensorMessage, StateMessage } from '../services/websocket';
import { useSystemStore } from '../stores/systemStore';
import { useOledStore, type OledFrame } from '../stores/oledStore';
import { bootstrapSettings } from '../services/settingsBootstrap';
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

function HealthPoller() {
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/health', { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          serial_enabled?: boolean;
          esp32_connected?: boolean;
        };
        if (cancelled) return;
        const status = data.serial_enabled === false
          ? 'disabled'
          : data.esp32_connected
            ? 'online'
            : 'offline';
        useSystemStore.getState().setEsp32(status);
      } catch {
        /* leave status untouched on transient failure */
      }
    };
    void tick();
    const iv = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);
  return null;
}

function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = localStorage.getItem('phantom_token');

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

    wsMountState.mounts += 1;
    if (wsMountState.pendingDisconnect) {
      clearTimeout(wsMountState.pendingDisconnect);
      wsMountState.pendingDisconnect = null;
    }
    wsClient.connect(tokenRef.current ?? undefined);

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
  }, []);

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
