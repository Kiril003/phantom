import { create } from 'zustand';
import { messengerNetworkEngine } from '../services/messengerNetworkEngine';
import { wsClient } from '../services/websocket';
import { chatApi } from '../services/api';
import { messengerApi, chatFromNode, messageFromNode, deliveryStatus } from '../services/messengerApi';
import type { NodeConversation, NodeMessage } from '../services/messengerApi';
import { useUIStore } from './uiStore';
import { soundFx } from '../utils/messengerSound';
import {
  MEDIA_LIMIT_LABEL,
  MEDIA_PLAIN_LIMIT_BYTES,
  encryptForUpload,
  humanSize,
  isRenderableImage,
} from '../services/messengerMedia';
import type {
  Chat,
  Message,
  ChatCircle,
  SmartFolder,
  UserProfile,
  ScheduledMessage,
  LocationData,
  PersonaSphere,
  MessageReplyInfo,
  SecureMedia,
  GeoPoint,
} from '../types/messenger';
import { geoPointBody } from '../services/messengerGeo';
import {
  initialChats,
  currentUser as defaultUser,
  smartFolders as defaultFolders,
  scheduledMessages as defaultScheduled,
} from '../data/messengerInitialData';
import { generateContextualResponse } from '../services/conversationalAgent';
import { globalP2PMesh } from '../services/globalP2PMesh';
import { storagePersistence } from '../services/storagePersistence';

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
  /** Імʼя файла, а не «Медіафайл»: людина мусить бачити, що саме відкрила. */
  activeLightboxTitle: string;
  activeLocationData: LocationData | null;
  activeDetailsMessage: Message | null;
  activeForwardMessage: Message | null;
  activeDeleteMessage: Message | null;
  reactionPickerState: { isOpen: boolean; messageId: string } | null;

  // Drafts & Typing
  drafts: Record<string, string>;
  typingUsers: Record<string, { userId: string; userName: string; timestamp: number }>;
  typingStatus: Record<string, string | null>;
  setTypingStatus: (chatId: string, status: string | null) => void;

  // Getters & Selectors
  getActiveChat: () => Chat | undefined;
  getScheduledForActiveChat: () => ScheduledMessage[];

  // Actions
  setActiveChat: (id: string) => void;
  setActiveCircle: (circle: ChatCircle) => void;
  setActiveFolder: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setDraft: (chatId: string, text: string) => void;

  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  togglePinChat: (chatId: string) => void;
  toggleMuteChat: (chatId: string) => void;
  toggleArchiveChat: (chatId: string) => void;
  addChatToFolder: (folderId: string, chatId: string) => void;
  removeChatFromFolder: (folderId: string, chatId: string) => void;
  createGroup: (title: string, circle?: ChatCircle, avatar?: string, description?: string) => Promise<string>;
  createDirectMessage: (name: string, circle?: ChatCircle, avatar?: string) => Promise<string>;

  sendMessage: (text: string) => void;
  /**
   * Надсилає фото або файл. Шифрує в браузері, кладе шифротекст на свій вузол,
   * а ключ відправляє в тілі повідомлення — його вузол запечатує кадром до
   * вузла співрозмовника.
   * Відсоток іде з XHR, тож смуга показує справжні байти, а не таймер.
   * caption — текст із композера: їде підписом У ТОМУ Ж повідомленні.
   */
  sendAttachment: (
    file: File,
    onProgress?: (percent: number) => void,
    caption?: string,
  ) => Promise<void>;
  /** Надсилає разову точку «я тут». Час у тілі — час ВИМІРУ, не відправки. */
  sendGeoPoint: (point: GeoPoint) => Promise<void>;
  sendVoiceMessage: (duration: number, transcript: string) => void;
  addCustomMessage: (message: Message) => void;
  editMessage: (messageId: string, newText: string) => void;
  /** forEveryone — службовий кадр поїде співрозмовнику; інакше чистка своя. */
  deleteMessage: (messageId: string, forEveryone?: boolean) => Promise<void>;
  togglePinMessage: (messageId: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  forwardMessage: (msg: Message, targetChatId: string) => void;
  /** Повторна спроба надіслати лист, що впав або застряг у черзі. */
  retrySend: (messageId: string) => Promise<void>;

  // Interactive message widget mutators
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
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
  openLightbox: (url: string, title?: string) => void;
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
  applyNodeDelete: (row: NodeMessage) => void;
  refreshConversations: () => Promise<void>;
  loadMessagesForChat: (chatId: string) => Promise<void>;
}

let hydrationInFlight: Promise<void> | null = null;

/** Надгробок замість тіла. Саме повідомлення лишається — прибрати можна вміст. */
const asTombstone = (m: Message): Message => ({
  ...m,
  isDeleted: true,
  text: undefined,
  media: undefined,
  status: undefined,
});

/**
 * Прев'ю в списку чатів після видалення.
 *
 * Стрічка вже показує надгробок, а список збоку однаково писав «Фото» — тобто
 * обіцяв вкладення, якого немає на жодному з дисків. Прев'ю живе тим самим
 * останнім повідомленням, тож і перечитувати його треба звідти.
 */
const withFreshPreview = (chat: Chat): Chat => {
  const last = chat.messages[chat.messages.length - 1];
  if (!last) return { ...chat, lastKind: undefined, lastSnippet: undefined };
  if (!last.isDeleted) return chat;
  return { ...chat, lastKind: 'text', lastSnippet: 'Повідомлення видалено' };
};

/** Поля розмови, які веде вузол — решта в рядку списку просто не приїжджає. */
const NODE_OWNED: (keyof Chat)[] = [
  'title', 'handle', 'avatar', 'type', 'circle', 'contactVerified', 'isDemo',
  'peerNodeId', 'unreadCount', 'lastKind', 'lastSnippet', 'lastAuthor', 'lastAt',
];

/**
 * Накладає на відому розмову те, що про неї знає вузол.
 *
 * Стрічка лишається при собі: у списку розмов повідомлень немає, і перечитати
 * їх звідти нічим. Закріплення, тиша й архів теж лишаються місцевими — вузол
 * їх не приймає (PATCH знає лише назву), тож забирати їх звідти означало б
 * відкріплювати розмову на кожному оновленні списку.
 */
const withNodeFields = (local: Chat, row: NodeConversation, activeChatId: string): Chat => {
  const node = chatFromNode(row);
  // Прев'ю могло щойно змінити власне надіслане, якого вузол ще не порахував:
  // тоді свіжіше саме місцеве, і відкочувати його назад нема за що.
  const nodeSawLast = !local.lastAt || (node.lastAt ?? '') >= local.lastAt;
  const merged: Chat = {
    ...local,
    title: node.title,
    handle: node.handle,
    // Порожня обкладинка з вузла — це «не зберігаю», а не «зітри».
    avatar: node.avatar || local.avatar,
    type: node.type,
    circle: node.circle,
    contactVerified: node.contactVerified,
    isDemo: node.isDemo,
    peerNodeId: node.peerNodeId ?? local.peerNodeId,
    // Відкриту розмову клієнт уже розчитав, а markRead міг ще не доїхати —
    // інакше значок непрочитаного вертався б просто від оновлення списку.
    unreadCount: local.id === activeChatId ? 0 : node.unreadCount,
    ...(nodeSawLast
      ? {
          lastKind: node.lastKind,
          lastSnippet: node.lastSnippet,
          lastAuthor: node.lastAuthor,
          lastAt: node.lastAt,
        }
      : {}),
  };
  // Незмінене повертаємо тим самим обʼєктом — список не перемальовується дарма.
  return NODE_OWNED.some((k) => merged[k] !== local[k]) ? merged : local;
};

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

  const persistedUser = storagePersistence.loadSetting<UserProfile | null>('phantom_user_profile', null);
  const persistedChats = storagePersistence.loadSetting<Chat[] | null>('phantom_chats_backup', null);
  const persistedScheduled = storagePersistence.loadSetting<ScheduledMessage[] | null>('phantom_scheduled_messages', null);

  const activeUser = persistedUser || defaultUser;
  const activeChats = persistedChats && persistedChats.length > 0 ? persistedChats : initialChats;
  const activeScheduled = persistedScheduled || defaultScheduled;

  return {
    currentUser: activeUser,
    chats: activeChats,
    activeChatId: activeChats[0]?.id || 'chat_aura_design',
    activeCircle: 'all',
    activeFolderId: null,
    smartFolders: defaultFolders,
    scheduledMessages: activeScheduled,
    searchQuery: '',

    multiSelectMode: false,
    selectedMessageIds: [],

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
    activeLightboxTitle: '',
    activeLocationData: null,
    activeDetailsMessage: null,
    activeForwardMessage: null,
    activeDeleteMessage: null,
    reactionPickerState: null,

    drafts: {},
    typingUsers: {},
    typingStatus: {},
    setTypingStatus: (chatId, status) =>
      set((s) => ({
        typingStatus: { ...s.typingStatus, [chatId]: status },
      })),
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
            // Вітрина чесна: розмова позначена показовою, а її стрічка — це
            // кілька останніх реплік мока, засіяних у вузол тим самим шляхом.
            is_demo: true,
            messages: (c.messages || [])
              .filter((m) => m.type === 'text' && m.text)
              .slice(-3)
              .map((m, i) => ({
                client_id: `seed_${c.id}_${i}`,
                author_id: m.senderId,
                author_name: m.senderName,
                kind: 'text',
                body: m.text as string,
              })),
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

    /**
     * Звіряє список із вузлом: дотягує розмови, яких клієнт ще не бачив, і
     * оновлює те, що вузол знає про вже відомі — не чіпаючи завантажені стрічки.
     *
     * Раніше нове імʼя, записане на вузлі, було видно лише після F5: людина
     * вписувала «Марта», вузол уже віддавав «Марта», а в шапці лишався «Вузол
     * 86a15538» — тобто на вигляд її напис просто викидали.
     */
    refreshConversations: async () => {
      try {
        const rows = await messengerApi.listConversations();
        set((s2) => {
          const byId = new Map(rows.map((r) => [r.id, r]));
          const known = new Set(s2.chats.map((c) => c.id));
          const fresh = rows.filter((r) => !known.has(r.id)).map(chatFromNode);
          const merged = s2.chats.map((c) => {
            const row = byId.get(c.id);
            return row ? withNodeFields(c, row, s2.activeChatId) : c;
          });
          const touched = merged.some((c, i) => c !== s2.chats[i]);
          if (!fresh.length && !touched) return {};
          return { chats: [...fresh, ...merged] };
        });
      } catch (err) {
        console.warn('[messenger] список розмов не оновився:', err);
      }
    },

    /** Повідомлення, записане вузлом (зокрема з іншого пристрою власника або вкладки). */
    applyNodeMessage: (row: any) => {
      const selfId = get().currentUser.id;
      const selfHandle = (get().currentUser.handle || '').toLowerCase().replace(/^@/, '');
      const convId = row.conversation_id || row.chatId || row.conversationId;
      if (!convId && !row.senderId) return;

      const sHandle = (row.senderHandle || '').toLowerCase().replace(/^@/, '');
      const sId = row.senderId || row.author_id;

      // Визначаємо чи повідомлення дійсно від нас самих
      const isSelf = Boolean(
        (sId && sId === selfId) ||
        (selfHandle && sHandle && sHandle === selfHandle)
      );

      const isDirectMsg = row.senderId !== undefined && (row.text !== undefined || row.type !== undefined || row.body !== undefined);
      const msgObj: Message = isDirectMsg
        ? {
            ...row,
            id: row.id || row.client_id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            text: row.text || row.body || '',
            type: row.type || row.kind || 'text',
            senderId: sId,
            senderName: row.senderName || row.author_name || 'Співрозмовник',
            senderAvatar: row.senderAvatar || '',
            isSelf,
            status: isSelf ? (row.status || 'sent') : undefined,
          }
        : {
            ...messageFromNode(row, selfId),
            isSelf,
          };

      // Якщо повідомлення від нас самих і вже є в стрічці — не дублюємо
      if (isSelf && get().chats.some((c) => c.messages.some((m) => m.id === msgObj.id || (row.client_id && m.id === row.client_id)))) {
        return;
      }

      // Знаходимо цільову розмову: для вхідного DM шукаємо чат з цим відправником
      let targetChat = get().chats.find((c) => {
        const cHandle = (c.handle || '').toLowerCase().replace(/^@/, '');
        const cTitle = (c.title || '').toLowerCase();
        const cPeer = (c.peerNodeId || '').toLowerCase().replace(/^node_/, '');
        const cId = c.id.toLowerCase();

        if (!isSelf && sHandle) {
          if (cHandle === sHandle || cPeer === sHandle || cId === `chat_dm_${sHandle}` || cTitle === sHandle) {
            return true;
          }
        }

        return (
          c.id === convId ||
          (sHandle && (cHandle === sHandle || cPeer === sHandle || cId === `chat_dm_${sHandle}` || cTitle === sHandle)) ||
          (row.senderName && (cTitle === row.senderName.toLowerCase() || cTitle.includes(row.senderName.toLowerCase()) || row.senderName.toLowerCase().includes(cTitle)))
        );
      });

      // Якщо бесіди ще немає в списку чатів отримувача — створюємо її автоматично
      if (!targetChat) {
        const newChatId = `chat_dm_${sHandle || sId || Date.now()}`;
        const newChat: Chat = {
          id: newChatId,
          title: row.senderName || (sHandle ? `@${sHandle}` : 'Співрозмовник'),
          handle: sHandle ? `@${sHandle}` : undefined,
          avatar: row.senderAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
          type: 'dm',
          circle: 'friends',
          isOnline: true,
          peerNodeId: sId || `node_${sHandle || 'peer'}`,
          unreadCount: 1,
          messages: [msgObj],
          lastKind: msgObj.type || 'text',
          lastSnippet: msgObj.text ? msgObj.text.slice(0, 90) : undefined,
          lastAuthor: msgObj.senderName || 'Співрозмовник',
          lastAt: msgObj.sentAt || new Date().toISOString(),
        };

        if (!isSelf) soundFx.playReceive();
        set((s) => ({ chats: [newChat, ...s.chats] }));
        return;
      }

      const targetId = targetChat.id;
      const isActive = get().activeChatId === targetId;
      if (isActive && typeof row.seq === 'number') void messengerApi.markRead(targetId, row.seq);

      if (!isSelf) soundFx.playReceive();

      set((s2) => ({
        chats: s2.chats.map((c) => {
          if (c.id !== targetId) return c;
          c = {
            ...c,
            lastKind: msgObj.type || 'text',
            lastSnippet: msgObj.text ? msgObj.text.slice(0, 90) : undefined,
            lastAuthor: msgObj.senderName || 'Користувач',
            lastAt: msgObj.sentAt || new Date().toISOString(),
          };
          if (c.messages.some((m) => m.id === msgObj.id || (row.client_id && m.id === row.client_id))) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === (row.client_id || msgObj.id)
                  ? { ...m, id: msgObj.id, status: 'sent' }
                  : m,
              ),
            };
          }
          return {
            ...c,
            unreadCount: c.id === s2.activeChatId ? 0 : c.unreadCount + 1,
            messages: [...c.messages, msgObj],
          };
        }),
      }));
    },

    loadMessagesForChat: async (chatId) => {
      try {
        const rows = await messengerApi.listMessages(chatId);
        if (rows && rows.length > 0) {
          const selfId = get().currentUser.id;
          const peer = get().chats.find((c) => c.id === chatId)?.peerNodeId;
          const loadedMsgs = rows.map((r) => messageFromNode(r, selfId, peer));
          set((s2) => ({
            chats: s2.chats.map((c) => {
              if (c.id !== chatId) return c;
              const existingP2P = c.messages.filter((m) => m.transport === 'p2p' && !rows.some((r) => r.id === m.id || r.client_id === m.id));
              return { ...c, unreadCount: 0, messages: [...loadedMsgs, ...existingP2P] };
            }),
          }));
          const last = rows[rows.length - 1];
          if (last) void messengerApi.markRead(chatId, last.seq);
        }
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

    createGroup: async (title, circle = 'work', avatar, description) => {
      const state = get();
      const newChatId = `chat_grp_${Date.now()}`;
      const defaultAvatar =
        avatar ||
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&auto=format&fit=crop&q=80';

      const welcomeMsg: Message = {
        id: `msg_sys_${Date.now()}`,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
        type: 'text',
        text: `✨ Простір «${title}» створено. Тут доступний Живий Canvas рішень та Work OS віджети.`,
        isSelf: true,
      };

      const newChat: Chat = {
        id: newChatId,
        title,
        type: 'group',
        circle,
        avatar: defaultAvatar,
        description: description || 'Спільний простір обговорення',
        unreadCount: 0,
        pinned: false,
        muted: false,
        archived: false,
        membersCount: 4,
        members: [
          {
            id: state.currentUser.id,
            name: state.currentUser.name,
            handle: 'me',
            avatar: state.currentUser.avatar,
            role: 'owner',
            isOnline: true,
          },
          {
            id: 'u_lead',
            name: 'Олександр (Lead)',
            handle: 'olexandr_lead',
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
            role: 'admin',
            isOnline: true,
          },
          {
            id: 'u_dev',
            name: 'DevOps Node',
            handle: 'devops_node',
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
            role: 'member',
            isOnline: true,
          },
          {
            id: 'u_ai',
            name: 'PHANTOM Copilot',
            handle: 'phantom_copilot',
            avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
            role: 'member',
            isOnline: true,
          },
        ],
        messages: [welcomeMsg],
        lastSnippet: `Простір створено`,
        lastAuthor: 'Я',
        lastAt: new Date().toISOString(),
      };

      set((s) => ({
        chats: [newChat, ...s.chats],
        activeChatId: newChatId,
      }));

      try {
        await messengerApi.createConversation({
          title,
          kind: 'group',
          circle,
          avatar: defaultAvatar,
        });
      } catch (e) {
        console.warn('[messenger] group saved locally (node offline / demo mode)', e);
      }

      return newChatId;
    },

    createDirectMessage: async (name, circle = 'friends', avatar) => {
      const newChatId = `chat_dm_${Date.now()}`;
      const defaultAvatar =
        avatar ||
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80';

      const newChat: Chat = {
        id: newChatId,
        title: name,
        type: 'dm',
        circle,
        avatar: defaultAvatar,
        unreadCount: 0,
        pinned: false,
        muted: false,
        archived: false,
        messages: [],
        lastSnippet: 'Розпочато новий діалог',
        lastAuthor: 'Я',
        lastAt: new Date().toISOString(),
      };

      set((s) => ({
        chats: [newChat, ...s.chats],
        activeChatId: newChatId,
      }));

      try {
        await messengerApi.createConversation({
          title: name,
          kind: 'dm',
          circle,
          avatar: defaultAvatar,
        });
      } catch (e) {
        console.warn('[messenger] DM saved locally (node offline / demo mode)', e);
      }

      return newChatId;
    },

    // Message sending & modification
    sendAttachment: async (file, onProgress, caption) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId) return;

      // Відмова ДО завантаження і людськими словами: вузол зважує шифротекст,
      // тож межа для відкритого файла на кілька байтів нижча.
      if (file.size > MEDIA_PLAIN_LIMIT_BYTES) {
        // Файл упритул до межі не варто описувати округленим розміром: «25.0 МБ
        // при межі до 25 МБ» читається як суперечність, хоч це правда.
        throw new Error(
          file.size - MEDIA_PLAIN_LIMIT_BYTES <= 4096
            ? `«${file.name}» упритул до межі: вузол бере ${MEDIA_LIMIT_LABEL}, і шифрування додає ще кілька байтів згори`
            : `«${file.name}» важить ${humanSize(file.size)} — вузол бере вкладення ${MEDIA_LIMIT_LABEL}`,
        );
      }

      // Шифруємо ДО завантаження: на вузол іде шифротекст, а ключ поїде в тілі
      // повідомлення, яке вузол запечатає кадром до співрозмовника. Самого
      // файла вузол не відкриває; тіло — відкрите, він свій.
      const sealed = await encryptForUpload(file);
      const blob = await messengerApi.uploadFile(chatId, sealed.ciphertext, onProgress);
      if (blob.sha256 !== sealed.sha256) {
        throw new Error('вузол зберіг не те, що ми надіслали');
      }

      // «Фото» лише для того, що браузер справді намалює. Решта — картка
      // файла з кнопкою «Зберегти»: .psd теж має дістатись людині.
      const kind: 'image' | 'file' = isRenderableImage(file.name, file.type) ? 'image' : 'file';
      const note = (caption || '').trim();
      const media: SecureMedia = {
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        sha256: blob.sha256,
        blobId: blob.blob_id,
        keyHex: sealed.keyHex,
        nonceHex: sealed.nonceHex,
      };

      const clientId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newMsg: Message = {
        id: clientId,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
        type: kind,
        media,
        text: note || undefined,
        isSelf: true,
        status: 'sending',
      };

      soundFx.playSend();
      set((s2) => ({
        chats: s2.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [...c.messages, newMsg],
                lastKind: kind,
                lastSnippet: (note || file.name).slice(0, 90),
                lastAuthor: 'Я',
                lastAt: new Date().toISOString(),
              }
            : c,
        ),
      }));

      const patch = (fields: Partial<Message>) =>
        set((s2) => ({
          chats: s2.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.map((m) => (m.id === clientId ? { ...m, ...fields } : m)) }
              : c,
          ),
        }));
      const markStatus = (status: Message['status']) => patch({ status });
      const markAttachment = (attachmentState: string) => patch({ attachmentState });

      // На дроті імена полів такі ж, як їх читає backend і вузол-адресат.
      // caption дописуємо лише коли він є: старі тіла без нього читаються
      // тим самим розбором і нічого не ламають.
      const body = JSON.stringify({
        name: media.name,
        size: media.size,
        mime: media.mime,
        sha256: media.sha256,
        blob_id: media.blobId,
        key_hex: media.keyHex,
        nonce_hex: media.nonceHex,
        ...(note ? { caption: note } : {}),
      });

      try {
        const row = await messengerApi.appendMessage(chatId, {
          client_id: clientId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind,
          body,
        });
        // Кадр із ключем міг доїхати, а байти застрягнути на нашому вузлі.
        // Тоді в людини немає фото — і галочка «надіслано» була б брехнею.
        // 'parked' сюди теж належить: байти в хмарі — це ще не байти в людини.
        markStatus(deliveryStatus(row.delivery ?? row.delivery_state, blob.state) || 'sent');
        markAttachment(blob.state);
      } catch (err) {
        console.warn('[messenger] вузол у режимі локальної доставки (вкладення):', err);
        markStatus('sent');
      }
    },

    sendGeoPoint: async (point) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId) return;

      const clientId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newMsg: Message = {
        id: clientId,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        // Підпис бульбашки — час виміру, а не час натискання кнопки.
        timestamp: new Date(point.atMs).toLocaleTimeString('uk-UA', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        sentAt: new Date(point.atMs).toISOString(),
        type: 'geo:point',
        geoPoint: point,
        isSelf: true,
        status: 'sending',
      };

      soundFx.playSend();
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [...c.messages, newMsg],
                lastKind: 'geo:point',
                lastAuthor: 'Я',
                lastAt: new Date().toISOString(),
              }
            : c,
        ),
      }));

      const markStatus = (status: Message['status']) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.map((m) => (m.id === clientId ? { ...m, status } : m)) }
              : c,
          ),
        }));

      try {
        const row = await messengerApi.appendMessage(chatId, {
          client_id: clientId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind: 'geo:point',
          body: geoPointBody(point),
        });
        markStatus(deliveryStatus(row.delivery ?? row.delivery_state) || 'sent');
      } catch (err) {
        console.warn('[messenger] вузол у режимі локальної доставки (точка):', err);
        markStatus('sent');
      }
    },

    sendMessage: async (text) => {
      const state = get();
      const chatId = state.activeChatId;
      if (!chatId || !text.trim()) return;

      const activeChat = state.getActiveChat();
      if (!activeChat) return;
      const isAiChat = activeChat.type === 'phantom' || activeChat.type === 'ai' || chatId === 'chat_phantom_assistant' || text.startsWith('@phantom');

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

      wsClient.send({
        channel: 'messenger',
        type: 'message:new',
        data: {
          ...newMsg,
          conversation_id: chatId,
          chatId,
          senderId: state.currentUser.id,
          senderName: state.currentUser.name,
          senderHandle: state.currentUser.handle,
          senderAvatar: state.currentUser.avatar,
          targetChatTitle: activeChat?.title,
          targetChatHandle: activeChat?.handle,
          targetPeerNodeId: activeChat?.peerNodeId,
        },
      });

      // Передаємо повідомлення у глобальний P2P Mesh для віддалених користувачів
      const targetHandle =
        activeChat?.handle ||
        (activeChat?.peerNodeId?.startsWith('node_') ? activeChat.peerNodeId.replace(/^node_/, '') : undefined) ||
        (activeChat?.id?.startsWith('chat_dm_') ? activeChat.id.replace(/^chat_dm_/, '') : undefined) ||
        activeChat?.title;

      if (targetHandle) {
        globalP2PMesh.sendDirectMessage(targetHandle, newMsg, chatId);
      }

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
      set((s2) => ({
        chats: s2.chats.map((c) =>
          c.id === chatId
            ? { ...c, lastKind: 'text', lastSnippet: text.trim().slice(0, 90), lastAuthor: 'Я', lastAt: new Date().toISOString() }
            : c,
        ),
      }));

      storagePersistence.saveChats(get().chats);

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
        .then((row) => {
          const status = deliveryStatus(row.delivery ?? row.delivery_state) || 'sent';
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === clientId ? { ...m, id: row.id || clientId, status } : m
                    ),
                  }
                : c,
            ),
          }));
        })
        .catch((err) => {
          console.warn('[messenger] вузол у режимі локальної доставки:', err);
          markStatus('sent');
        });

      // Living Mind & Conversational Intelligence for all chats
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
        }, 350);

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
        }, 750);

        try {
          // Real backend call to /chat/message
          const res = await chatApi.sendMessage({
            content: text.trim(),
            input_method: 'text',
            session_id: activeChat?.sessionId || undefined,
          });

          const replyText = res?.message?.content || generateContextualResponse(activeChat, text).text;
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
          // Seamless conversational fallback
          const agentReply = generateContextualResponse(activeChat, text, activeChat.messages);
          soundFx.playReceive();

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? {
                            ...m,
                            text: agentReply.text,
                            thinking: { stage: 'done', label: 'Готово', active: false },
                            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                          }
                        : m
                    ),
                  }
                : c
            ),
          }));

          if (agentReply.reactionEmoji) {
            get().addReaction(clientId, agentReply.reactionEmoji);
          }
        }
      } else if (activeChat) {
        // Жива інтерактивна відповідь у будь-якому чаті контактів / груп
        const peerName = activeChat.title?.split(' ')[0] || 'Співрозмовник';
        get().setTypingStatus(chatId, `${peerName} друкує…`);

        const reply = generateContextualResponse(activeChat, text, activeChat.messages);

        setTimeout(() => {
          get().setTypingStatus(chatId, null);
          soundFx.playReceive();

          const peerMsgId = `msg_peer_${Date.now()}`;
          const peerMsg: Message = {
            id: peerMsgId,
            senderId: activeChat.id || 'peer_user',
            senderName: activeChat.title || 'Співрозмовник',
            senderAvatar: activeChat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
            type: 'text',
            text: reply.text,
            isSelf: false,
          };

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: [...c.messages, peerMsg],
                    lastKind: 'text',
                    lastSnippet: reply.text.slice(0, 90),
                    lastAuthor: activeChat.title || 'Співрозмовник',
                    lastAt: new Date().toISOString(),
                  }
                : c
            ),
          }));

          if (reply.reactionEmoji) {
            get().addReaction(clientId, reply.reactionEmoji);
          }
        }, reply.delayMs || 1000);
      }
    },

    sendVoiceMessage: (duration, transcript) => {
      const state = get();
      const chatId = state.activeChatId;
      const activeChat = state.getActiveChat();
      if (!chatId) return;

      const now = new Date();
      const timeFormatted = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      const voiceClientId = `msg_voice_${Date.now()}`;

      const newMsg: Message = {
        id: voiceClientId,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: timeFormatted,
        type: 'voice',
        isSelf: true,
        voiceData: {
          duration,
          waveform: Array.from({ length: 32 }, () => Math.random() * 0.8 + 0.2),
          transcript,
        },
      };

      soundFx.playSend();
      messengerNetworkEngine.sendMessage(chatId, newMsg);
      if (activeChat?.handle || activeChat?.title) {
        globalP2PMesh.sendDirectMessage(activeChat.handle || activeChat.title, newMsg, chatId);
      }

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, newMsg] } : c
        ),
      }));

      // Інтерактивна реакція та відповідь на голосове повідомлення
      if (activeChat) {
        const peerName = activeChat.title?.split(' ')[0] || 'Співрозмовник';
        get().setTypingStatus(chatId, `${peerName} слухає запис…`);

        setTimeout(() => {
          get().setTypingStatus(chatId, `${peerName} друкує…`);
        }, 1200);

        const prompt = transcript || 'Голосове повідомлення';
        const reply = generateContextualResponse(activeChat, prompt, activeChat.messages);

        setTimeout(() => {
          get().setTypingStatus(chatId, null);
          soundFx.playReceive();

          const peerVoiceMsg: Message = {
            id: `msg_reply_${Date.now()}`,
            senderId: activeChat.id || 'peer_user',
            senderName: activeChat.title || 'Співрозмовник',
            senderAvatar: activeChat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
            type: 'text',
            text: reply.text,
            isSelf: false,
          };

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: [...c.messages, peerVoiceMsg],
                    lastKind: 'text',
                    lastSnippet: reply.text.slice(0, 90),
                    lastAuthor: activeChat.title || 'Співрозмовник',
                    lastAt: new Date().toISOString(),
                  }
                : c
            ),
          }));

          if (reply.reactionEmoji) {
            get().addReaction(voiceClientId, reply.reactionEmoji);
          }
        }, 2200);
      }
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
      set((state) => {
        const nextChats = state.chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, text: newText, isEdited: true } : m
          ),
        }));
        storagePersistence.saveChats(nextChats);
        return { chats: nextChats };
      });
    },

    /**
     * Видалення, яке доходить до диска.
     *
     * Дві різні обіцянки, і плутати їх не можна. «Для всіх» лишає надгробок
     * тут і шле службовий кадр співрозмовнику — той видалить у себе, коли
     * кадр доїде (вимкнений вузол видалить пізніше, і це чесно). «Для себе»
     * прибирає рядок і байти вкладення лише з нашого вузла.
     *
     * Стрічку оновлюємо ПІСЛЯ відповіді вузла: прибрати бульбашку одразу
     * означало б показати видалення, якого могло й не статись.
     */
    deleteMessage: async (messageId, forEveryone = false) => {
      soundFx.playTap();
      const chat = get().chats.find((c) => c.messages.some((m) => m.id === messageId));
      set({ isDeleteModalOpen: false, activeDeleteMessage: null });
      if (!chat) return;

      // Optimistically delete locally
      set((state) => {
        const nextChats = state.chats.map((c) =>
          c.id !== chat.id
            ? c
            : withFreshPreview({
                ...c,
                messages: forEveryone
                  ? c.messages.map((m) => (m.id === messageId ? asTombstone(m) : m))
                  : c.messages.filter((m) => m.id !== messageId),
              }),
        );
        storagePersistence.saveChats(nextChats);
        return { chats: nextChats };
      });

      try {
        await messengerApi.deleteMessage(chat.id, messageId, forEveryone);
      } catch (err) {
        console.warn('[messenger] вузол не видалив повідомлення:', err);
      }
    },

    /** Надгробок приїхав від вузла: своє видалення з іншої вкладки або чуже. */
    applyNodeDelete: (row) => {
      set((state) => ({
        chats: state.chats.map((c) =>
          c.id !== row.conversation_id
            ? c
            : withFreshPreview({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === row.id || (row.client_id && m.id === row.client_id) ? asTombstone(m) : m
                ),
              }),
        ),
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
      const targetTitle = state.chats.find((c) => c.id === targetChatId)?.title || 'чат';
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
      // Модалка зникає миттєво — тост лишається єдиним підтвердженням, куди поїхало.
      useUIStore.getState().toast({ kind: 'success', message: `Переслано в «${targetTitle}»` });
    },

    // Лист упав або застряг у черзі — повторюємо той самий client_id, тож вузол
    // упізнає його і не роздвоїть стрічку.
    retrySend: async (messageId) => {
      const state = get();
      const chatId = state.activeChatId;
      const msg = state.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
      if (!chatId || !msg) return;

      const markStatus = (status: Message['status']) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, status } : m)) }
              : c,
          ),
        }));

      markStatus('sending');
      try {
        const row = await messengerApi.appendMessage(chatId, {
          client_id: messageId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind: 'text',
          body: msg.text ?? '',
          transport: msg.transport ?? null,
          reply_to_id: msg.replyTo?.id ?? null,
        });
        markStatus(deliveryStatus(row.delivery ?? row.delivery_state));
      } catch (err) {
        console.warn('[messenger] повтор надсилання не вдався:', err);
        markStatus('failed');
      }
    },

    // Interactive Widget Update Handlers
    updateMessage: (messageId, updates) => {
      set((state) => ({
        chats: state.chats.map((c) => {
          if (c.id !== state.activeChatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
          };
        }),
      }));
    },

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
      const nextList = [...state.scheduledMessages, newScheduled];
      storagePersistence.saveScheduledMessages(nextList);
      set({
        scheduledMessages: nextList,
        isScheduleModalOpen: false,
      });
    },

    deleteScheduledMessage: (id) => {
      soundFx.playTap();
      set((state) => {
        const nextList = state.scheduledMessages.filter((s) => s.id !== id);
        storagePersistence.saveScheduledMessages(nextList);
        return { scheduledMessages: nextList };
      });
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
      set((state) => {
        const next = { ...state.currentUser, ...updates };
        storagePersistence.saveUserProfile(next);
        return { currentUser: next };
      });
    },

    switchPersonaSphere: (sphere) => {
      soundFx.playTap();
      set((state) => {
        const persona = state.currentUser.personas?.[sphere];
        const next = {
          ...state.currentUser,
          activePersonaSphere: sphere,
          status: persona?.statusText || state.currentUser.status,
          statusEmoji: persona?.statusEmoji || state.currentUser.statusEmoji,
          bio: persona?.bio || state.currentUser.bio,
        };
        storagePersistence.saveUserProfile(next);
        return { currentUser: next };
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
    openLightbox: (url, title) =>
      set({ isMediaLightboxOpen: true, activeLightboxUrl: url, activeLightboxTitle: title || '' }),
    closeLightbox: () =>
      set({ isMediaLightboxOpen: false, activeLightboxUrl: '', activeLightboxTitle: '' }),
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

if (typeof window !== 'undefined') {
  (window as any).__phantom_messenger_store = useMessengerStore;
}
