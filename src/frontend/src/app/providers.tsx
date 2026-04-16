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

function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = localStorage.getItem('phantom_token');

    const unsubs: Array<() => void> = [];

    unsubs.push(wsClient.onConnect(() => {
      setConnected(true);
      useSystemStore.getState().setWsConnected(true);
    }));

    unsubs.push(wsClient.onDisconnect(() => {
      setConnected(false);
      useSystemStore.getState().setWsConnected(false);
    }));

    // State transitions from backend
    unsubs.push(wsClient.on<StateMessage>('state', (msg) => {
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
    }));

    // Context snapshots from backend
    unsubs.push(wsClient.on<SensorMessage>('sensor', (msg) => {
      if (msg.type === 'snapshot' && msg.data.snapshot) {
        useSystemStore.getState().setContext(msg.data.snapshot);
      }
    }));

    wsClient.connect(tokenRef.current ?? undefined);

    return () => {
      unsubs.forEach((u) => u());
      wsClient.disconnect();
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
      <WebSocketProvider>{children}</WebSocketProvider>
    </QueryClientProvider>
  );
}
