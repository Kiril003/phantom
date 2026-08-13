import { create } from 'zustand';
import { type ChatMessage, type ChatSession, SystemState } from '@shared/types';
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
  // Phase 13b — text rendered as a "ghost" user bubble while the always-on
  // mic is mid-utterance. Updated by the partial-transcript stream and
  // cleared once the message is committed via sendMessage.
  userPreview: string | null;
  sendingSessionIds: Record<string, boolean>;
  /** Останній невдалий надсил — щоб «Повторити» не вимагав передруковувати. */
  lastFailedSend: { content: string; inputMethod: InputMethod; stateAtTime?: SystemState } | null;


  // Setters
  setSessions: (sessions: ChatSession[]) => void;
  setCurrentSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (msg: ChatMessage) => void;
  setStreamChunk: (id: string, delta: string, done: boolean, final?: ChatMessage) => void;
  clearStreaming: () => void;
  setTyping: (v: boolean) => void;
  setError: (e: string | null) => void;
  setUserPreview: (content: string | null) => void;
  // Phase 13b — used by ``final_revised`` to swap a Whisper-quality
  // transcript into the most recent user message in place. No-op when
  // there are no user messages yet.
  replaceLastUserMessage: (content: string, extraMetadata?: Record<string, unknown>) => void;

  // Async actions
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  startNewSession: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSession: (sessionId: string, summary: string) => Promise<void>;
  sendMessage: (
    content: string,
    inputMethod?: InputMethod,
    stateAtTime?: SystemState
  ) => Promise<void>;
  retryLastSend: () => Promise<void>;
  consumeAgentSeed: (seed: import('../services/agentApi').AgentResumeAsConversationResponse) => void;
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
      state_at_time: stateAtTime ?? SystemState.DIALOGUE,
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
  lastFailedSend: null,
  userPreview: null,
  sendingSessionIds: {},


  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setMessages: (messages) => set({ messages }),
  setUserPreview: (content) => set({ userPreview: content }),
  replaceLastUserMessage: (content, extraMetadata) =>
    set((s) => {
      const idx = (() => {
        for (let i = s.messages.length - 1; i >= 0; i--) {
          if (s.messages[i].role === 'user') return i;
        }
        return -1;
      })();
      if (idx < 0) return s;
      const prev = s.messages[idx];
      const updated: ChatMessage = {
        ...prev,
        content,
        metadata: extraMetadata
          ? { ...prev.metadata, ...extraMetadata }
          : prev.metadata,
      };
      const nextMessages = s.messages.slice();
      nextMessages[idx] = updated;
      return { messages: nextMessages };
    }),

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
        error: err instanceof Error ? err.message : 'Не вдалося завантажити розмови.',
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
        error: err instanceof Error ? err.message : 'Не вдалося завантажити повідомлення.',
      });
    }
  },

  openSession: async (sessionId: string) => {
    set((s) => {
      const activeSending = !!s.sendingSessionIds[sessionId];
      return {
        currentSessionId: sessionId,
        messages: [],
        streaming: null,
        sending: activeSending,
        isTyping: activeSending,
      };
    });
    await get().loadMessages(sessionId);
  },

  startNewSession: () => {
    set((s) => {
      const activeSending = !!s.sendingSessionIds[''];
      return {
        currentSessionId: null,
        messages: [],
        streaming: null,
        error: null,
        sending: activeSending,
        isTyping: activeSending,
      };
    });
  },


  deleteSession: async (sessionId: string) => {
    try {
      await chatApi.deleteSession(sessionId);
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== sessionId),
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
        messages: s.currentSessionId === sessionId ? [] : s.messages,
      }));
      // Phase 10.4 fix 2: defensive re-sync from server so optimistic
      // filter can't drift out of step with DB state.
      void get().loadSessions();
    } catch (err) {
      // Phase 10.4 fix 2: actionable error copy. Most delete failures in
      // practice have been silent 401s (expired JWT); mention re-auth.
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: number }).status
          : 0;
      const friendly =
        status === 401
          ? 'Сесія авторизації завершилась — увійди знову.'
          : err instanceof Error
            ? `Не вдалось видалити сесію: ${err.message}`
            : 'Не вдалось видалити сесію.';
      set({ error: friendly });
    }
  },

  updateSession: async (sessionId: string, summary: string) => {
    // Optimistic update
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, summary } : x)),
    }));
    try {
      await chatApi.updateSession(sessionId, { summary });
    } catch (err) {
      set({ error: 'Не вдалося перейменувати розмову.' });
      void get().loadSessions(); // rollback
    }
  },

  sendMessage: async (
    content: string,
    inputMethod: InputMethod = 'text',
    stateAtTime?: SystemState
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const sessionId = get().currentSessionId ?? '';
    if (get().sendingSessionIds[sessionId]) return;

    const optimistic = makeOptimisticUserMessage(trimmed, sessionId, inputMethod, stateAtTime);

    set((s) => ({
      sendingSessionIds: { ...s.sendingSessionIds, [sessionId]: true },
      sending: true,
      isTyping: true,
      error: null,
      messages: [...s.messages, optimistic],
      // Phase 13b — committed message has landed; ghost preview must clear
      // so the chat list does not render the same text twice (real bubble
      // + ghost).
      userPreview: null,
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

      const nowActiveSessionId = get().currentSessionId;
      const isStillOnSameSession =
        nowActiveSessionId === sessionId ||
        (sessionId === '' && nowActiveSessionId === resp.session_id);

      set((s) => {
        const nextSendingSessionIds = { ...s.sendingSessionIds };
        delete nextSendingSessionIds[sessionId];
        if (sessionId === '' && resp.session_id) {
          delete nextSendingSessionIds[resp.session_id];
        }

        const activeSending = s.currentSessionId ? !!nextSendingSessionIds[s.currentSessionId] : !!nextSendingSessionIds[''];

        if (!isStillOnSameSession) {
          return {
            sendingSessionIds: nextSendingSessionIds,
            sending: activeSending,
            isTyping: activeSending,
            streaming: null,
          };
        }

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
          sendingSessionIds: nextSendingSessionIds,
          sending: activeSending,
          isTyping: activeSending,
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
      // 503 приходить, коли впав увесь ланцюг провайдерів. Тут раніше
      // стояло «Перевір Settings → AI → Головний провайдер»: англійський
      // шлях у українському рядку, та ще й вимога налаштувати провайдера —
      // прямо проти правила нуль-конфігу. Пропонуємо повтор.
      const maybeStatus =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: number }).status
          : 0;
      const friendly =
        maybeStatus === 503
          ? 'Модель не відповіла. Зв’язок або сама модель зараз недоступні.'
          : err instanceof Error
            ? err.message
            : 'Не вдалося надіслати повідомлення.';
      set((s) => {
        const nextSendingSessionIds = { ...s.sendingSessionIds };
        delete nextSendingSessionIds[sessionId];
        const activeSending = s.currentSessionId ? !!nextSendingSessionIds[s.currentSessionId] : !!nextSendingSessionIds[''];
        return {
          sendingSessionIds: nextSendingSessionIds,
          sending: activeSending,
          isTyping: activeSending,
          error: friendly,
          lastFailedSend: { content: trimmed, inputMethod, stateAtTime },
          // Keep optimistic message so user sees it; no rollback.
          messages: s.messages,
        };
      });
    }
  },

  retryLastSend: async () => {
    const failed = get().lastFailedSend;
    if (!failed) return;
    // Оптимістична бульбашка з невдалої спроби вже висить у стрічці —
    // прибираємо її, щоб повтор не подвоїв те саме питання.
    set((s) => {
      const idx = [...s.messages]
        .map((m, i) => ({ m, i }))
        .reverse()
        .find(({ m }) => m.role === 'user' && m.content === failed.content)?.i;
      return {
        error: null,
        lastFailedSend: null,
        messages: idx == null ? s.messages : s.messages.filter((_, i) => i !== idx),
      };
    });
    await get().sendMessage(failed.content, failed.inputMethod, failed.stateAtTime);
  },

  consumeAgentSeed: (seed) => {
    // Phase 16 — landed from a 'Continue as Conversation' click.
    // We create a "virtual" session (or target a new one) and seed the messages.
    // Note: the backend actually creates the session on /resume-as-conversation,
    // so we just need to switch to it and load its summary/messages.
    set({
      currentSessionId: seed.task_id, // Usually matches taskId for simplicity in BE
      messages: [
        {
          id: `seed-${seed.task_id}`,
          session_id: seed.task_id,
          user_id: 'assistant',
          role: 'assistant',
          content: seed.seed_summary,
          response_form: 'text',
          metadata: {
            state_at_time: SystemState.DIALOGUE,
            context_snapshot_id: '',
            ai_provider: 'gemini',
            latency_ms: 0,
            tokens_used: 0,
            tone: 'informative',
            input_method: 'encoder'
          },
          attachments: [],
          created_at: new Date().toISOString()
        }
      ],
      sending: false,
      isTyping: false
    });
    // Refresh the sidebar so the seeded session appears.
    void get().loadSessions();
  }
}));
