import { useEffect } from 'react';
import { wsClient, type ChatStreamMessage, type WSMessage } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage } from '@shared/types';

interface ChatMessageEvent extends WSMessage {
  channel: 'chat';
  type: 'message';
  data: { message: ChatMessage; session_id: string };
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
        const { message_id, delta, done, message } = m.data;
        useChatStore.getState().setStreamChunk(message_id, delta, done, message);
        return;
      }

      if (msg.type === 'message') {
        const m = msg as ChatMessageEvent;
        const state = useChatStore.getState();
        const existing = state.messages.find((x) => x.id === m.data.message.id);
        if (!existing) {
          state.appendMessage(m.data.message);
        }
        if (state.streaming && state.streaming.id === m.data.message.id) {
          state.clearStreaming();
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
