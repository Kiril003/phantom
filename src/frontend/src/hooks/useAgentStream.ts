import { useEffect } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';
import { useAgentStore } from '../stores/agentStore';
import type { AgentEvent, AgentEventType } from '@shared/types';

/**
 * Subscribe to the `agent.stream` WS channel and route every event into the
 * agent store. Auto-reconnect comes for free from wsClient — we only need to
 * surface the connection state.
 */
export function useAgentStream(): void {
  const handleEvent = useAgentStore((s) => s.handleEvent);
  const setWSConnected = useAgentStore((s) => s.setWSConnected);

  useEffect(() => {
    const offChannel = wsClient.on('agent.stream', (msg: WSMessage) => {
      const event: AgentEvent = {
        type: msg.type as AgentEventType,
        ts: msg.ts ?? Date.now(),
        payload: (msg.data ?? {}) as Record<string, unknown>,
      };
      handleEvent(event);
    });
    const offConnect = wsClient.onConnect(() => setWSConnected(true));
    const offDisconnect = wsClient.onDisconnect(() => setWSConnected(false));

    setWSConnected(wsClient.isConnected);

    return () => {
      offChannel();
      offConnect();
      offDisconnect();
    };
  }, [handleEvent, setWSConnected]);
}
