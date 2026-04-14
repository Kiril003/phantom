import { create } from 'zustand';
import { ChatMessage, ChatSession } from '@shared/types';

interface StreamingMessage {
  id: string;
  content: string;
  done: boolean;
}

interface ChatStoreState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  isTyping: boolean;

  setSessions: (sessions: ChatSession[]) => void;
  setCurrentSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (msg: ChatMessage) => void;
  setStreamChunk: (id: string, delta: string, done: boolean, final?: ChatMessage) => void;
  clearStreaming: () => void;
  setTyping: (v: boolean) => void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: null,
  isTyping: false,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setMessages: (messages) => set({ messages }),

  appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  setStreamChunk: (id, delta, done, final) =>
    set((s) => {
      if (done && final) {
        return {
          streaming: null,
          messages: [...s.messages, final],
        };
      }
      const current = s.streaming;
      return {
        streaming: {
          id,
          content: current?.id === id ? current.content + delta : delta,
          done,
        },
      };
    }),

  clearStreaming: () => set({ streaming: null }),
  setTyping: (v) => set({ isTyping: v }),
}));
