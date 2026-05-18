import { useEffect } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';
import { useAgentStore } from '../stores/agentStore';
import { useMissionStore } from '../stores/missionStore';
import { useSystemStore } from '../stores/systemStore';
import { agentApi } from '../services/agentApi';
import type { AgentEvent, AgentEventType } from '@shared/types';

/**
 * Subscribe to the `agent.stream` WS channel and route every event into the
 * agent and mission stores. Auto-reconnect comes for free from wsClient —
 * we only need to surface the connection state.
 */
export function useAgentStream(): void {
  const handleAgentEvent = useAgentStore((s) => s.handleEvent);
  const handleMissionEvent = useMissionStore((s) => s.handleEvent);
  const setWSConnected = useAgentStore((s) => s.setWSConnected);

  useEffect(() => {
    // Initial sync in case a task is already running when we mount.
    agentApi.status().then((st) => {
      if (st.foreground.active && st.foreground.task_id) {
        useAgentStore.getState().refreshTask(st.foreground.task_id);
      }
    }).catch((err) => {
      console.debug('[AgentStream] Failed to fetch initial status:', err);
    });

    const offChannel = wsClient.on('agent.stream', (msg: WSMessage) => {
      const event: AgentEvent = {
        type: msg.type as AgentEventType,
        ts: msg.ts ?? Date.now(),
        payload: (msg.data ?? {}) as Record<string, unknown>,
      };
      handleAgentEvent(event);
      handleMissionEvent(event);
    });

    const offMonologue = wsClient.on('inner_monologue.stream', (msg: WSMessage) => {
      // Phase 14 — extract endocrine state from monologue events
      if (msg.type === 'emotion_shift' || msg.type === 'reflection') {
        const endocrine = (msg.data as any)?.endocrine || (msg.data as any)?.state;
        if (endocrine && typeof endocrine === 'object') {
          useSystemStore.getState().setSentience({
            cortisol: endocrine.cortisol ?? 0.2,
            dopamine: endocrine.dopamine ?? 0.5,
            oxytocin: endocrine.oxytocin ?? 0.5
          });
        }
      }
    });

    const offConnect = wsClient.onConnect(() => setWSConnected(true));
    const offDisconnect = wsClient.onDisconnect(() => setWSConnected(false));

    setWSConnected(wsClient.isConnected);

    return () => {
      offChannel();
      offMonologue();
      offConnect();
      offDisconnect();
    };
  }, [handleAgentEvent, handleMissionEvent, setWSConnected]);
}
