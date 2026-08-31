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
// `services/conversationalAgent` більше не викликається звідси — жодного разу.
// Сам файл лишено на місці свідомо: він живе ще у двох деревах, і рішення про
// його долю не моє. Але жодного викликача в месенджері в нього немає, і якщо
// хтось захоче повернути — хай спершу прочитає, що саме він вигадував:
// телеметрію безпеки («наскрізне шифрування активне»), листи від матері
// власника на його ім'я і рапорти про RTT від людей, які нічого не писали.
import { globalP2PMesh } from '../services/globalP2PMesh';
import type { ChatFlags } from '../services/storagePersistence';
import { storagePersistence } from '../services/storagePersistence';
import type { OutboxEntry } from '../services/storagePersistence';
import { aiEngineService, type ChatHistoryItem } from '../services/aiEngineService';

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
  /**
   * Заводить СПРАВЖНЮ групу на вузлі: `POST /messenger/groups`.
   *
   * `contactIds` — лише наявні контакти, і це не забаганка API: щоб
   * зашифрувати людині, потрібен її ключ, а він береться з контакту. Вузол
   * робить окремий кадр кожному учаснику своєю попарною сесією; кому ключа
   * немає — кадр НЕ вигадується, учасник іде в `skipped`.
   */
  createGroup: (
    title: string,
    contactIds: string[],
    circle?: ChatCircle,
    avatar?: string,
    description?: string,
  ) => Promise<string>;
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
  sendVoiceMessage: (
    duration: number,
    transcript: string,
    audioUrl?: string,
    waveform?: number[],
  ) => void;
  addCustomMessage: (message: Message) => void;
  /** Іде до вузла; стрічка міняється лише після його відповіді. */
  editMessage: (messageId: string, newText: string) => Promise<void>;
  /** forEveryone — службовий кадр поїде співрозмовнику; інакше чистка своя. */
  deleteMessage: (messageId: string, forEveryone?: boolean) => Promise<void>;
  togglePinMessage: (messageId: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  /** Іде до вузла тією ж дорогою, що й звичайний лист. */
  forwardMessage: (msg: Message, targetChatId: string) => Promise<void>;
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
  /** Іде до вузла, і саме в ту розмову, для якої складено чернетку. */
  sendScheduledNow: (id: string) => Promise<void>;

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

/**
 * Повертає листи зі скриньки вихідних на їхні місця в чатах.
 *
 * Винесено окремо навмисно: «написане не зникає» — обіцянка, яку треба вміти
 * ДОВЕСТИ, а не переказати. Всередині ініціалізації сторе її не перевірити.
 *
 * Двічі один лист не з'являється: якщо він уже є в чаті (історія підвантажилась
 * із вузла), лишається той, що в чаті.
 */
export function restoreOutboxInto(chats: Chat[], pending: OutboxEntry[]): Chat[] {
  if (pending.length === 0) return chats;
  return chats.map((chat) => {
    const mine = pending.filter((e) => e.chatId === chat.id);
    if (mine.length === 0) return chat;
    const known = new Set(chat.messages.map((m) => m.id));
    const restored = mine.filter((e) => !known.has(e.id)).map((e) => e.message);
    return restored.length ? { ...chat, messages: [...chat.messages, ...restored] } : chat;
  });
}

/** Запам'ятовує прапорці розмов на цьому пристрої й повертає новий стан. */
function rememberFlags(chats: Chat[]): { chats: Chat[] } {
  const flags: Record<string, ChatFlags> = {};
  for (const c of chats) {
    if (c.pinned || c.muted || c.archived) {
      flags[c.id] = { pinned: c.pinned, muted: c.muted, archived: c.archived };
    }
  }
  void storagePersistence.saveChatFlags(flags);
  return { chats };
}

/** Прикладає збережені прапорці до розмови, що прийшла з вузла. */
function withSavedFlags(chat: Chat, flags: Record<string, ChatFlags>): Chat {
  const saved = flags[chat.id];
  if (!saved) return chat;
  return { ...chat, pinned: saved.pinned, muted: saved.muted, archived: saved.archived };
}

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

  const persistedUser = storagePersistence.getUserProfileSync();
  const persistedChats = storagePersistence.loadSetting<Chat[] | null>('phantom_chats_backup', null);
  const persistedScheduled = storagePersistence.loadSetting<ScheduledMessage[] | null>('phantom_scheduled_messages', null);

  const activeUser = persistedUser || defaultUser;
  let activeChats = persistedChats && persistedChats.length > 0 ? persistedChats : initialChats;

  // Листи, яких вузол не взяв, повертаються на свої місця після перезапуску.
  // Читаємо синхронно (дзеркало в localStorage), щоб перший кадр уже показав
  // їх із позначкою «не пішло», а не з'явив за мить.
  activeChats = restoreOutboxInto(activeChats, storagePersistence.loadOutboxSync());
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
          // Прапорці — на цьому пристрої, а список приходить із вузла й
          // перебудовується. Без цього рядка закріплення зникало б при
          // кожному оновленні списку, не лише при перезавантаженні.
          const savedFlags = storagePersistence.loadChatFlags();
          const fresh = rows
            .filter((r) => !known.has(r.id))
            .map((r) => withSavedFlags(chatFromNode(r), savedFlags));
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
          // Аватарка — лише та, що приїхала з повідомленням. Раніше на її
          // місце ставало фото незнайомої людини з чужого сервера, і воно
          // ставало «обличчям» співрозмовника назавжди.
          avatar: row.senderAvatar || '',
          type: 'dm',
          circle: 'friends',
          // Присутність вузол не знає, і це поле більше ніхто не оновлює —
          // тобто `true` тут лишалось би назавжди, зокрема й тоді, коли
          // людина давно вимкнула пристрій.
          isOnline: false,
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

    // Три прапорці жили ЛИШЕ в пам'яті вкладки. Жоден перемикач нічого не
    // зберігав, `loadChats` не викликався взагалі — тобто людина закріплювала
    // розмову, закривала вкладку, і закріплення зникало. Не «не синхронізовано
    // між пристроями», а не пережило власного вікна.
    //
    // Пристрій свій, і це сказано вголос: у вузла для них немає полів узагалі.
    // Закріплене на ПК на телефоні не з'явиться, і вдавати протилежне не
    // будемо, доки на вузлі не буде де це тримати.
    togglePinChat: (chatId) => {
      soundFx.playTap();
      set((state) => rememberFlags(state.chats.map(
        (c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c),
      )));
    },

    toggleMuteChat: (chatId) => {
      soundFx.playTap();
      set((state) => rememberFlags(state.chats.map(
        (c) => (c.id === chatId ? { ...c, muted: !c.muted } : c),
      )));
    },

    toggleArchiveChat: (chatId) => {
      soundFx.playTap();
      set((state) => rememberFlags(state.chats.map(
        (c) => (c.id === chatId ? { ...c, archived: !c.archived } : c),
      )));
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

    createGroup: async (title, contactIds, circle = 'work', avatar, description) => {
      const state = get();

      // ГРУПА ЗАВОДИТЬСЯ НА ВУЗЛІ, а не малюється тут.
      //
      // Було: цей метод вигадував трьох учасників («Олександр (Lead)»,
      // «DevOps Node», «PHANTOM Copilot»), ставив `membersCount: 4` і кликав
      // `createConversation({kind:'group'})` — маршрут, який `group_id`
      // НЕ ставить ніколи. Через це умова віяра на бекенді не спрацьовувала
      // жодного разу, і лист у «простір» лишався в локальній стрічці цієї
      // машини. 801 рядок робочого групового меша не викликався ніким.
      //
      // Тепер кличеться `POST /messenger/groups`: вузол заводить групу з
      // НАЯВНИХ контактів, розсилає запрошення й повертає справжній склад.
      // Якщо вузол не зміг — групи немає. Намалювати її тут означало б
      // показати простір, у який нічого не піде.
      const group = await messengerApi.createGroup(
        title,
        contactIds,
        state.currentUser.name,
      );

      const newChat: Chat = {
        id: group.conversation_id,
        type: 'group',
        title: group.title,
        circle,
        avatar: avatar ?? '',
        description,
        unreadCount: 0,
        pinned: false,
        muted: false,
        archived: false,
        membersCount: group.member_count,
        // Склад — з вузла. Кожен рядок відповідає справжньому контакту, і
        // `session_ready: false` означає «ключа для цієї людини ще немає»,
        // тобто кадр їй не поїде — це видно, а не приховано.
        members: group.members.map((m) => ({
          id: m.node_id,
          name: m.display_name,
          handle: m.node_id.slice(0, 8),
          avatar: '',
          role: (m.role === 'creator' ? 'owner' : 'member') as 'owner' | 'member',
          // Присутності вузол не публікує — і ми її не вигадуємо. Замість
          // «в мережі» показуємо те, що справді знаємо: чи є ключ, яким цій
          // людині можна зашифрувати. Без ключа кадр їй не поїде, і це має
          // бути видно, а не приховано.
          isOnline: false,
          statusText: m.session_ready
            ? (m.verified ? 'ключ звірено' : 'ключ є, звірка не проводилась')
            : 'ключа ще немає — кадр не поїде',
        })),
        messages: [],
        lastSnippet: '',
        lastAuthor: '',
        lastAt: new Date().toISOString(),
      };

      set((s) => ({
        chats: [newChat, ...s.chats],
        activeChatId: newChat.id,
      }));

      return newChat.id;
    },

    createDirectMessage: async (name, circle = 'friends', avatar) => {
      const newChatId = `chat_dm_${Date.now()}`;
      // Обличчя співрозмовника беремо лише те, що дали. Раніше на його місце
      // ставало фото незнайомця з чужого сервера — і ставало обличчям цієї
      // людини назавжди.
      const defaultAvatar = avatar || '';

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

      const localPreviewUrl = URL.createObjectURL(file);
      let sealedKeyHex = '';
      let sealedNonceHex = '';
      let blobSha256 = '';
      // Тимчасове ім'я лише для локального показу, доки вузол не назве
      // справжнє. Якщо вивантаження впаде, це ім'я НЕ можна віддавати як
      // справжнє: адресат попросить за ним байти й дістане 404.
      let blobId = `blob_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let bytesLeftTheMachine = false;

      try {
        const sealed = await encryptForUpload(file);
        sealedKeyHex = sealed.keyHex;
        sealedNonceHex = sealed.nonceHex;
        blobSha256 = sealed.sha256;
        const blob = await messengerApi.uploadFile(chatId, sealed.ciphertext, onProgress);
        if (blob?.blob_id) {
          blobId = blob.blob_id;
          blobSha256 = blob.sha256 || sealed.sha256;
          bytesLeftTheMachine = true;
        }
      } catch (uploadErr) {
        // Байти НЕ вийшли з машини. Раніше тут був лише `console.warn`, і лист
        // летів далі з ВИГАДАНИМ `blobId` — відправник бачив галочку
        // «надіслано» на файл, якого не існує ніде, а адресат на запит байтів
        // діставав 404. Та сама брехня про дію, що й галочка при 401.
        console.warn('[messenger] вузол не взяв байти вкладення:', uploadErr);
      }

      // «Фото» лише для того, що браузер справді намалює. Решта — картка
      // файла з кнопкою «Зберегти»: .psd теж має дістатись людині.
      const kind: 'image' | 'file' = isRenderableImage(file.name, file.type) ? 'image' : 'file';
      const note = (caption || '').trim();
      const media: SecureMedia = {
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        sha256: blobSha256,
        blobId: blobId,
        keyHex: sealedKeyHex,
        nonceHex: sealedNonceHex,
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
        mediaUrl: localPreviewUrl,
        fileName: file.name,
        fileSize: file.size,
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

      // Байти не вийшли — лист не йде. Надіслати картку файла, чиїх байтів не
      // існує, означало б дати галочку на порожнечу: адресат попросить їх за
      // `blob_id` і дістане 404, а відправник цього не побачить ніколи.
      if (!bytesLeftTheMachine) {
        markStatus('failed');
        markAttachment('missing');
        void storagePersistence.saveOutbox({
          id: clientId,
          chatId,
          message: { ...newMsg, status: 'failed' },
          savedAt: Date.now(),
          attempts: 1,
        });
        return;
      }

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
        markStatus(deliveryStatus(row.delivery ?? row.delivery_state) || 'sent');
        markAttachment('stored');
        void storagePersistence.dropOutbox(clientId);
      } catch (err) {
        // Сервер НЕ взяв лист. Позначати його «надісланим» — брехня про
        // дію користувача, а не про стан: людина бачить галочку, йде, і
        // листа не існує. Шлях повтору (`resendMessage`) уже робив тут
        // `failed` — решта трьох ставили `sent`, і саме це розходження
        // ховало дефект: один випадок був чесний, три ні.
        // Черги тут немає: запит не дійшов, тож ніде нічого не лежить.
        console.warn('[messenger] вузол не взяв вкладення:', err);
        markStatus('failed');
        // Написане не зникає — і вкладення тим паче: рядок людина набере
        // заново, а знімок у тому ж місці й часі — ні.
        void storagePersistence.saveOutbox({
          id: clientId,
          chatId,
          message: { ...newMsg, status: 'failed' },
          savedAt: Date.now(),
          attempts: 1,
        });
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
  void storagePersistence.dropOutbox(clientId);
      } catch (err) {
        // Сервер НЕ взяв лист. Позначати його «надісланим» — брехня про
        // дію користувача, а не про стан: людина бачить галочку, йде, і
        // листа не існує. Шлях повтору (`resendMessage`) уже робив тут
        // `failed` — решта трьох ставили `sent`, і саме це розходження
        // ховало дефект: один випадок був чесний, три ні.
        // Черги тут немає: запит не дійшов, тож ніде нічого не лежить.
        console.warn('[messenger] вузол не взяв точку:', err);
        markStatus('failed');
        // Написане не зникає — і точку тим паче: рядок людина набере
        // заново, а точку в тому ж місці й часі — ні.
        void storagePersistence.saveOutbox({
          id: clientId,
          chatId,
          message: { ...newMsg, status: 'failed' },
          savedAt: Date.now(),
          attempts: 1,
        });
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
          // Дійшло — у скриньці вихідних йому більше не місце.
          void storagePersistence.dropOutbox(clientId);
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
          // Сервер НЕ взяв лист. Позначати його «надісланим» — брехня про
          // дію користувача, а не про стан: людина бачить галочку, йде, і
          // листа не існує. Шлях повтору (`resendMessage`) уже робив тут
          // `failed` — решта трьох ставили `sent`, і саме це розходження
          // ховало дефект: один випадок був чесний, три ні.
          // Черги тут немає: запит не дійшов, тож ніде нічого не лежить.
          console.warn('[messenger] вузол не взяв лист:', err);
          markStatus('failed');
          // Написане не зникає. Доти лист жив лише в пам'яті вкладки: людина
          // бачила «не пішло» — чесно, — але після перезапуску написаного не
          // було взагалі. Тепер він переживає перезапуск, і його видно з
          // кнопкою повтору.
          void storagePersistence.saveOutbox({
            id: clientId,
            chatId,
            message: { ...newMsg, status: 'failed' },
            savedAt: Date.now(),
            attempts: 1,
          });
        });

      // Living Mind & Conversational Intelligence for all chats
      if (isAiChat) {
        const aiMsgId = `msg_ai_${Date.now()}`;
        const pendingAiMsg: Message = {
          id: aiMsgId,
          senderId: 'assistant_phantom',
          senderName: 'PHANTOM',
          senderAvatar: '',
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
          let replyText = '';

          if (aiEngineService.hasApiKey()) {
            const history: ChatHistoryItem[] = (activeChat?.messages || [])
              .slice(-10)
              .filter((m) => m.id !== aiMsgId)
              .map((m) => ({
                role: m.isSelf ? 'user' : 'model',
                content: m.text || '',
              }));

            let specificSystemPrompt: string | undefined = undefined;
            const chatTitleLower = (activeChat?.title || '').toLowerCase();

            if (chatTitleLower.includes('thought architect') || chatId === 'chat_thought_architect') {
              specificSystemPrompt =
                'Ти Thought Architect — сократівський мислитель і системний аналітик PHANTOM OS. Твоя мета — піддавати ідеї глибокому критичному розбору, аналізувати компроміси, архітектурні ризики та пропонувати альтернативні шляхи. Відповідай виключно українською мовою, структуровано, пунктами.';
            } else if (chatTitleLower.includes('pair programmer') || chatId === 'chat_pair_programmer') {
              specificSystemPrompt =
                'Ти Pair Programmer — провідний системний інженер PHANTOM OS (Kotlin, TypeScript, React, Rust, Python, Linux, WebGPU). Надавай робочий, компільований та оптимізований код без зайвих заглушок та пояснюй ключові інженерні рішення українською мовою.';
            } else if (chatTitleLower.includes('mini-apps') || chatId === 'chat_app_generator') {
              specificSystemPrompt =
                'Ти Interactive Mini-Apps Generator для PHANTOM OS. Твоє завдання — генерувати інтерактивні віджети, мікро-додатки та інструменти для автоматизації оператора.';
            }

            replyText = await aiEngineService.generateReply({
              prompt: text.trim(),
              history,
              systemInstruction: specificSystemPrompt,
            });
          } else {
            // Спроба викликати бекенд вузла, якщо локальний API ключ ще не введено
            try {
              const res = await chatApi.sendMessage({
                content: text.trim(),
                input_method: 'text',
                session_id: activeChat?.sessionId || undefined,
              });
              replyText = res?.message?.content || '';
            } catch {
              replyText = '';
            }

            // Вузол не відповів — так і кажемо.
            //
            // Було: `generateContextualResponse` вигадував відповідь, і людина
            // НЕ МОГЛА відрізнити її від справжньої. Серед заготовок був і
            // «Системний статус: GHOST L5… наскрізне шифрування активне,
            // затримка вузла 12 мс» — тобто вигадана телеметрія БЕЗПЕКИ, яку
            // читають як доказ, що шифрування працює.
            //
            // Мовчання вузла й відповідь помічника — різні події, і плутати їх
            // не можна навіть заради того, щоб екран не був порожнім.
            if (!replyText) {
              replyText =
                'Помічник зараз не відповідає: вузол не повернув відповіді. ' +
                'Це не відмова — просто зв’язку з моделлю немає. Ключ Gemini або ' +
                'OpenAI можна ввести в Налаштуваннях → Нейромережа & API.';
            }
          }

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
        } catch (err: any) {
          console.error('[messenger] AI generation error:', err);
          soundFx.playReceive();
          const errMessage = err?.message || 'Не вдалося отримати відповідь від AI.';

          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? {
                            ...m,
                            text: `⚠️ **Помилка AI**: ${errMessage}\n\nБудь ласка, перевірте правильність ключа або ліміти в **Налаштуваннях ⚙️ -> Нейромережа & API**.`,
                            thinking: { stage: 'done', label: 'Помилка', active: false },
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

    sendVoiceMessage: (duration, transcript, audioUrl, waveform) => {
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
          // Виміряні піки мікрофона. Було `Math.random()` — 32 випадкових
          // стовпчики, однаково жваві для крику й для тиші, і НОВІ при
          // кожному записі того самого голосу. Якщо мікрофона чи WebAudio
          // не було, приходить порожньо, і рендерер малює нуль смужок:
          // краще без хвилі, ніж із намальованою.
          waveform: waveform ?? [],
          audioUrl,
          transcript,
        },
      };

      soundFx.playSend();
      messengerNetworkEngine.sendMessage(chatId, newMsg);
      if (activeChat?.handle || activeChat?.title) {
        globalP2PMesh.sendDirectMessage(activeChat.handle || activeChat.title, newMsg, chatId);
      }

      // ГОЛОСОВЕ НІКУДИ НЕ ЙДЕ, і до 30.08.2026 це ніяк не показувалось.
      //
      // Виміряно, а не припущено:
      //  * `voice` НЕМАЄ в `WIRE_KINDS` (messenger/blobs.py:111) — дріт несе
      //    text, image, file, delete, radio, group:invite, geo:point. Кадру
      //    для голосу не існує, `wrap_frame` на нього кидає ValueError;
      //  * шлях вище шле у вебсокет `chat:send_message`, а grep по ВСЬОМУ
      //    бекенду на цей рядок дає НУЛЬ збігів — його не приймає ніхто.
      //
      // Тобто запис лишається на цьому вузлі. Раніше повідомлення малювалось
      // геть без значка (`isSelf && msg.status` — а статусу не ставили), тож
      // від доставленого воно не відрізнялось нічим. Ставимо чесний стан:
      // людина мусить знати, що її не почули, ПЕРШ НІЖ чекати відповіді.
      //
      // Прибрати цей рядок можна лише разом із появою голосу на дроті — а
      // для цього обидва боки спершу мають уміти сказати «не вмію показати»
      // (правило в unwrap_frame). Телефонну половину ставить Чат 3.
      newMsg.status = 'failed';

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, newMsg] } : c
        ),
      }));

      // ТУТ ЗАСТОСУНОК ПИСАВ ВІД ІМЕНІ СПІВРОЗМОВНИКА. Прибрано 30.08.2026.
      //
      // Було: після голосового `generateContextualResponse` вигадував текст, і
      // той лягав у бесіду як `peerVoiceMsg` — з ІМЕНЕМ співрозмовника, його
      // аватаркою і `isSelf: false`. Плюс «{Ім'я} слухає запис…» і «{Ім'я}
      // друкує…», хоч ніхто нічого не слухав і не друкував.
      //
      // Це не брехня про стан і навіть не брехня про дію користувача. Це
      // слова, вкладені в чужі вуста, у власній бесіді цієї людини. Гірше за
      // все, що знайдено в месенджері за два дні: вигаданого друга в списку
      // можна прийняти за приклад, а вигадану відповідь від матері —
      // не можна ніяк.
      //
      // Нічого не підставляємо: голосове надіслано (або чесно не надіслано —
      // стан і скринька вже це показують), а відповідь прийде тоді, коли її
      // справді напише людина.
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

    // Правка живе у вузлі, а не в памʼяті вкладки.
    //
    // Тут стояла чиста мутація стора: текст мінявся на екрані, зберігався в
    // локальне сховище — і до вузла не йшло НІЧОГО. Співрозмовник назавжди
    // лишався з першою редакцією, а на іншому вікні того самого вузла лист
    // теж був старий. `edited_at` при цьому вже існував у схемі й чесно
    // віддавався назовні; ставити його було нікому.
    //
    // Стрічку міняємо ПІСЛЯ відповіді вузла: показати новий текст одразу
    // означало б показати власний намір замість стану системи.
    editMessage: async (messageId, newText) => {
      const state = get();
      const chat = state.chats.find((c) => c.messages.some((m) => m.id === messageId));
      const body = newText.trim();
      if (!chat) return;
      if (!body) {
        useUIStore.getState().toast({ kind: 'error', message: 'Порожня правка стерла б лист' });
        return;
      }

      try {
        const row = await messengerApi.editMessage(chat.id, messageId, body);
        set((s) => {
          const nextChats = s.chats.map((c) =>
            c.id !== chat.id
              ? c
              : {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? { ...m, text: row.body ?? body, isEdited: true }
                      : m,
                  ),
                },
          );
          storagePersistence.saveChats(nextChats);
          return { chats: nextChats };
        });
      } catch (err) {
        console.warn('[messenger] правка не доїхала:', err);
        // Стрічку не чіпаємо: старий текст — це те, що зараз бачить
        // співрозмовник, і показати інше означало б розійтися з ним.
        useUIStore.getState().toast({ kind: 'error', message: 'Правку не збережено' });
      }
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

    // Пересилання — це звичайне надсилання в ІНШУ розмову, тож іде тією самою
    // дорогою, що й лист: `appendMessage`. Раніше тут будувався рядок у сторі,
    // грав звук відправки й показувався тост «Переслано» — а до вузла не
    // йшло НІЧОГО. На перезавантаженні пересланого листа не було. Тобто
    // людині казали, що доїхало, знаючи, що воно навіть не виїжджало.
    forwardMessage: async (msg, targetChatId) => {
      const state = get();
      const targetTitle = state.chats.find((c) => c.id === targetChatId)?.title || 'чат';
      const ui = useUIStore.getState();

      // Вміст, який ми НЕ вміємо перевезти чесно. Файл довелося б покласти в
      // сховок наново, опитування — завести з новим складом голосів; ні того,
      // ні того вузол зараз не робить. Копія у сторі виглядала б як успіх і
      // зникла б при перезавантаженні, тому кажемо прямо.
      const body = (msg.text ?? '').trim();
      if (!body) {
        ui.toast({
          kind: 'error',
          message: msg.type === 'text'
            ? 'Порожнє повідомлення не пересилаємо'
            : 'Поки вміємо пересилати лише текст',
        });
        set(() => ({ isForwardModalOpen: false, activeForwardMessage: null }));
        return;
      }

      const clientId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const forwarded: Message = {
        ...msg,
        id: clientId,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
        senderAvatar: state.currentUser.avatar,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        forwardFrom: { chatTitle: state.getActiveChat()?.title || 'Чат', senderName: msg.senderName },
        isSelf: true,
        status: 'sending',
      };

      soundFx.playSend();
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === targetChatId ? { ...c, messages: [...c.messages, forwarded] } : c
        ),
        isForwardModalOpen: false,
        activeForwardMessage: null,
      }));

      const markStatus = (status: Message['status']) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === targetChatId
              ? { ...c, messages: c.messages.map((m) => (m.id === clientId ? { ...m, status } : m)) }
              : c,
          ),
        }));

      try {
        const row = await messengerApi.appendMessage(targetChatId, {
          client_id: clientId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind: 'text',
          body,
          transport: null,
          reply_to_id: null,
        });
        markStatus(deliveryStatus(row.delivery ?? row.delivery_state));
        // Тост лише ПІСЛЯ відповіді вузла: до неї казати «переслано» нема підстав.
        ui.toast({ kind: 'success', message: `Переслано в «${targetTitle}»` });
      } catch (err) {
        console.warn('[messenger] пересилання не вдалось:', err);
        markStatus('failed');
        ui.toast({ kind: 'error', message: `Не переслалось у «${targetTitle}»` });
      }
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
        void storagePersistence.dropOutbox(messageId);
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

    // Голос лишається на цьому пристрої.
    //
    // Вузол про опитування не знає нічого: ані типу на дроті, ані таблиці.
    // Саме опитування теж нікуди не їде — `addCustomMessage` кладе його лише
    // в стор. Тобто «7 голосів» тут завжди означає «7 ваших дотиків», а не
    // думку групи, і показувати це як спільний підсумок було б вигадкою.
    //
    // Не прибираю жест: людина справді може щось для себе позначити. Але й
    // не вдаю, що голос кудись поїхав.
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
    // Чернетка з нагадуванням про час — НЕ відкладена відправка.
    //
    // Вузол про відкладені листи не знає нічого: ані таблиці, ані маршруту.
    // Диспетчер живе у вкладці (`MessengerRoot`, кожні 10 с, збіг `HH:MM`),
    // тож лист іде лише поки месенджер ВІДКРИТИЙ, а пропущена хвилина
    // пропущена назавжди — надолуження немає. Слово «черга ... до відправки»
    // обіцяло самостійне надсилання, якого вкладка виконати не може.
    //
    // Справжня відкладена відправка потребує вузла: рядок у базі й гілка в
    // смузі `redelivery_loop`, яка вже цокає й уже доставляє. Доки цього
    // немає — не обіцяємо.
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
      useUIStore.getState().toast({
        kind: 'info',
        message: `Чернетку збережено на ${timeStr} — надішлете дотиком`,
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

    // Надсилає чернетку В ТУ РОЗМОВУ, для якої її склали.
    //
    // Тут стояло `sendMessage(scheduled.text)`, а `sendMessage` шле в
    // АКТИВНИЙ чат. Диспетчер (`MessengerRoot`, кожні 10 с) кличе саме цю
    // дію, коли збігається час, — тобто відкладений лист для Марти йшов у
    // ту розмову, яка випадково відкрита о тій хвилині. Не «не надіслався»,
    // а надіслався НЕ ТІЙ ЛЮДИНІ, і відправник цього не бачив.
    sendScheduledNow: async (id) => {
      const state = get();
      const scheduled = state.scheduledMessages.find((s) => s.id === id);
      const body = (scheduled?.text ?? '').trim();
      if (!scheduled || !body) return;

      const target = scheduled.chatId;
      const chat = state.chats.find((c) => c.id === target);
      if (!target || !chat) {
        // Розмови вже немає. Мовчки кинути в іншу — саме та вада, що вище.
        useUIStore.getState().toast({
          kind: 'error',
          message: 'Розмови для цієї чернетки більше немає',
        });
        return;
      }

      const clientId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      try {
        const row = await messengerApi.appendMessage(target, {
          client_id: clientId,
          author_id: state.currentUser.id,
          author_name: state.currentUser.name,
          kind: 'text',
          body,
          transport: null,
          reply_to_id: null,
        });
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== target
              ? c
              : {
                  ...c,
                  messages: [
                    ...c.messages,
                    {
                      id: clientId,
                      senderId: state.currentUser.id,
                      senderName: state.currentUser.name,
                      senderAvatar: state.currentUser.avatar,
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      type: 'text',
                      text: body,
                      isSelf: true,
                      status: deliveryStatus(row.delivery ?? row.delivery_state),
                    } as Message,
                  ],
                },
          ),
        }));
        get().deleteScheduledMessage(id);
      } catch (err) {
        console.warn('[messenger] чернетку не надіслано:', err);
        // Чернетку НЕ прибираємо: інакше вона зникла б, не поїхавши.
        useUIStore.getState().toast({
          kind: 'error',
          message: `Не надіслалось у «${chat.title}» — чернетка лишилась`,
        });
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
