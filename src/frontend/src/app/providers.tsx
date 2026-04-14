import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wsClient } from '../services/websocket';
import type { WSMessage } from '../services/websocket';

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

    wsClient.onConnect(() => setConnected(true));
    wsClient.onDisconnect(() => setConnected(false));

    wsClient.connect(tokenRef.current ?? undefined);

    return () => {
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
