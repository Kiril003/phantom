import { useEffect } from 'react';
import { wsClient, type ChatStreamMessage, type WSMessage } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage } from '@shared/types';

interface ChatMessageEvent extends WSMessage {
  channel: 'chat';
  type: 'message';
  data: { message: ChatMessage; session_id: string };
}

interface ChatProactiveEvent extends WSMessage {
  channel: 'chat';
  type: 'message.proactive';
  data: {
    message: ChatMessage;
    session_id: string;
    origin: 'proactive';
    priority?: string;
  };
}

/**
 * Subscribes to the chat WebSocket channel for both streaming deltas
 * and final message broadcasts. Call once (e.g. in ChatWindow).
 */
export function useChatStream(): void {
  useEffect(() => {
    const off = wsClient.on<WSMessage>('chat', (msg) => {
      if (msg.type === 'stream') {
        const m = msg as ChatStreamMessage;
        const { message_id, delta, done, message, session_id } = m.data;
        const state = useChatStore.getState();
        
        if (!state.currentSessionId && session_id) {
          state.setCurrentSession(session_id);
        }

        if (!session_id || session_id === state.currentSessionId) {
          useChatStore.getState().setStreamChunk(message_id, delta, done, message);
        }
        return;
      }

      if (msg.type === 'message') {
        const m = msg as ChatMessageEvent;
        const state = useChatStore.getState();
        if (m.data.session_id === state.currentSessionId) {
          const existing = state.messages.find((x) => x.id === m.data.message.id);
          if (!existing) {
            state.appendMessage(m.data.message);
          }
          if (state.streaming && state.streaming.id === m.data.message.id) {
            state.clearStreaming();
          }
        }
      }

      // Proactive bubbles (`agent/proactive.py:652`) arrive with the same
      // payload shape as a regular message plus `origin: 'proactive'`.
      // Pre-fix the switch only handled `'message'` so the bubble never
      // landed in chat — closes audit-2026-04-29-day5-holes B-19.
      if (msg.type === 'message.proactive') {
        const m = msg as ChatProactiveEvent;
        const state = useChatStore.getState();
        if (m.data.session_id === state.currentSessionId) {
          const existing = state.messages.find((x) => x.id === m.data.message.id);
          if (!existing) {
            state.appendMessage(m.data.message);
          }
        }
      }

      if (msg.type === 'typing') {
        const typing = Boolean((msg.data as { typing?: boolean }).typing);
        useChatStore.getState().setTyping(typing);
      }
    });

    return off;
  }, []);
}
