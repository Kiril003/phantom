import { create } from 'zustand';
import type { ChatMessage, ChatSession, SystemState } from '@shared/types';
import { chatApi } from '../services/api';

export interface StreamingMessage {
  id: string;
  content: string;
  done: boolean;
}

type InputMethod = 'voice' | 'text' | 'encoder';

interface ChatStoreState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  isTyping: boolean;
  loading: boolean;
  sending: boolean;
  error: string | null;

  // Setters
  setSessions: (sessions: ChatSession[]) => void;
  setCurrentSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (msg: ChatMessage) => void;
  setStreamChunk: (id: string, delta: string, done: boolean, final?: ChatMessage) => void;
  clearStreaming: () => void;
  setTyping: (v: boolean) => void;
  setError: (e: string | null) => void;

  // Async actions
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  startNewSession: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (
    content: string,
    inputMethod?: InputMethod,
    stateAtTime?: SystemState
  ) => Promise<void>;
}

function makeOptimisticUserMessage(
  content: string,
  sessionId: string,
  inputMethod: InputMethod,
  stateAtTime?: SystemState
): ChatMessage {
  return {
    id: `local-${crypto.randomUUID?.() ?? Date.now()}`,
    session_id: sessionId,
    user_id: 'self',
    role: 'user',
    content,
    response_form: 'text',
    metadata: {
      state_at_time: (stateAtTime ?? 'DIALOGUE') as SystemState,
      context_snapshot_id: '',
      ai_provider: 'gemini',
      latency_ms: 0,
      tokens_used: 0,
      tone: '',
      input_method: inputMethod,
    },
    attachments: [],
    created_at: new Date().toISOString(),
  };
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: null,
  isTyping: false,
  loading: false,
  sending: false,
  error: null,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setMessages: (messages) => set({ messages }),

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  setStreamChunk: (id, delta, done, final) =>
    set((s) => {
      if (done) {
        // Replace streaming with final message if provided, otherwise keep nothing.
        const nextMessages = final
          ? [...s.messages.filter((m) => m.id !== id), final]
          : s.messages;
        return {
          streaming: null,
          messages: nextMessages,
          isTyping: false,
        };
      }
      const current = s.streaming;
      const nextContent = current?.id === id ? current.content + delta : delta;
      return {
        streaming: { id, content: nextContent, done: false },
        isTyping: true,
      };
    }),

  clearStreaming: () => set({ streaming: null, isTyping: false }),
  setTyping: (v) => set({ isTyping: v }),
  setError: (e) => set({ error: e }),

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const resp = await chatApi.getSessions(50, 0);
      set({ sessions: resp.sessions, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load sessions',
      });
    }
  },

  loadMessages: async (sessionId: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await chatApi.getMessages(sessionId);
      set({ messages: resp.messages, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load messages',
      });
    }
  },

  openSession: async (sessionId: string) => {
    set({ currentSessionId: sessionId, messages: [], streaming: null });
    await get().loadMessages(sessionId);
  },

  startNewSession: () => {
    set({ currentSessionId: null, messages: [], streaming: null, error: null });
  },

  deleteSession: async (sessionId: string) => {
    try {
      await chatApi.deleteSession(sessionId);
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== sessionId),
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
        messages: s.currentSessionId === sessionId ? [] : s.messages,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete session' });
    }
  },

  sendMessage: async (
    content: string,
    inputMethod: InputMethod = 'text',
    stateAtTime?: SystemState
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (get().sending) return;

    const sessionId = get().currentSessionId ?? '';
    const optimistic = makeOptimisticUserMessage(trimmed, sessionId, inputMethod, stateAtTime);

    set((s) => ({
      sending: true,
      isTyping: true,
      error: null,
      messages: [...s.messages, optimistic],
    }));

    try {
      const resp = await chatApi.sendMessage({
        content: trimmed,
        input_method: inputMethod,
        session_id: sessionId || null,
      });

      // Phase 10.4 fix 3: detect whether this response introduced a NEW
      // session (first message of a fresh chat). If so, refetch sessions
      // so the sidebar shows it without a page reload.
      const sessionIsNew = !get().sessions.some((x) => x.id === resp.session_id);

      set((s) => {
        // Replace the optimistic placeholder IN PLACE with the confirmed
        // user message. Previously we rebuilt the array as
        // `[...withoutOptimistic, confirmedUser]` which, when the WS had
        // already delivered the assistant reply, shoved the user message
        // *after* its own reply — that's the "AI message appears above
        // user message" bug. In-place replacement preserves the original
        // insertion order.
        const confirmedUser: ChatMessage = { ...optimistic, session_id: resp.session_id };
        const replaced = s.messages.map((m) =>
          m.id === optimistic.id ? confirmedUser : m
        );
        const assistantAlready = replaced.some((m) => m.id === resp.message.id);
        const nextMessages = assistantAlready
          ? replaced
          : [...replaced, resp.message];
        return {
          currentSessionId: resp.session_id,
          messages: nextMessages,
          sending: false,
          isTyping: false,
          streaming: null,
        };
      });

      if (sessionIsNew) {
        // Fire-and-forget — UI already shows the new message; the sidebar
        // entry catches up a beat later. Any error is swallowed by
        // loadSessions itself (sets state.error).
        void get().loadSessions();
      }
    } catch (err) {
      // Surface AI-provider outages as actionable copy pointing to Settings.
      const maybeStatus =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: number }).status
          : 0;
      const friendly =
        maybeStatus === 503
          ? 'AI провайдер недоступний. Перевір Settings → AI → Provider'
          : err instanceof Error
            ? err.message
            : 'Failed to send message';
      set((s) => ({
        sending: false,
        isTyping: false,
        error: friendly,
        // Keep optimistic message so user sees it; no rollback.
        messages: s.messages,
      }));
    }
  },
}));
