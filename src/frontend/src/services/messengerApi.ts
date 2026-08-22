/**
 * Стрічка месенджера з вузла. Джерело правди — база вузла, а не памʼять вкладки.
 */

import { request } from './api';
import type { Chat, Message } from '../types/messenger';

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
}

export interface NodeIdentity {
  node_id: string;
  bundle: Record<string, unknown>;
  /** Стислий ключ — те, що йде в QR. */
  compact: string;
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

export const messengerApi = {
  identity: () => request<NodeIdentity>('GET', '/messenger/identity'),

  listContacts: () => request<NodeContact[]>('GET', '/messenger/contacts'),

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
  }) => request<NodeConversation>('POST', '/messenger/conversations', body),

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

export function messageFromNode(row: NodeMessage, selfId: string): Message {
  // Показова стрічка везе складний вміст як JSON — розбираємо його тут, щоб
  // таблиці, графіки й реакції жили тим самим шляхом, що й звичайний текст.
  let rich: Record<string, unknown> = {};
  if (row.kind !== 'text' && row.body) {
    try {
      const parsed = JSON.parse(row.body);
      const field = RICH_FIELD[row.kind];
      rich = field && parsed && !parsed.__msg ? { [field]: parsed } : parsed.__msg || {};
    } catch {
      rich = {};
    }
  }
  return {
    ...rich,
    id: row.id,
    senderId: row.author_id,
    senderName: row.author_name,
    senderAvatar: '',
    timestamp: timeLabel(row.sent_at),
    sentAt: row.sent_at,
    type: (row.kind as Message['type']) || 'text',
    text: row.kind === 'text' ? row.body ?? undefined : (rich.text as string | undefined),
    isSelf: row.author_id === selfId,
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
    unreadCount: 0,
    messages: [],
  };
}
