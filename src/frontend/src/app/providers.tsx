import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wsClient } from '../services/websocket';
import type { WSMessage, SensorMessage, StateMessage } from '../services/websocket';
import { useSystemStore } from '../stores/systemStore';
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

interface WSContextValue {
  connected: boolean;
  send: (msg: WSMessage) => void;
}

const WSContext = createContext<WSContextValue>({
  connected: false,
  send: () => undefined,
});

export function useWS(): WSContextValue {
  return useContext(WSContext);
}

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
  const [connected, setConnected] = useState(() => wsClient.isConnected);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = localStorage.getItem('phantom_token');

    const unsubs: Array<() => void> = [];

    unsubs.push(
      wsClient.onConnect(() => {
        setConnected(true);
        useSystemStore.getState().setWsConnected(true);
      })
    );

    unsubs.push(
      wsClient.onDisconnect(() => {
        setConnected(false);
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

    wsMountState.mounts += 1;
    if (wsMountState.pendingDisconnect) {
      clearTimeout(wsMountState.pendingDisconnect);
      wsMountState.pendingDisconnect = null;
    }
    wsClient.connect(tokenRef.current ?? undefined);
    // If the socket is already open, reflect that in local state.
    if (wsClient.isConnected) setConnected(true);

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

  return (
    <WSContext.Provider value={{ connected, send: (msg) => wsClient.send(msg) }}>
      {children}
    </WSContext.Provider>
  );
}

/* ─── Root Providers ──────────────────────────────────────────────────────── */

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <HealthPoller />
        {children}
      </WebSocketProvider>
    </QueryClientProvider>
  );
}
