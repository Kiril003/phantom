/**
 * Стрічка месенджера з вузла. Джерело правди — база вузла, а не памʼять вкладки.
 */

import { BASE, request } from './api';
import type { Chat, Message, SecureMedia } from '../types/messenger';
import { parseGeoPoint } from './messengerGeo';
import { readToken } from './tokenStore';

export interface NodeConversation {
  id: string;
  title: string;
  kind: string;
  circle: string;
  handle: string | null;
  avatar: string | null;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  contact_id?: string | null;
  is_demo?: boolean;
  /** null — розмова ні з ким, тож і звіряти нема кого. */
  contact_verified?: boolean | null;
  peer_node_id?: string | null;
  unread_count?: number;
  last_kind?: string | null;
  last_snippet?: string | null;
  last_author?: string | null;
  last_at?: string | null;
}

export interface NodeMessage {
  id: string;
  conversation_id: string;
  client_id: string;
  seq: number;
  author_id: string;
  author_name: string;
  kind: string;
  body: string | null;
  ciphertext: string | null;
  transport: string | null;
  reply_to_id?: string | null;
  sent_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /** local | queued | sent — див. routes_messenger.py */
  delivery?: string;
  delivery_state?: string;
  /**
   * stored | queued | sent | missing — стан ПЕРЕВЕЗЕННЯ вкладення.
   * Кадр із ключем міг доїхати, а байти — ні; тоді галочка «надіслано» на
   * бульбашці означала б фото, якого в людини немає.
   */
  attachment_state?: string | null;
}

export interface NodeBlob {
  blob_id: string;
  size: number;
  sha256: string;
  /** stored | queued | sent | missing */
  state: string;
}

export interface NodeIdentity {
  node_id: string;
  bundle: Record<string, unknown>;
  /** Стислий ключ — те, що йде в QR. */
  compact: string;
}


/** Учасник групи очима вузла. `session_ready` — чи є ключ, яким йому можна
 *  зашифрувати; без нього вузол НЕ вигадує кадр, а чесно пропускає. */
export interface SearchHit {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  seq: number;
  author_name: string;
  kind: string;
  snippet: string;
  sent_at: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Скільки рядків вузол справді переглянув. */
  scanned: number;
  /** Чи впертись у стелю обходу — клієнт МУСИТЬ це показати, інакше
   *  обрізання прочитається як «такого немає». */
  truncated: boolean;
}

export interface NodeGroupMember {
  node_id: string;
  display_name: string;
  role: string;
  state: string;
  verified: boolean;
  session_ready: boolean;
  undeliverable: boolean;
}

export interface NodeGroup {
  conversation_id: string;
  group_id: string;
  title: string;
  epoch: number;
  fingerprint: string;
  creator_node_id: string;
  own_node_id: string;
  own_state: string;
  verified_pairs: number;
  member_count: number;
  members: NodeGroupMember[];
}

export interface NodeContact {
  id: string;
  peer_node_id: string;
  display_name: string;
  peer_address: string | null;
  safety_number: string;
  safety_number_pretty: string;
  verified: boolean;
  session_ready: boolean;
  created_at: string;
}

export interface Road {
  id: 'direct' | 'relay' | 'mailbox' | 'blobs';
  title: string;
  configured: boolean;
  live: boolean | null;
  state: string;
  detail: string;
  howto: string;
}

export interface RoadsReport {
  roads: Road[];
  configured: number;
  total: number;
}

export const messengerApi = {
  identity: () => request<NodeIdentity>('GET', '/messenger/identity'),

  roads: () => request<RoadsReport>('GET', '/messenger/roads'),

  listContacts: () => request<NodeContact[]>('GET', '/messenger/contacts'),

  /** Склад групи, як його бачить вузол. Одного числа звірки на групу не
   *  існує: спільного секрету немає, є N попарних сесій. */
   
  createGroup: (title: string, contactIds: string[], displayName: string) =>
    request<NodeGroup>('POST', '/messenger/groups', {
      title,
      contact_ids: contactIds,
      display_name: displayName,
    }),

  addContact: (
    display_name: string,
    key: { bundle?: Record<string, unknown>; compact?: string },
    peer_address?: string | null,
  ) =>
    request<NodeContact>('POST', '/messenger/contacts', {
      display_name,
      bundle: key.bundle ?? null,
      compact: key.compact ?? null,
      peer_address: peer_address || null,
    }),

  verifyContact: (id: string) =>
    request<NodeContact>('POST', `/messenger/contacts/${id}/verify`),

  markRead: (conversationId: string, seq: number) =>
    request<{ unread_count: number }>(
      'PATCH', `/messenger/conversations/${conversationId}/read`, { seq },
    ),

  renameConversation: (conversationId: string, title: string) =>
    request<NodeConversation>('PATCH', `/messenger/conversations/${conversationId}`, { title }),

  /** Розмова зникає з ЦЬОГО вузла; копію співрозмовника вузол не чіпає. */
  deleteConversation: (conversationId: string) =>
    request<{ deleted: boolean }>('DELETE', `/messenger/conversations/${conversationId}`),

  /** Стирає листи розмови на цьому вузлі разом із вкладеннями на диску. */
  clearConversation: (conversationId: string) =>
    request<{ cleared: number; blobs: number }>(
      'POST', `/messenger/conversations/${conversationId}/clear`,
    ),

  /**
   * Видаляє повідомлення. forEveryone шле службовий кадр співрозмовнику —
   * тією ж наскрізною дорогою, що й текст.
   *
   * `frame` у відповіді каже правду про долю кадру: 'sent' — вузол адресата
   * його взяв, 'queued' — чекає в черзі (адресат офлайн і видалить пізніше),
   * 'local' — везти нікуди, розмова ні з ким.
   */
  /** Виправляє текст власного листа. Вузол везе правку співрозмовнику сам. */
  editMessage: (conversationId: string, messageId: string, body: string) =>
    request<NodeMessage>(
      'PATCH',
      `/messenger/conversations/${conversationId}/messages/${messageId}`,
      { body },
    ),

  deleteMessage: (conversationId: string, messageId: string, forEveryone: boolean = false) =>
    request<{ deleted: boolean; for_everyone: boolean; blobs: number; frame?: string }>(
      'DELETE',
      `/messenger/conversations/${conversationId}/messages/${messageId}`
        + `?for_everyone=${forEveryone ? 'true' : 'false'}`,
    ),

  /** Скільки листів чекають на зв'язок — головний козир черги, зроблений видимим. */
  /** Стан черги вузла.
   *
   *  ДВА числа, і друге не оздоба. Груповий лист лежить у черзі ОКРЕМИМ
   *  рядком на кожного отримувача: одне повідомлення на 31 людину — це 31
   *  рядок. Вузол рахує їх окремо саме тому, що показати «1» означало б
   *  применшити борг; клієнт же типізував лише `queued` і друге число
   *  мовчки викидав. */
  queueStatus: () =>
    request<{ queued: number; group_frames_queued?: number }>(
      'GET',
      '/messenger/queue/status',
    ),

  listConversations: () => request<NodeConversation[]>('GET', '/messenger/conversations'),

  /** Первинний список. Вузол сам вирішує, створювати чи віддати наявне. */
  bootstrap: (conversations: Array<{
    title: string;
    kind?: string;
    circle?: string;
    handle?: string | null;
    avatar?: string | null;
    is_demo?: boolean;
    messages?: Array<{
      client_id: string;
      author_id: string;
      author_name: string;
      kind?: string;
      body?: string | null;
    }>;
  }>) => request<NodeConversation[]>('POST', '/messenger/bootstrap', { conversations }),

  createConversation: (body: {
    title: string;
    kind?: string;
    circle?: string;
    handle?: string | null;
    avatar?: string | null;
    /** Без нього розмова ні з ким: лист нікуди не поїде. */
    contact_id?: string | null;
  }) => request<NodeConversation>('POST', '/messenger/conversations', body),

  /** Пошук по ВСІЙ історії вузла.
   *
   *  Мусить жити на вузлі, а не у вкладці: тіла лежать запечатаними
   *  (`ciphertext`), і ключі at-rest є лише у вузла. Клієнт має в пам'яті
   *  щонайбільше останні 200 листів відкритої розмови — доти пошук у бічній
   *  панелі звірявся лише з `lastSnippet`, тобто з ОСТАННІМ рядком чату. */
  searchMessages: (query: string, limit = 40) =>
    request<SearchResult>(
      'GET',
      `/messenger/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),

  listMessages: (conversationId: string, afterSeq = 0) =>
    request<NodeMessage[]>(
      'GET',
      `/messenger/conversations/${conversationId}/messages?after_seq=${afterSeq}`,
    ),

  appendMessage: (
    conversationId: string,
    body: {
      client_id: string;
      author_id: string;
      author_name: string;
      kind?: string;
      body?: string | null;
      transport?: string | null;
      reply_to_id?: string | null;
    },
  ) => request<NodeMessage>('POST', `/messenger/conversations/${conversationId}/messages`, body),

  /** Пробуємо проштовхнути чергу зараз; повертає, скільки доставлено. */
  flushQueue: () =>
    request<{ delivered: number; blobs?: number }>('POST', '/messenger/queue/flush'),

  /**
   * Кладе ВЖЕ зашифрований браузером файл на власний вузол.
   *
   * XHR, а не fetch, з однієї причини: тільки він каже, скільки байтів справді
   * пішло. Смуга, намальована таймером, була б вигадкою — а тут її показують
   * людині, яка чекає на своє фото.
   */
  uploadFile: (
    conversationId: string,
    ciphertext: Blob,
    onProgress?: (percent: number) => void,
  ) =>
    new Promise<NodeBlob>((resolve, reject) => {
      const form = new FormData();
      form.append('conversation_id', conversationId);
      form.append('blob', ciphertext, 'blob');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/messenger/files/upload`);
      const token = readToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve(JSON.parse(xhr.responseText) as NodeBlob);
        } else {
          reject(new Error(`вузол не прийняв вкладення: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('звʼязок із вузлом обірвався'));
      xhr.send(form);
    }),

  /** Сирий шифротекст вкладення. Розшифровує браузер — див. messengerMedia.ts. */
  fileUrl: (blobId: string) => `${BASE}/messenger/files/${blobId}`,

  /** stored | queued | parked | sent | missing — стан ПЕРЕВЕЗЕННЯ, не вмісту. */
  blobStatus: (blobId: string) =>
    request<NodeBlob>('GET', `/messenger/files/${blobId}/status`),

  /**
   * «Запитати ще раз»: спершу вузол шукає байти в хмарі, а якщо їх там немає —
   * просить вузол відправника надіслати блоб знову.
   */
  requestBlob: (blobId: string) =>
    request<NodeBlob>('POST', `/messenger/files/${blobId}/request`),

  /** Отримує список користувачів для швидкого пошуку та зв'язку за ніком (@username) */
  listDirectoryUsers: (query?: string) =>
    request<
      Array<{
        id: string;
        username: string;
        display_name: string;
        role: string;
        avatar?: string;
      }>
    >('GET', `/messenger/directory/users${query ? `?query=${encodeURIComponent(query)}` : ''}`),

  /** Розпочинає реальну бесіду з користувачем за його ніком (@username) */
  startChatByUsername: (username: string, circle: string = 'friends') =>
    request<NodeConversation>('POST', '/messenger/directory/start-chat', { username, circle }),
};

const timeLabel = (iso: string): string => {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
};

const RICH_FIELD: Record<string, string> = {
  table: 'tableData', chart: 'chartData', 'task-list': 'taskListData',
  poll: 'pollData', event: 'eventData', 'split-bill': 'splitBillData',
  code: 'codeData', image: 'imageData', file: 'fileData', voice: 'voiceData',
  location: 'locationData', 'multi-quote': 'multiQuoteData',
};

/** Опис вкладення з тіла кадру. Імена полів на дроті — як у backend. */
function mediaFromBody(raw: Record<string, unknown>): SecureMedia {
  return {
    name: String(raw.name ?? 'вкладення'),
    size: Number(raw.size ?? 0),
    mime: String(raw.mime ?? 'application/octet-stream'),
    sha256: String(raw.sha256 ?? ''),
    blobId: String(raw.blob_id ?? ''),
    keyHex: String(raw.key_hex ?? ''),
    nonceHex: String(raw.nonce_hex ?? ''),
  };
}

/**
 * Єдине місце, де стан вузла стає галочкою.
 *
 * Раніше правило жило у трьох місцях (розбір стрічки, відповідь на надсилання,
 * ехо по WebSocket) і в кожному розходилось — саме звідти бралося вікно, коли
 * лист у черзі виглядав доставленим.
 *
 * Галочка означає рівно одне: вузол-адресат узяв кадр. Вкладення важить
 * більше за кадр: поки байти не в людини ('queued' — у нас, 'parked' — у
 * хмарі, 'missing' — загублені), лист не надісланий, хоч би що казав
 * delivery_state.
 */
export function deliveryStatus(
  deliveryState?: string | null,
  attachmentState?: string | null,
): Message['status'] {
  if (attachmentState && attachmentState !== 'sent' && attachmentState !== 'stored') {
    return 'queued';
  }
  if (deliveryState === 'queued') return 'queued';
  if (deliveryState === 'failed') return 'failed';
  if (deliveryState === 'sending') return 'sending';
  return 'sent';
}

/** Чи це наш власний лист.
 *
 *  Виділено в окремий предикат, бо ця умова потрібна двічі — для `isSelf` і
 *  для стану доставки, — а дві копії однієї умови розходяться тихо. Саме так
 *  стан доставки й загубився для груп: `isSelf` умів обходитись без
 *  `peerNodeId`, а розрахунок стану — ні.
 */
function isSelfMessage(row: NodeMessage, selfId: string, peerNodeId?: string): boolean {
  return peerNodeId ? row.author_id !== peerNodeId : row.author_id === selfId;
}

export function messageFromNode(row: NodeMessage, selfId: string, peerNodeId?: string): Message {
  // Показова стрічка везе складний вміст як JSON — розбираємо його тут, щоб
  // таблиці, графіки й реакції жили тим самим шляхом, що й звичайний текст.
  let rich: Record<string, unknown> = {};
  if (row.kind === 'geo:point') {
    // Точка розбирається окремо: у неї свої числа і свій час виміру, і
    // непрочитане тіло краще лишити порожнім, ніж намалювати пів-точки.
    const point = parseGeoPoint(row.body);
    rich = point ? { geoPoint: point } : {};
  } else if (row.kind !== 'text' && row.body) {
    try {
      const parsed = JSON.parse(row.body);
      // Вкладення з наскрізним ключем упізнається за самим описом, а не за
      // типом: показова стрічка теж возить kind='image', але з готовим url.
      if (parsed && parsed.blob_id && parsed.key_hex) {
        // caption — необовʼязковий: тіла, надіслані до нього, читаються тим
        // самим розбором і просто лишаються без підпису.
        const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : '';
        rich = { media: mediaFromBody(parsed), ...(caption ? { text: caption } : {}) };
      } else {
        const field = RICH_FIELD[row.kind];
        rich = field && parsed && !parsed.__msg ? { [field]: parsed } : parsed.__msg || {};
      }
    } catch {
      rich = {};
    }
  }
  return {
    ...rich,
    id: row.id,
    senderId: row.author_id || (row as any).senderId,
    senderName: row.author_name || (row as any).senderName,
    senderAvatar: (row as any).senderAvatar || (row as any).author_avatar || '',
    timestamp: timeLabel(row.sent_at),
    sentAt: row.sent_at,
    type: (row.kind as Message['type']) || 'text',
    text: row.kind === 'text' ? row.body ?? undefined : (rich.text as string | undefined),
    isSelf: isSelfMessage(row, selfId, peerNodeId),
    // Стан доставки — з бази вузла, тож галочки переживають перезавантаження.
    //
    // Умова тут була `peerNodeId && row.author_id !== peerNodeId`, тобто стан
    // рахувався ЛИШЕ для розмови один-на-один. У ГРУПИ `peerNodeId` немає за
    // побудовою: віяр робить окремий кадр кожному учаснику його попарною
    // сесією, тож єдиного співрозмовника не існує.
    //
    // Наслідок був виміряний на живому вузлі: лист у групу з двома учасниками
    // за мертвою адресою повертався з `delivery_state: 'queued'` — вузол знав
    // правду й казав її, — а бульбашка малювалась БЕЗ ЖОДНОГО значка, бо
    // значок вимагає `msg.status`. Тобто від доставленого вона не
    // відрізнялась нічим. Той самий клас, що голосове й `is_demo`: правду
    // несли всі шари, крім останнього.
    //
    // Тепер стан рахується для будь-якого НАШОГО листа. Для нотаток самому
    // собі вузол віддає `delivery_state: 'local'`, і це чесно означає
    // «надіслано»: везти нікуди.
    status: isSelfMessage(row, selfId, peerNodeId)
      ? deliveryStatus(row.delivery_state, row.attachment_state)
      : undefined,
    // Підстава під підписом бульбашки: «очікує передачі» проти «у дорозі
    // через хмару» — різні речі, і крапка одного кольору їх не розрізняє.
    attachmentState: row.attachment_state ?? undefined,
    isDeleted: Boolean(row.deleted_at),
    isEdited: Boolean(row.edited_at),
    transport: (row.transport as Message['transport']) ?? undefined,
  };
}

export function chatFromNode(row: NodeConversation): Chat {
  return {
    contactVerified: row.contact_verified ?? null,
    id: row.id,
    title: row.title,
    handle: row.handle ?? undefined,
    avatar: row.avatar ?? '',
    type: (row.kind as Chat['type']) || 'dm',
    circle: (row.circle as Chat['circle']) || 'all',
    pinned: row.pinned,
    isDemo: row.is_demo === true,
    peerNodeId: row.peer_node_id ?? undefined,
    unreadCount: row.unread_count ?? 0,
    lastKind: row.last_kind ?? undefined,
    lastSnippet: row.last_snippet ?? undefined,
    lastAuthor: row.last_author ?? undefined,
    lastAt: row.last_at ?? undefined,
    messages: [],
  };
}
