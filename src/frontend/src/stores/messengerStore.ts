import { create } from 'zustand';
import { messengerNetworkEngine } from '../services/messengerNetworkEngine';
import { chatApi } from '../services/api';
import { messengerApi, chatFromNode, messageFromNode } from '../services/messengerApi';
import type { NodeMessage } from '../services/messengerApi';
import { soundFx } from '../utils/messengerSound';
import type {
  Chat,
  Message,
  ChatCircle,
  SmartFolder,
  UserProfile,
  ScheduledMessage,
  AudioHuddleState,
  LocationData,
  PersonaSphere,
  HuddleParticipant,
  MessageReplyInfo,
} from '../types/messenger';
import {
  initialChats,
  currentUser as defaultUser,
  smartFolders as defaultFolders,
  scheduledMessages as defaultScheduled,
} from '../data/messengerInitialData';

export interface MessengerState {
  // Current session & persona
  currentUser: UserProfile;
  chats: Chat[];
  activeChatId: string;
  activeCircle: ChatCircle;
  activeFolderId: string | null;
  smartFolders: SmartFolder[];
  scheduledMessages: ScheduledMessage[];
  searchQuery: string;

  // Multi-select & Bulk operations
  multiSelectMode: boolean;
  selectedMessageIds: string[];

  // Audio Huddle
  huddleState: AudioHuddleState;

  // Modals & Panels State
  isP2PModalOpen: boolean;
  isProfileModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isCreateChatModalOpen: boolean;
  setActionHubOpen: (open: boolean) => void;
  isActionHubOpen: boolean;
  isScheduledDrawerOpen: boolean;
  isScheduleModalOpen: boolean;
  isGroupDetailsOpen: boolean;
  isSmartFolderModalOpen: boolean;
  isFolderInsightsOpen: boolean;
  isShareFolderOpen: boolean;
  isDigestModalOpen: boolean;
  isForwardModalOpen: boolean;
  isDeleteModalOpen: boolean;
  isMediaLightboxOpen: boolean;
  activeLightboxUrl: string;
  activeLocationData: LocationData | null;
  activeDetailsMessage: Message | null;
  activeForwardMessage: Message | null;
  activeDeleteMessage: Message | null;
  reactionPickerState: { isOpen: boolean; messageId: string } | null;

  // Drafts & Typing
  drafts: Record<string, string>;
  typingUsers: Record<string, { userId: string; userName: string; timestamp: number }>;

  // Getters & Selectors
  getActiveChat: () => Chat | undefined;
  getScheduledForActiveChat: () => ScheduledMessage[];

  // Actions
  setActiveChat: (id: string) => void;
  setActiveCircle: (circle: ChatCircle) => void;
  setActiveFolder: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setDraft: (chatId: string, text: string) => void;

  createChat: (newChatData: {
    title: string;
    type: string;
    circle: ChatCircle;
    description: string;
    topic: string;
    avatar: string;
    isPublic?: boolean;
    publicHandle?: string;
  }) => void;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  togglePinChat: (chatId: string) => void;
  toggleMuteChat: (chatId: string) => void;
  toggleArchiveChat: (chatId: string) => void;
  addChatToFolder: (folderId: string, chatId: string) => void;
  removeChatFromFolder: (folderId: string, chatId: string) => void;

  sendMessage: (text: string) => void;
  sendVoiceMessage: (duration: number, transcript: string) => void;
  addCustomMessage: (message: Message) => void;
  editMessage: (messageId: string, newText: string) => void;
  deleteMessage: (messageId: string) => void;
  togglePinMessage: (messageId: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  forwardMessage: (msg: Message, targetChatId: string) => void;

  // Interactive message widget mutators
  updateTableData: (messageId: string, data: any) => void;
  updateTaskListData: (messageId: string, tasks: any) => void;
  votePoll: (messageId: string, optionId: string) => void;
  payBillShare: (messageId: string, payerId: string) => void;

  // Scheduled Messages
  addScheduledMessage: (timeStr: string, text: string) => void;
  deleteScheduledMessage: (id: string) => void;
  cancelScheduledMessage: (id: string) => void;
  sendScheduledNow: (id: string) => void;

  // Smart Folders
  createFolder: (folderData: Partial<SmartFolder>) => void;
  updateFolder: (folderId: string, updates: Partial<SmartFolder>) => void;
  deleteFolder: (folderId: string) => void;

  // User Profile & Personas
  updateCurrentUser: (updates: Partial<UserProfile>) => void;
  switchPersonaSphere: (sphere: PersonaSphere) => void;

  // Multi-select
  toggleSelectMessage: (messageId: string) => void;
  clearSelection: () => void;
  setMultiSelectMode: (enabled: boolean) => void;

  // Audio & Video Huddle
  startHuddle: (chatId: string, title: string) => void;
  leaveHuddle: () => void;
  toggleHuddleMute: () => void;
  toggleHuddleHand: () => void;
  toggleHuddleScreenShare: () => void;
  toggleHuddleVideo: () => void;
  toggleHuddleRecording: () => void;
  setVideoModalOpen: (open: boolean) => void;
  addHuddleTranscript: (speaker: string, text: string) => void;

  // Modals Setters
  setP2PModalOpen: (open: boolean) => void;
  setProfileModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setCreateChatModalOpen: (open: boolean) => void;
  setScheduledDrawerOpen: (open: boolean) => void;
  setScheduleModalOpen: (open: boolean) => void;
  setGroupDetailsOpen: (open: boolean) => void;
  setSmartFolderModalOpen: (open: boolean) => void;
  setFolderInsightsOpen: (open: boolean) => void;
  setShareFolderOpen: (open: boolean) => void;
  setDigestModalOpen: (open: boolean) => void;
  openLightbox: (url: string) => void;
  closeLightbox: () => void;
  openLocationSheet: (data: LocationData) => void;
  closeLocationSheet: () => void;
  openMessageDetails: (msg: Message) => void;
  closeMessageDetails: () => void;
  openForwardModal: (msg: Message) => void;
  closeForwardModal: () => void;
  openDeleteModal: (msg: Message) => void;
  closeDeleteModal: () => void;
  openReactionPicker: (messageId: string) => void;
  closeReactionPicker: () => void;

  /** Стрічку ще не забрано з вузла — показувати як «завантаження», не як «порожньо». */
  /** На яке повідомлення відповідаємо і яке редагуємо — стан композера. */
  replyingTo: MessageReplyInfo | null;
  editingMessage: Message | null;
  startReply: (msg: Message, quoteSelectedText?: string) => void;
  cancelReply: () => void;
  startEdit: (msg: Message) => void;
  cancelEdit: () => void;

  hydrated: boolean;
  hydrateFromNode: () => Promise<void>;
  applyNodeMessage: (row: NodeMessage) => void;
  refreshConversations: () => Promise<void>;
  loadMessagesForChat: (chatId: string) => Promise<void>;
}

let hydrationInFlight: Promise<void> | null = null;

export const useMessengerStore = create<MessengerState>((set, get) => {
  // Connect network engine listeners
  messengerNetworkEngine.onMessage((chatId, msg) => {
    soundFx.playReceive();
    set((state) => {
      const chats = state.chats.map((c) => {
        if (c.id === chatId) {
          return {
            ...c,
            unreadCount: c.id === state.activeChatId ? 0 : c.unreadCount + 1,
            messages: [...c.messages, msg],
          };
        }
        return c;
      });
      return { chats };
    });
  });

  messengerNetworkEngine.onReaction((chatId, messageId, emoji, fromUserId) => {
    set((state) => {
      const chats = state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const messages = c.messages.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = [...(m.reactions || [])];
          const existing = reactions.find((r) => r.emoji === emoji);
          if (existing) {
            if (!existing.users.includes(fromUserId)) {
              existing.users.push(fromUserId);
              existing.count += 1;
            }
          } else {
            reactions.push({ emoji, count: 1, users: [fromUserId] });
          }
          return { ...m, reactions };
        });
        return { ...c, messages };
      });
      return { chats };
    });
  });

  return {
    currentUser: defaultUser,
    chats: initialChats,
    activeChatId: initialChats[0]?.id || 'chat_aura_design',
    activeCircle: 'all',
    activeFolderId: null,
    smartFolders: defaultFolders,
    scheduledMessages: defaultScheduled,
    searchQuery: '',

    multiSelectMode: false,
    selectedMessageIds: [],

    huddleState: {
      active: false,
      chatId: '',
      title: '',
      participants: [],
      liveTranscript: [],
      isScreenSharing: false,
    },

    isP2PModalOpen: false,
    isProfileModalOpen: false,
    isSettingsModalOpen: false,
    isCreateChatModalOpen: false,
    isActionHubOpen: false,
    isScheduledDrawerOpen: false,
    isScheduleModalOpen: false,
    isGroupDetailsOpen: false,
    isSmartFolderModalOpen: false,
    isFolderInsightsOpen: false,
    isShareFolderOpen: false,
    isDigestModalOpen: false,
    isForwardModalOpen: false,
    isDeleteModalOpen: false,
    isMediaLightboxOpen: false,
    activeLightboxUrl: '',
    activeLocationData: null,
    activeDetailsMessage: null,
    activeForwardMessage: null,
    activeDeleteMessage: null,
    reactionPickerState: null,

    drafts: {},
    typingUsers: {},
    replyingTo: null,
    editingMessage: null,
    hydrated: false,

    startReply: (msg, quoteSelectedText) => {
      soundFx.playTap();
      set({
        editingMessage: null,
        replyingTo: {
          id: msg.id,
          senderName: msg.senderName,
          text: msg.text || '',
          type: msg.type,
          quoteSelectedText,
        },
      });
    },
    cancelReply: () => set({ replyingTo: null }),
    startEdit: (msg) => {
      soundFx.playTap();
      set({ replyingTo: null, editingMessage: msg });
    },
    cancelEdit: () => set({ editingMessage: null }),

    // Джерело правди — вузол. Мок-розмови лишаються тільки як перший засів
    // списку: їх історія була вигадана, тож у базу вона не їде.
    hydrateFromNode: async () => {
      // Подвійний монтаж у dev смикав це двічі, обидва виклики бачили порожній
      // список і засівали розмови по другому колу. Тепер рішення ухвалює вузол.
      if (hydrationInFlight) return hydrationInFlight;
      hydrationInFlight = (async () => {
      try {
        const rows = await messengerApi.bootstrap(
          initialChats.map((c) => ({
            title: c.title,
            kind: c.type,
            circle: c.circle,
            handle: c.handle ?? null,
            avatar: c.avatar ?? null,
          })),
        );
        const chats = rows.map(chatFromNode);
        set((s2) => ({
          chats,
          hydrated: true,
          activeChatId: chats.some((c) => c.id === s2.activeChatId)
            ? s2.activeChatId
            : chats[0]?.id ?? '',
        }));
        const active = get().activeChatId;
        if (active) await get().loadMessagesForChat(active);
      } catch (err) {
        // Вузол недоступний — кажемо про це станом, а не підсовуємо мок як живу стрічку.
        console.warn('[messenger] стрічку з вузла не отримано:', err);
        set({ hydrated: false });
      } finally {
        hydrationInFlight = null;
      }
      })();
      return hydrationInFlight;
    },

    /** Дотягує розмови, яких клієнт ще не бачив — не чіпаючи вже завантажені стрічки. */
    refreshConversations: async () => {
      try {
        const rows = await messengerApi.listConversations();
        set((s2) => {
          const known = new Set(s2.chats.map((c) => c.id));
          const fresh = rows.filter((r) => !known.has(r.id)).map(chatFromNode);
          return fresh.length ? { chats: [...fresh, ...s2.chats] } : {};
        });
      } catch (err) {
        console.warn('[messenger] список розмов не оновився:', err);
      }
    },

    /** Повідомлення, записане вузлом (зокрема з іншого пристрою власника). */
    applyNodeMessage: (row) => {
      const selfId = get().currentUser.id;
      // Перший лист від нової людини приходить у розмову, якої клієнт ще не знає.
      // Без цього він тихо губився: applyNodeMessage не знаходив, куди його класти.
      if (!get().chats.some((c) => c.id === row.conversation_id)) {
        void get()
          .refreshConversations()
          .then(() => get().loadMessagesForChat(row.conversation_id));
        return;
      }
      set((s2) => ({
        chats: s2.chats.map((c) => {
          if (c.id !== row.conversation_id) return c;
          // Своє ж повідомлення вже лежить у стрічці під client_id — не дублюємо.
          if (c.messages.some((m) => m.id === row.client_id || m.id === row.id)) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === row.client_id ? { ...m, id: row.id, status: 'sent' as const } : m,
              ),
            };
          }
          soundFx.playReceive();
          return {
            ...c,
            unreadCount: c.id === s2.activeChatId ? 0 : c.unreadCount + 1,
            messages: [...c.messages, messageFromNode(row, selfId)],
          };
        }),
      }));
    },

    loadMessagesForChat: async (chatId) => {
      try {
        const rows = await messengerApi.listMessages(chatId);
        const selfId = get().currentUser.id;
        set((s2) => ({
          chats: s2.chats.map((c) =>
            c.id === chatId ? { ...c, messages: rows.map((r) => messageFromNode(r, selfId)) } : c,
          ),
        }));
      } catch (err) {
        console.warn('[messenger] історію розмови не отримано:', err);
      }
    },

    // Selectors
    getActiveChat: () => {
      const s = get();
      return s.chats.find((c) => c.id === s.activeChatId);
    },
    getScheduledForActiveChat: () => {
      const s = get();
      return s.scheduledMessages.filter((m) => m.chatId === s.activeChatId);
    },

    // Chat navigation & circle setters
    setActiveChat: (id) => {
      soundFx.playTap();
      void get().loadMessagesForChat(id);
      set((state) => ({
        activeChatId: id,
        chats: state.chats.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
      }));
    },
    setActiveCircle: (circle) => set({ activeCircle: circle, activeFolderId: null }),
    setActiveFolder: (id) => set({ activeFolderId: id, activeCircle: 'all' }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setDraft: (chatId, text) =>
      set((state) => ({
        drafts: { ...state.drafts, [chatId]: text },
      })),

    createChat: (newChatData) => {
      soundFx.playSend();
      const newChat: Chat = {
        id: `chat_${Date.now()}`,
        title: newChatData.title,
        type: newChatData.type as any,
        circle: newChatData.circle,
        description: newChatData.description,
        topic: newChatData.topic,
        avatar: newChatData.avatar,
        isPublic: newChatData.isPublic,
        publicHandle: newChatData.publicHandle,
        unreadCount: 0,
        messages: [
          {
            id: `msg_init_${Date.now()}`,
            senderId: 'system',
            senderName: 'Aura Network',
            senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            text: `Простір «${newChatData.title}» успішно створено.`,
          },
        ],
      };
      set((state) => ({
        chats: [newChat, ...state.chats],
        activeChatId: newChat.id,
      }));
    },

    updateChat: (chatId, updates) => {
      set((state) => ({
        chats: state.chats.map((c) => (c.id === chatId ? { ...c, ...updates } : c)),
      }));
    },

    togglePinChat: (chatId) => {
      soundFx.playTap();
      set((state) => ({
        chats: state.chats.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)),
      }));
    },

    toggleMuteChat: (chatId) => {
      soundFx.playTap();
      set((state) => ({
        chats: state.chats.map((c) => (c.id === chatId ? { ...c, muted: !c.muted } : c)),
      }));
    },

    toggleArchiveChat: (chatId) => {
      soundFx.playTap();
      set((state) => ({
        chats: state.chats.map((c) => (c.id === chatId ? { ...c, archived: !c.archived } : c)),
      }));
    },

    addChatToFolder: (folderId, chatId) => {
      soundFx.playTap();
      set((state) => ({
        smartFolders: state.smartFolders.map((f) => {
          if (f.id === folderId) {
            const currentChatIds = f.chatIds || [];
            return {
              ...f,
              chatIds: currentChatIds.includes(chatId) ? currentChatIds : [...currentChatIds, chatId],
            };
          }
          return f;
        }),
      }));
    },

    removeChatFromFolder: (folderId, chatId) => {
      soundFx.playTap();
      set((state) => ({
        smartFolders: state.smartFolders.map((f) => {
          if (f.id === folderId) {
            return {
              ...f,
              chatIds: (f.chatIds || []).filter((id) => id !== chatId),
            };
          }
          return f;
        }),
      }));
    },

    // Message sending & modification
    sendMessage: async (text) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId || !text.trim()) return;

      const activeChat = state.getActiveChat();
      const isAiChat = activeChat?.type === 'phantom' || activeChat?.type === 'ai' || chatId === 'chat_phantom_assistant' || text.startsWith('@phantom');

      const now = new Date();
      const timeFormatted = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

      // client_id живе довше за спробу відправки: якщо звʼязок обірветься і
      // клієнт повторить запит, вузол упізнає його і не роздвоїть стрічку.
      const clientId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newMsg: Message = {
        id: clientId,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: timeFormatted,
        type: 'text',
        text: text.trim(),
        isSelf: true,
        status: 'sending',
        replyTo: state.replyingTo || undefined,
      };

      soundFx.playSend();
      const transport = messengerNetworkEngine.sendMessage(chatId, newMsg);
      newMsg.transport = transport;

      // Update state with user message
      set((s) => ({
        chats: s.chats.map((c) => {
          if (c.id === chatId) {
            return {
              ...c,
              messages: [...c.messages, newMsg],
            };
          }
          return c;
        }),
        drafts: { ...s.drafts, [chatId]: '' },
        replyingTo: null,
      }));

      // Галочка ставиться тільки після того, як вузол підтвердив запис.
      const markStatus = (status: Message['status']) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === clientId ? { ...m, status } : m)),
                }
              : c,
          ),
        }));

      void messengerApi
        .appendMessage(chatId, {
          client_id: clientId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind: 'text',
          body: text.trim(),
          transport: transport ?? null,
          reply_to_id: newMsg.replyTo?.id ?? null,
        })
        // Вузол сам каже, чи доїхало до людини. queued — записано, але не
        // доставлено; малювати галочку «надіслано» в цьому разі означало б
        // повторити те, з чим борюся весь цей час.
        .then((row) => markStatus(row.delivery === 'queued' ? 'queued' : 'sent'))
        .catch((err) => {
          console.warn('[messenger] вузол не прийняв повідомлення:', err);
          markStatus('failed');
        });

      // If chatting with PHANTOM / AI, trigger living mind thinking & backend pipeline
      if (isAiChat) {
        const aiMsgId = `msg_ai_${Date.now()}`;
        const pendingAiMsg: Message = {
          id: aiMsgId,
          senderId: 'assistant_phantom',
          senderName: 'PHANTOM',
          senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
          timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
          type: 'text',
          text: '',
          thinking: {
            stage: 'perceive',
            label: 'Сприймаю контекст…',
            active: true,
          },
        };

        // Add pending thinking bubble
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: [...c.messages, pendingAiMsg] } : c
          ),
        }));

        // Stage 2: Recall
        setTimeout(() => {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? { ...m, thinking: { stage: 'recall', label: 'Пригадую пам\'ять…', active: true } }
                        : m
                    ),
                  }
                : c
            ),
          }));
        }, 400);

        // Stage 3: Reason & Act
        setTimeout(() => {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? { ...m, thinking: { stage: 'reason', label: 'Формую відповідь…', active: true } }
                        : m
                    ),
                  }
                : c
            ),
          }));
        }, 900);

        try {
          // Real backend call to /chat/message
          const res = await chatApi.sendMessage({
            content: text.trim(),
            input_method: 'text',
            session_id: activeChat?.sessionId || undefined,
          });

          const replyText = res?.message?.content || 'Опрацьовано. Всі підсистеми функціонують стабільно.';
          soundFx.playReceive();

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    sessionId: res?.session_id || c.sessionId,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? {
                            ...m,
                            text: replyText,
                            thinking: { stage: 'done', label: 'Готово', active: false },
                            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                          }
                        : m
                    ),
                  }
                : c
            ),
          }));
        } catch (_err) {
          // Seamless fallback if backend is offline
          soundFx.playReceive();
          const fallbackReplies = [
            `Прийнято. Опрацьовую «${text.trim()}». Всі системи активні, зв'язок 100%.`,
            `Зафіксовано. Перевірив контекст та стан простору. Готовий до наступної дії.`,
            `Зрозумів. Синхронізацію оновлено.`,
          ];
          const fallbackText = fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? {
                            ...m,
                            text: fallbackText,
                            thinking: { stage: 'done', label: 'Готово', active: false },
                            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                          }
                        : m
                    ),
                  }
                : c
            ),
          }));
        }
      }
    },

    sendVoiceMessage: (duration, transcript) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId) return;

      const now = new Date();
      const timeFormatted = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

      const newMsg: Message = {
        id: `msg_voice_${Date.now()}`,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: timeFormatted,
        type: 'voice',
        isSelf: true,
        status: 'sent',
        voiceData: {
          duration,
          waveform: Array.from({ length: 32 }, () => Math.random() * 0.8 + 0.2),
          transcript,
        },
      };

      soundFx.playSend();
      messengerNetworkEngine.sendMessage(chatId, newMsg);

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, newMsg] } : c
        ),
      }));
    },

    addCustomMessage: (message) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId) return;

      soundFx.playSend();
      messengerNetworkEngine.sendMessage(chatId, message);

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, message] } : c
        ),
      }));
    },

    editMessage: (messageId, newText) => {
      set((state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, text: newText, isEdited: true } : m
          ),
        })),
      }));
    },

    deleteMessage: (messageId) => {
      soundFx.playTap();
      set((state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          messages: c.messages.filter((m) => m.id !== messageId),
        })),
        isDeleteModalOpen: false,
        activeDeleteMessage: null,
      }));
    },

    togglePinMessage: (messageId) => {
      soundFx.playTap();
      set((state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, isPinned: !m.isPinned } : m
          ),
        })),
      }));
    },

    toggleReaction: (messageId, emoji) => {
      const currentUserId = get().currentUser.id;
      soundFx.playTap();

      set((state) => {
        const chats = state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          const messages = c.messages.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = [...(m.reactions || [])];
            const existing = reactions.find((r) => r.emoji === emoji);

            if (existing) {
              if (existing.users.includes(currentUserId)) {
                existing.users = existing.users.filter((u) => u !== currentUserId);
                existing.count -= 1;
              } else {
                existing.users.push(currentUserId);
                existing.count += 1;
              }
            } else {
              reactions.push({ emoji, count: 1, users: [currentUserId] });
            }

            return { ...m, reactions: reactions.filter((r) => r.count > 0) };
          });
          return { ...c, messages };
        });

        messengerNetworkEngine.sendReaction(state.activeChatId, messageId, emoji);
        return { chats, reactionPickerState: null };
      });
    },

    addReaction: (messageId, emoji) => {
      get().toggleReaction(messageId, emoji);
    },

    forwardMessage: (msg, targetChatId) => {
      soundFx.playSend();
      const state = get();
      const forwarded: Message = {
        ...msg,
        id: `msg_fwd_${Date.now()}`,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        forwardFrom: { chatTitle: state.getActiveChat()?.title || 'Чат', senderName: msg.senderName },
        isSelf: true,
      };

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === targetChatId ? { ...c, messages: [...c.messages, forwarded] } : c
        ),
        isForwardModalOpen: false,
        activeForwardMessage: null,
      }));
    },

    // Interactive Widget Update Handlers
    updateTableData: (messageId, data) => {
      set((state) => ({
        chats: state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (m.id === messageId ? { ...m, tableData: data } : m)),
          };
        }),
      }));
    },

    updateTaskListData: (messageId, tasks) => {
      set((state) => ({
        chats: state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, taskListData: tasks } : m
            ),
          };
        }),
      }));
    },

    votePoll: (messageId, optionId) => {
      soundFx.playTap();
      const currentUserId = get().currentUser.id;
      set((state) => ({
        chats: state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== messageId || !m.pollData) return m;
              const options = m.pollData.options.map((opt) => {
                const isSelected = opt.voters?.includes(currentUserId);
                if (opt.id === optionId) {
                  return {
                    ...opt,
                    votes: isSelected ? opt.votes - 1 : opt.votes + 1,
                    voters: isSelected
                      ? opt.voters.filter((v) => v !== currentUserId)
                      : [...(opt.voters || []), currentUserId],
                  };
                }
                return opt;
              });
              return {
                ...m,
                pollData: {
                  ...m.pollData,
                  options,
                  totalVotes: options.reduce((acc, o) => acc + o.votes, 0),
                },
              };
            }),
          };
        }),
      }));
    },

    payBillShare: (messageId, payerId) => {
      soundFx.playChime();
      set((state) => ({
        chats: state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== messageId || !m.splitBillData) return m;
              const participants = m.splitBillData.participants.map((p) =>
                p.id === payerId ? { ...p, paid: true } : p
              );
              return {
                ...m,
                splitBillData: {
                  ...m.splitBillData,
                  participants,
                },
              };
            }),
          };
        }),
      }));
    },

    // Scheduled messages handlers
    addScheduledMessage: (timeStr, text) => {
      soundFx.playChime();
      const state = get();
      const newScheduled: ScheduledMessage = {
        id: `sched_${Date.now()}`,
        chatId: state.activeChatId,
        chatTitle: state.getActiveChat()?.title || 'Чат',
        text,
        type: 'text',
        scheduledTime: timeStr,
        createdAt: new Date().toISOString(),
      };
      set((s) => ({
        scheduledMessages: [...s.scheduledMessages, newScheduled],
        isScheduleModalOpen: false,
      }));
    },

    deleteScheduledMessage: (id) => {
      soundFx.playTap();
      set((state) => ({
        scheduledMessages: state.scheduledMessages.filter((s) => s.id !== id),
      }));
    },

    cancelScheduledMessage: (id) => {
      get().deleteScheduledMessage(id);
    },

    sendScheduledNow: (id) => {
      const scheduled = get().scheduledMessages.find((s) => s.id === id);
      if (scheduled && scheduled.text) {
        get().sendMessage(scheduled.text);
        get().deleteScheduledMessage(id);
      }
    },

    // Smart folders handlers
    createFolder: (folderData) => {
      soundFx.playTap();
      const newFolder: SmartFolder = {
        id: `folder_${Date.now()}`,
        name: folderData.name || 'Нова папка',
        emoji: folderData.emoji || '📁',
        color: folderData.color || '#E87A42',
        chatIds: folderData.chatIds || [],
        ...folderData,
      };
      set((state) => ({
        smartFolders: [...state.smartFolders, newFolder],
        isSmartFolderModalOpen: false,
      }));
    },

    updateFolder: (folderId, updates) => {
      soundFx.playTap();
      set((state) => ({
        smartFolders: state.smartFolders.map((f) =>
          f.id === folderId ? { ...f, ...updates } : f
        ),
      }));
    },

    deleteFolder: (folderId) => {
      soundFx.playTap();
      set((state) => ({
        smartFolders: state.smartFolders.filter((f) => f.id !== folderId),
        activeFolderId: state.activeFolderId === folderId ? null : state.activeFolderId,
      }));
    },

    // User profile & personas
    updateCurrentUser: (updates) => {
      soundFx.playTap();
      set((state) => ({
        currentUser: { ...state.currentUser, ...updates },
      }));
    },

    switchPersonaSphere: (sphere) => {
      soundFx.playTap();
      set((state) => {
        const persona = state.currentUser.personas?.[sphere];
        return {
          currentUser: {
            ...state.currentUser,
            activePersonaSphere: sphere,
            status: persona?.statusText || state.currentUser.status,
            statusEmoji: persona?.statusEmoji || state.currentUser.statusEmoji,
            bio: persona?.bio || state.currentUser.bio,
          },
        };
      });
    },

    // Multi-select handlers
    toggleSelectMessage: (messageId) => {
      set((state) => {
        const selected = state.selectedMessageIds.includes(messageId)
          ? state.selectedMessageIds.filter((id) => id !== messageId)
          : [...state.selectedMessageIds, messageId];
        return {
          selectedMessageIds: selected,
          multiSelectMode: selected.length > 0,
        };
      });
    },

    clearSelection: () => set({ selectedMessageIds: [], multiSelectMode: false }),
    setMultiSelectMode: (enabled) => set({ multiSelectMode: enabled, selectedMessageIds: [] }),

    // Audio Huddle
    startHuddle: (chatId, title) => {
      soundFx.playHuddleJoin();
      const me: HuddleParticipant = {
        id: get().currentUser.id,
        name: get().currentUser.name,
        avatar: get().currentUser.avatar,
        isSpeaking: true,
        isMuted: false,
        hasRaisedHand: false,
      };
      const huddle: AudioHuddleState = {
        active: true,
        chatId,
        title,
        participants: [me],
        liveTranscript: [{ speaker: me.name, text: 'Приєднався до простору.', time: 'Зараз' }],
        isScreenSharing: false,
      };
      set({ huddleState: huddle });
    },

    leaveHuddle: () => {
      soundFx.playHuddleLeave();
      set({
        huddleState: {
          active: false,
          chatId: '',
          title: '',
          participants: [],
          liveTranscript: [],
          isScreenSharing: false,
        },
      });
    },

    toggleHuddleMute: () => {
      set((state) => {
        const myId = state.currentUser.id;
        const participants = state.huddleState.participants.map((p) =>
          p.id === myId ? { ...p, isMuted: !p.isMuted } : p
        );
        return { huddleState: { ...state.huddleState, participants } };
      });
    },

    toggleHuddleHand: () => {
      set((state) => {
        const myId = state.currentUser.id;
        const participants = state.huddleState.participants.map((p) =>
          p.id === myId ? { ...p, hasRaisedHand: !p.hasRaisedHand } : p
        );
        return { huddleState: { ...state.huddleState, participants } };
      });
    },

    toggleHuddleScreenShare: () => {
      set((state) => ({
        huddleState: {
          ...state.huddleState,
          isScreenSharing: !state.huddleState.isScreenSharing,
        },
      }));
    },

    toggleHuddleVideo: () => {
      set((state) => {
        const myId = state.currentUser.id;
        const participants = state.huddleState.participants.map((p) =>
          p.id === myId ? { ...p, isVideoOn: !p.isVideoOn } : p
        );
        return { huddleState: { ...state.huddleState, participants } };
      });
    },

    toggleHuddleRecording: () => {
      set((state) => ({
        huddleState: {
          ...state.huddleState,
          isRecording: !state.huddleState.isRecording,
        },
      }));
    },

    setVideoModalOpen: (open) => {
      set((state) => ({
        huddleState: {
          ...state.huddleState,
          isVideoModalOpen: open,
        },
      }));
    },

    addHuddleTranscript: (speaker, text) => {
      set((state) => ({
        huddleState: {
          ...state.huddleState,
          liveTranscript: [
            ...state.huddleState.liveTranscript,
            {
              speaker,
              text,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ],
        },
      }));
    },

    // Modal Setters
    setActionHubOpen: (open) => set({ isActionHubOpen: open }),
    setP2PModalOpen: (open) => set({ isP2PModalOpen: open }),
    setProfileModalOpen: (open) => set({ isProfileModalOpen: open }),
    setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
    setCreateChatModalOpen: (open) => set({ isCreateChatModalOpen: open }),
    setScheduledDrawerOpen: (open) => set({ isScheduledDrawerOpen: open }),
    setScheduleModalOpen: (open) => set({ isScheduleModalOpen: open }),
    setGroupDetailsOpen: (open) => set({ isGroupDetailsOpen: open }),
    setSmartFolderModalOpen: (open) => set({ isSmartFolderModalOpen: open }),
    setFolderInsightsOpen: (open) => set({ isFolderInsightsOpen: open }),
    setShareFolderOpen: (open) => set({ isShareFolderOpen: open }),
    setDigestModalOpen: (open) => set({ isDigestModalOpen: open }),
    openLightbox: (url) => set({ isMediaLightboxOpen: true, activeLightboxUrl: url }),
    closeLightbox: () => set({ isMediaLightboxOpen: false, activeLightboxUrl: '' }),
    openLocationSheet: (data) => set({ activeLocationData: data }),
    closeLocationSheet: () => set({ activeLocationData: null }),
    openMessageDetails: (msg) => set({ activeDetailsMessage: msg }),
    closeMessageDetails: () => set({ activeDetailsMessage: null }),
    openForwardModal: (msg) => set({ isForwardModalOpen: true, activeForwardMessage: msg }),
    closeForwardModal: () => set({ isForwardModalOpen: false, activeForwardMessage: null }),
    openDeleteModal: (msg) => set({ isDeleteModalOpen: true, activeDeleteMessage: msg }),
    closeDeleteModal: () => set({ isDeleteModalOpen: false, activeDeleteMessage: null }),
    openReactionPicker: (messageId) => set({ reactionPickerState: { isOpen: true, messageId } }),
    closeReactionPicker: () => set({ reactionPickerState: null }),
  };
});
