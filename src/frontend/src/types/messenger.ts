/**
 * PHANTOM OS — Next-Gen Messenger Types & Contracts
 * Complete types for Chats, Messages, Rich Widgets, Multi-Sphere Personas,
 * власне сховище вузла і транспорт P2P / WebRTC.
 */

export type MessageType =
  | 'text'
  | 'voice'
  | 'location'
  | 'poll'
  | 'event'
  | 'split-bill'
  | 'image'
  | 'code'
  | 'table'
  | 'chart'
  | 'task-list'
  | 'multi-quote'
  | 'file'
  | 'system';

export type ChatCircle = 'all' | 'work' | 'family' | 'friends' | 'study' | 'communities' | 'saved';

export interface SmartFolder {
  id: string;
  name: string;
  emoji: string;
  color?: string; // Hex color or Tailwind accent
  vibe?: string; // e.g. "Focus Mode", "Deep Work", "Chill & Relax"
  isMuted?: boolean;
  isArchived?: boolean;
  chatIds: string[];
  isBuiltIn?: boolean;
  filterRules?: {
    includeCircles?: ChatCircle[];
    unreadOnly?: boolean;
    types?: ChatType[];
    keywords?: string[];
  };
}

export interface LocationDossier {
  title?: string;
  category?: string;
  address?: string;
  vibe?: string;
  bestHours?: string;
  crowdLevel?: string;
  atmosphere?: string[];
  transitTips?: string;
  recommendations?: string;
}

export interface LocationData {
  id?: string;
  name: string;
  category: string;
  address: string;
  distance: string;
  walkingTime: string;
  coords: { lat: number; lng: number };
  hours?: string;
  dossier?: LocationDossier;
}

export interface VoiceData {
  duration: number; // in seconds
  waveform: number[];
  audioUrl?: string;
  storageKey?: string; // ключ у сховищі вузла
  transcript?: string;
  summary?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters: string[];
}

export interface PollData {
  id?: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  closed?: boolean;
  userVotedOptionId?: string;
}

export interface EventAttendee {
  id: string;
  name: string;
  avatar: string;
  status: 'going' | 'maybe' | 'declined' | 'invited';
}

export interface EventData {
  id?: string;
  title: string;
  description?: string;
  date: string;
  time: string;
  endTime?: string;
  location: string;
  attendees: string[];
  attendeeDetails?: EventAttendee[];
  calendarType?: string;
  meetLink?: string;
  sourceMessageText?: string;
  maxCapacity?: number;
}

export interface SplitBillParticipant {
  id: string;
  name: string;
  avatar: string;
  share: number;
  paid: boolean;
}

export interface SplitBillData {
  id?: string;
  title: string;
  totalAmount: number;
  currency: string;
  participants: SplitBillParticipant[];
  paidCount: number;
}

export interface TableColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'badge' | 'date';
}

export interface TableData {
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: Record<string, any>[];
  summaryRow?: Record<string, any>;
}

export interface ChartKey {
  key: string;
  label: string;
  color: string;
}

export interface ChartData {
  title: string;
  type: 'bar' | 'line' | 'area';
  data: Record<string, any>[];
  keys: ChartKey[];
  takeaway?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  assigneeName?: string;
  assigneeAvatar?: string;
  dueDate?: string;
}

export interface TaskListData {
  title: string;
  tasks: TaskItem[];
}

export interface QuotedMessageItem {
  id: string;
  senderName: string;
  senderAvatar?: string;
  timestamp: string;
  text: string;
}

export interface MultiQuoteData {
  title?: string;
  quotes: QuotedMessageItem[];
  synthesis?: {
    keyPoints: string[];
    conclusion: string;
    actionItem?: string;
  };
  commentary?: string;
}

export interface FileData {
  name: string;
  size: string;
  extension: string;
  url?: string;
  storageKey?: string; // ключ у сховищі вузла
  downloadCount?: number;
}

export interface CodeData {
  language: string;
  code: string;
  title?: string;
}

export interface ImageData {
  url: string;
  storageKey?: string; // ключ у сховищі вузла
  caption?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface QuotedMessageSnippet {
  id: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
}

export interface MessageReplyInfo {
  id: string;
  senderName: string;
  text: string;
  type?: MessageType;
  quoteSelectedText?: string;
  quotes?: QuotedMessageSnippet[];
}

export interface ThinkingStage {
  stage: 'perceive' | 'recall' | 'reason' | 'act' | 'write' | 'done';
  label: string;
  active: boolean;
  thoughtLog?: string[];
  toolName?: string;
  durationMs?: number;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  timestamp: string;
  type: MessageType;
  text?: string;
  thinking?: ThinkingStage;
  thoughtTrace?: string[];
  aiSummary?: string;
  voiceData?: VoiceData;
  locationData?: LocationData;
  pollData?: PollData;
  eventData?: EventData;
  splitBillData?: SplitBillData;
  codeData?: CodeData;
  imageData?: ImageData;
  tableData?: TableData;
  chartData?: ChartData;
  taskListData?: TaskListData;
  multiQuoteData?: MultiQuoteData;
  fileData?: FileData;
  ephemeral?: {
    expiresAt: number;
    durationSeconds: number;
  };
  reactions?: Reaction[];
  replyTo?: MessageReplyInfo;
  forwardFrom?: {
    chatTitle: string;
    senderName: string;
  };
  isPinned?: boolean;
  isEdited?: boolean;
  isSelf?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  scheduledTime?: string;
  transport?: 'server' | 'p2p' | 'relay';
  p2pMeta?: {
    latencyMs?: number;
    peerFingerprint?: string;
    directHops?: number;
    encryptedE2E?: boolean;
  };
}

export interface ScheduledMessage {
  id: string;
  chatId: string;
  chatTitle: string;
  chatAvatar?: string;
  senderId?: string;
  senderName?: string;
  scheduledTime: string; // e.g., "Сьогодні о 18:00", "2026-08-20 о 10:00"
  scheduledDate?: string; // ISO format "2026-08-20"
  scheduledExactTime?: string; // "18:00"
  createdAt: string;
  type: MessageType;
  text?: string;
  fileData?: FileData;
  imageData?: ImageData;
  tableData?: TableData;
  chartData?: ChartData;
  pollData?: PollData;
  eventData?: EventData;
  taskListData?: TaskListData;
  splitBillData?: SplitBillData;
  codeData?: CodeData;
}

export type ChatType = 'direct' | 'dm' | 'group' | 'channel' | 'p2p' | 'ai' | 'phantom' | 'call' | 'sms' | 'bridge';
export type ChatCategory = 'all' | 'phantom' | 'calls' | 'sms' | 'bridges' | 'people';

export interface ChatMember {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  customTitle?: string;
  statusText?: string;
  isOnline: boolean;
  phone?: string;
  bio?: string;
}

export interface SharedLinkItem {
  id: string;
  url: string;
  title: string;
  domain: string;
  timestamp: string;
  senderName: string;
}

export type PersonaSphere = 'work' | 'personal' | 'creative' | 'family';

export interface UserProfilePersona {
  id: PersonaSphere;
  title: string;
  name: string;
  handle: string;
  avatar?: string;
  statusText: string;
  statusEmoji: string;
  bio: string;
  jobTitle?: string;
  company?: string;
  pronouns?: string;
  workHours?: string;
  timezone?: string;
  locationName?: string;
  tags?: string[];
  links?: { title: string; url: string; icon?: string }[];
  phoneVisibility: 'everyone' | 'contacts' | 'nobody';
  lastSeenVisibility: 'everyone' | 'contacts' | 'nobody';
}

export interface ActiveDevice {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'web';
  location: string;
  ipAddress: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  status: string;
  statusEmoji: string;
  bio: string;
  phone: string;
  locationName: string;
  batteryLevel: number;
  isMutedAlerts: boolean;
  circleRole?: string;
  personalNotes?: string;
  activePersonaSphere?: PersonaSphere;
  personas?: Record<PersonaSphere, UserProfilePersona>;
  twoFactorEnabled?: boolean;
  storageUsageMb?: {
    media: number;
    files: number;
    voice: number;
    cache: number;
  };
  activeDevices?: ActiveDevice[];
}

export interface GroupPermissions {
  sendMessages: boolean;
  sendMedia: boolean;
  sendStickersAndGifs: boolean;
  sendPolls: boolean;
  embedLinks: boolean;
  addMembers: boolean;
  pinMessages: boolean;
  changeChatInfo: boolean;
}

export interface GroupInviteLink {
  id: string;
  code: string;
  label: string;
  creatorName: string;
  createdAt: string;
  expiresAt?: string;
  usageLimit?: number;
  usageCount: number;
  requireAdminApproval: boolean;
  isPrimary?: boolean;
}

export interface PendingJoinRequest {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userBio?: string;
  requestedAt: string;
  sphereNote?: string;
}

export interface GroupAuditItem {
  id: string;
  actorName: string;
  actorAvatar: string;
  action: string;
  detail: string;
  timestamp: string;
}

export interface GroupTopic {
  id: string;
  title: string;
  iconEmoji: string;
  color: string;
  messageCount: number;
  lastMessageText?: string;
}

export interface Chat {
  id: string;
  title: string;
  handle?: string;
  avatar: string;
  type: ChatType;
  circle: ChatCircle;
  badge?: string;
  isOnline?: boolean;
  lastActive?: string;
  lastSeen?: string;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  unreadCount: number;
  membersCount?: number;
  activeHuddle?: boolean;
  customVibe?: string;
  description?: string;
  topic?: string;
  members?: ChatMember[];
  sharedLinks?: SharedLinkItem[];
  sharedMediaCount?: {
    photos: number;
    files: number;
    links: number;
    audio: number;
    tables: number;
  };
  isPublic?: boolean;
  publicHandle?: string;
  isForum?: boolean;
  topics?: GroupTopic[];
  slowModeSeconds?: number;
  autoDeleteSeconds?: number;
  historyVisibilityForNewMembers?: 'visible' | 'hidden';
  permissions?: GroupPermissions;
  inviteLinks?: GroupInviteLink[];
  pendingJoinRequests?: PendingJoinRequest[];
  auditLogs?: GroupAuditItem[];
  category?: ChatCategory;
  isE2EE?: boolean;
  callDuration?: string;
  callType?: 'incoming' | 'outgoing' | 'missed' | 'voicemail';
  isHot?: boolean;
  aiSecretarySummary?: string;
  sessionId?: string;
  allowedReactions?: 'all' | 'basic' | 'none';
  draft?: string;
  transportMode?: TransportProtocol;
  messages: Message[];
}

export type TransportProtocol = 'auto' | 'server' | 'p2p' | 'relay';
export type ActiveTransportStatus = 'server-ws' | 'p2p-direct' | 'connecting' | 'fallback-server' | 'relay-node' | 'offline';

export interface P2PPeerSession {
  peerId: string;
  peerName: string;
  avatar?: string;
  connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
  iceState: 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';
  dataChannelState: 'connecting' | 'open' | 'closing' | 'closed';
  rttMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsLost?: number;
  fingerprint?: string;
  isDirectP2P: boolean;
  connectedAt?: string;
}

export interface NetworkDiagnostics {
  transportMode: TransportProtocol;
  activeStatus: ActiveTransportStatus;
  /** null, доки не було жодного заміру. */
  latencyMs: number | null;
  connectedClientsCount: number;
  p2pPeersCount: number;
  isWebRTCSupported: boolean;
  isWebSocketConnected: boolean;
  bytesTransferred: {
    server: number;
    p2p: number;
  };
  stunServer: string;
  dataChannelStatus: string;
  relayConnected?: boolean;
  relayNodeId?: string;
}

export interface HuddleParticipant {
  id: string;
  name: string;
  avatar: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasRaisedHand: boolean;
  isVideoOn?: boolean;
  videoStreamUrl?: string;
}

export interface AudioHuddleState {
  active: boolean;
  chatId: string;
  title: string;
  participants: HuddleParticipant[];
  liveTranscript: { speaker: string; text: string; time: string }[];
  isScreenSharing?: boolean;
  isVideoModalOpen?: boolean;
  isRecording?: boolean;
  audioQuality?: 'standard' | 'studio-hd-48khz';
  bandwidthKbps?: number;
}
