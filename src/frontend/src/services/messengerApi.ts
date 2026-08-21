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
  sent_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface NodeIdentity {
  node_id: string;
  bundle: Record<string, unknown>;
}

export interface NodeContact {
  id: string;
  peer_node_id: string;
  display_name: string;
  safety_number: string;
  safety_number_pretty: string;
  verified: boolean;
  session_ready: boolean;
  created_at: string;
}

export const messengerApi = {
  identity: () => request<NodeIdentity>('GET', '/messenger/identity'),

  listContacts: () => request<NodeContact[]>('GET', '/messenger/contacts'),

  addContact: (display_name: string, bundle: Record<string, unknown>) =>
    request<NodeContact>('POST', '/messenger/contacts', { display_name, bundle }),

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
    },
  ) => request<NodeMessage>('POST', `/messenger/conversations/${conversationId}/messages`, body),
};

const timeLabel = (iso: string): string => {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
};

export function messageFromNode(row: NodeMessage, selfId: string): Message {
  return {
    id: row.id,
    senderId: row.author_id,
    senderName: row.author_name,
    senderAvatar: '',
    timestamp: timeLabel(row.sent_at),
    sentAt: row.sent_at,
    type: (row.kind as Message['type']) || 'text',
    text: row.body ?? undefined,
    isSelf: row.author_id === selfId,
    isEdited: Boolean(row.edited_at),
    transport: (row.transport as Message['transport']) ?? undefined,
  };
}

export function chatFromNode(row: NodeConversation): Chat {
  return {
    id: row.id,
    title: row.title,
    handle: row.handle ?? undefined,
    avatar: row.avatar ?? '',
    type: (row.kind as Chat['type']) || 'dm',
    circle: (row.circle as Chat['circle']) || 'all',
    pinned: row.pinned,
    unreadCount: 0,
    messages: [],
  };
}
