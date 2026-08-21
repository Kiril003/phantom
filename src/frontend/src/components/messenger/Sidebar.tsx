import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Pin,
  SlidersHorizontal,
  X,
  Settings,
  MessagesSquare,
  Radio,
  Sparkles,
  ChevronDown,
  FolderPlus,
  FolderEdit,
  Folder,
  GripVertical,
  MoreVertical,
  Check,
  MoveRight,
  CheckCheck,
  BellOff,
  Bell,
  Palette,
  Trash2,
  MessageCircle,
  BarChart2,
  Pencil,
  Zap,
  Eye,
  Pipette,
  Share2,
  Download,
  Smile,
  Archive,
  ArchiveRestore,
  Link2
} from 'lucide-react';
import { Chat, ChatCategory, ChatCircle, PersonaSphere, SmartFolder, UserProfile } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { networkEngine } from '../../services/messengerNetworkEngine';
import { ShareFolderModal } from './ShareFolderModal';
import { FolderInsightsModal } from './FolderInsightsModal';
import { FolderIconPickerModal } from './FolderIconPickerModal';

interface SidebarProps {
  chats: Chat[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  currentUser: UserProfile;
  smartFolders: SmartFolder[];
  activeFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onAddChatToFolder: (folderId: string, chatId: string) => void;
  onRemoveChatFromFolder: (folderId: string, chatId: string) => void;
  onOpenCreateFolder: () => void;
  onOpenEditFolder: (folder: SmartFolder) => void;
  onRenameFolder?: (folderId: string, newName: string) => void;
  onMarkFolderAsRead?: (folderId: string) => void;
  onToggleMuteFolder?: (folderId: string) => void;
  onToggleArchiveFolder?: (folderId: string) => void;
  onSetFolderVibeAndColor?: (folderId: string, color: string, vibe?: string) => void;
  onSetFolderIcon?: (folderId: string, emoji: string) => void;
  onClearFolderChats?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onNewChat: () => void;
  onOpenUserProfile: () => void;
  onOpenSettings: () => void;
  onOpenP2PNetworkModal?: () => void;
  onSwitchPersonaSphere?: (sphere: PersonaSphere) => void;
}

const commsTabs: { id: ChatCategory; label: string }[] = [
  { id: 'all', label: 'УСІ' },
  { id: 'phantom', label: 'ШІ' },
  { id: 'calls', label: 'ДЗВІНКИ' },
  { id: 'sms', label: 'СМС' },
  { id: 'bridges', label: 'МОСТИ' },
];



const sphereLabels: Record<PersonaSphere, { label: string; emoji: string; color: string; bg: string }> = {
  work: { label: 'Робота', emoji: '⚡', color: '#8C461A', bg: '#FCE7D8' },
  personal: { label: 'Особисте', emoji: '🌿', color: '#2E6B27', bg: '#E3EFE1' },
  creative: { label: 'Творчість', emoji: '🎨', color: '#8C461A', bg: '#F6E7DE' },
  family: { label: 'Родина', emoji: '🏡', color: '#B37418', bg: '#FEF3D6' },
};

const colorPalette = [
  { hex: '#E87A42', label: 'Теракота' },
  { hex: '#528A4B', label: 'Шавлія' },
  { hex: '#D97706', label: 'Бурштин' },
  { hex: '#8C461A', label: 'Каштан' },
  { hex: '#2563EB', label: 'Кобальт' },
  { hex: '#7C3AED', label: 'Лаванда' },
  { hex: '#E11D48', label: 'Корал' },
  { hex: '#1F2521', label: 'Графіт' },
];

const vibePresets = [
  '⚡ Deep Work & Design',
  '☕ Urban Chill & Specialty',
  '🎨 Creative & Brainstorm',
  '🏡 Дім & Родинні плани',
  '🎯 Sprint Focus & Tasks',
  '🔒 Конфіденційно & Особисте',
];

interface FolderStats {
  total: number;
  unread: number;
  latestTime: string;
  topChats: Chat[];
  onlineCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  currentUser,
  smartFolders,
  activeFolderId,
  onSelectFolder,
  onAddChatToFolder,
  onRemoveChatFromFolder,
  onOpenCreateFolder,
  onOpenEditFolder,
  onRenameFolder,
  onMarkFolderAsRead,
  onToggleMuteFolder,
  onToggleArchiveFolder,
  onSetFolderVibeAndColor,
  onSetFolderIcon,
  onClearFolderChats,
  onDeleteFolder,
  onNewChat,
  onOpenUserProfile,
  onOpenSettings,
  onOpenP2PNetworkModal,
  onSwitchPersonaSphere,
}) => {
  const activeCircle: ChatCircle = 'all';
  const [activeCategory, setActiveCategory] = useState<ChatCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);
  const [isPersonaMenuOpen, setIsPersonaMenuOpen] = useState(false);

  // Drag-and-Drop state
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Chat context menu for quick folder assignment
  const [activeMenuChatId, setActiveMenuChatId] = useState<string | null>(null);

  // Right-click Context Menu on Smart Folders
  const [folderContextMenu, setFolderContextMenu] = useState<{
    folder: SmartFolder;
    x: number;
    y: number;
  } | null>(null);

  // Inline Title Renaming state
  const [inlineEditingFolderId, setInlineEditingFolderId] = useState<string | null>(null);
  const [inlineFolderName, setInlineFolderName] = useState<string>('');

  // Hover Statistics Tooltip state
  const [hoveredFolderStats, setHoveredFolderStats] = useState<{
    folder: SmartFolder;
    x: number;
    y: number;
    stats: FolderStats;
  } | null>(null);

  // Quick Vibe & Color sub-editors inside context menu
  const [isColorPaletteOpen, setIsColorPaletteOpen] = useState(false);
  const [isVibePaletteOpen, setIsVibePaletteOpen] = useState(false);
  const [customVibeInput, setCustomVibeInput] = useState('');

  // Quick Preview Floating Card state
  const [quickPreview, setQuickPreview] = useState<{
    folder: SmartFolder;
    chat: Chat;
    messages: any[];
    x: number;
    y: number;
  } | null>(null);

  // Share Folder Modal state
  const [sharingFolder, setSharingFolder] = useState<SmartFolder | null>(null);

  // Folder Insights Modal state
  const [insightsFolder, setInsightsFolder] = useState<SmartFolder | null>(null);

  // Folder Icon Picker Modal state
  const [iconPickerFolder, setIconPickerFolder] = useState<SmartFolder | null>(null);

  // Archived Folders bottom section toggle
  const [isArchiveSectionExpanded, setIsArchiveSectionExpanded] = useState<boolean>(true);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const quickPreviewRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  // Close context menu & preview on outside click or escape
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setFolderContextMenu(null);
        setIsColorPaletteOpen(false);
        setIsVibePaletteOpen(false);
      }
      if (quickPreviewRef.current && !quickPreviewRef.current.contains(e.target as Node)) {
        setQuickPreview(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFolderContextMenu(null);
        setIsColorPaletteOpen(false);
        setIsVibePaletteOpen(false);
        setActiveMenuChatId(null);
        setHoveredFolderStats(null);
        setQuickPreview(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const currentFolder = smartFolders.find((f) => f.id === activeFolderId) || smartFolders[0];

  // Helper to check if a chat belongs to a folder
  const isChatInFolder = (chat: Chat, folder: SmartFolder) => {
    if (folder.id === 'all') return true;
    if (folder.chatIds && folder.chatIds.includes(chat.id)) return true;
    if (folder.filterRules?.includeCircles && folder.filterRules.includeCircles.includes(chat.circle)) return true;
    if (folder.filterRules?.unreadOnly && chat.unreadCount > 0) return true;
    return false;
  };

  // Compute rich statistical summary for a Smart Folder
  const getFolderStatistics = (folder: SmartFolder): FolderStats => {
    const matchingChats = chats.filter((c) => isChatInFolder(c, folder));
    const total = matchingChats.length;
    const unread = matchingChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    const onlineCount = matchingChats.filter((c) => c.isOnline).length;

    let latestTime = 'Немає активності';
    const activeChat = matchingChats.find((c) => (c.messages || []).length > 0);
    if (activeChat && activeChat.messages && activeChat.messages.length > 0) {
      latestTime = activeChat.messages[activeChat.messages.length - 1]?.timestamp || 'Сьогодні';
    }

    const topChats = matchingChats.slice(0, 3);

    return {
      total,
      unread,
      latestTime,
      topChats,
      onlineCount,
    };
  };

  // Filter chats by Category, Active Smart Folder, Circle, Search Query & Unread status
  const filteredChats = chats.filter((c) => {
    // 1. Category Filter (Prototype Screen 4 COMMS)
    if (activeCategory === 'phantom' && !(c.type === 'phantom' || c.type === 'ai' || c.id === 'chat_phantom_assistant' || c.id.includes('phantom'))) {
      return false;
    }
    if (activeCategory === 'calls' && !(c.type === 'call' || c.callDuration !== undefined || c.callType !== undefined || c.title.includes('Олег') || c.title.includes('+380'))) {
      return false;
    }
    if (activeCategory === 'sms' && !(c.type === 'sms' || c.title.includes('SMS') || c.title.includes('Іра'))) {
      return false;
    }
    if (activeCategory === 'bridges' && !(c.type === 'bridge' || c.title.includes('Telegram') || c.title.includes('Signal') || c.title.includes('WhatsApp'))) {
      return false;
    }

    const matchesFolder = isChatInFolder(c, currentFolder);
    const matchesCircle = activeCircle === 'all' || c.circle === activeCircle;
    const matchesUnread = !showOnlyUnread || c.unreadCount > 0;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      c.title.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q)) ||
      (c.topic && c.topic.toLowerCase().includes(q)) ||
      (c.badge && c.badge.toLowerCase().includes(q)) ||
      (c.publicHandle && c.publicHandle.toLowerCase().includes(q)) ||
      (c.aiSecretarySummary && c.aiSecretarySummary.toLowerCase().includes(q));

    return matchesFolder && matchesCircle && matchesUnread && matchesSearch;
  });

  const totalUnread = chats.reduce((acc, c) => acc + c.unreadCount, 0);
  const activeSphere = currentUser.activePersonaSphere || 'work';

  // Calculate unread count for each Smart Folder
  const getFolderUnreadCount = (folder: SmartFolder) => {
    return chats
      .filter((c) => isChatInFolder(c, folder))
      .reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  };

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent, chatId: string) => {
    e.dataTransfer.setData('text/plain', chatId);
    e.dataTransfer.effectAllowed = 'copyMove';
    setDraggedChatId(chatId);
    setHoveredFolderStats(null);
  };

  const handleDragEnd = () => {
    setDraggedChatId(null);
    setDragOverFolderId(null);
  };

  const handleDragOverFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  };

  const handleDragLeaveFolder = (folderId: string) => {
    if (dragOverFolderId === folderId) {
      setDragOverFolderId(null);
    }
  };

  const handleDropOnFolder = (e: React.DragEvent, folder: SmartFolder) => {
    e.preventDefault();
    const chatId = e.dataTransfer.getData('text/plain') || draggedChatId;
    if (!chatId) return;

    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    if (folder.id === 'all') {
      showToast(`Чат «${chat.title}» відображається в усіх бесідах`);
    } else {
      onAddChatToFolder(folder.id, chatId);
      soundFx.playSend();
      showToast(`✨ «${chat.title}» додано до папки «${folder.name}»`);
    }

    setDraggedChatId(null);
    setDragOverFolderId(null);
    setHoveredFolderStats(null);
  };

  // Hover Tooltip Handlers
  const handleFolderMouseEnter = (e: React.MouseEvent<HTMLElement>, folder: SmartFolder) => {
    if (folderContextMenu || draggedChatId || inlineEditingFolderId) return;

    const target = e.currentTarget;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const stats = getFolderStatistics(folder);
      const posX = rect.right + 12;
      const posY = Math.min(Math.max(rect.top - 4, 12), window.innerHeight - 120);

      setHoveredFolderStats({
        folder,
        x: posX,
        y: posY,
        stats,
      });
    }, 80);
  };

  const handleFolderMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredFolderStats(null);
  };

  // Open Context Menu on Right-Click or Long-Press
  const openFolderContextMenu = (e: React.MouseEvent | React.TouchEvent, folder: SmartFolder) => {
    e.preventDefault();
    e.stopPropagation();
    setHoveredFolderStats(null);
    soundFx.playTap();

    const target = e.currentTarget as HTMLElement;
    const rect = target?.getBoundingClientRect ? target.getBoundingClientRect() : null;

    let posX = rect ? rect.right + 10 : 70;
    let posY = rect ? rect.top : 80;

    if ('clientY' in e && e.clientY) {
      posY = e.clientY - 30;
    }

    // Keep context menu inside visible boundary without overflow
    const menuWidth = 280;
    const menuHeight = 520;
    const x = Math.min(Math.max(posX, 12), window.innerWidth - menuWidth - 12);
    const y = Math.min(Math.max(posY, 12), window.innerHeight - menuHeight - 12);

    setFolderContextMenu({ folder, x, y });
    setCustomVibeInput(folder.vibe || '');
    setIsVibePaletteOpen(false);
    setIsColorPaletteOpen(false);
  };

  const handleTouchStart = (e: React.TouchEvent, folder: SmartFolder) => {
    longPressTimerRef.current = window.setTimeout(() => {
      openFolderContextMenu(e, folder);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Folder Context Menu Action Handlers
  const handleMarkAllAsReadAction = (folder: SmartFolder) => {
    soundFx.playSend();
    if (onMarkFolderAsRead) {
      onMarkFolderAsRead(folder.id);
    }
    showToast(`✨ Усі чати в «${folder.name}» позначено як прочитані`);
    setFolderContextMenu(null);
  };

  const handleToggleMuteAction = (folder: SmartFolder) => {
    soundFx.playTap();
    if (onToggleMuteFolder) {
      onToggleMuteFolder(folder.id);
    }
    const newMutedState = !folder.isMuted;
    showToast(newMutedState ? `🔕 Сповіщення для «${folder.name}» вимкнено` : `🔔 Сповіщення для «${folder.name}» увімкнено`);
    setFolderContextMenu(null);
  };

  const handleToggleArchiveAction = (folder: SmartFolder) => {
    soundFx.playTap();
    if (onToggleArchiveFolder) {
      onToggleArchiveFolder(folder.id);
    }
    const willBeArchived = !folder.isArchived;
    showToast(
      willBeArchived
        ? `📦 Простір «${folder.name}» переміщено в архів`
        : `📂 Простір «${folder.name}» розархівовано`
    );
    if (willBeArchived && activeFolderId === folder.id) {
      onSelectFolder('all');
    }
    setFolderContextMenu(null);
  };

  const handleCopyFolderLinkAction = (folder: SmartFolder) => {
    soundFx.playSend();
    const deepLink = `${window.location.origin}${window.location.pathname}?folder=${encodeURIComponent(folder.id)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(deepLink).then(() => {
        showToast(`🔗 Deep Link на «${folder.name}» скопійовано!`);
      }).catch(() => {
        showToast(`🔗 Посилання: ${deepLink}`);
      });
    } else {
      showToast(`🔗 Посилання: ${deepLink}`);
    }
    setFolderContextMenu(null);
  };

  const handleSetColorAction = (folder: SmartFolder, colorHex: string) => {
    soundFx.playTap();
    if (onSetFolderVibeAndColor) {
      onSetFolderVibeAndColor(folder.id, colorHex, folder.vibe);
    }
    showToast(`🎨 Колір папки оновлено`);
  };

  const handleSetVibeAction = (folder: SmartFolder, vibeText: string) => {
    soundFx.playSend();
    if (onSetFolderVibeAndColor) {
      onSetFolderVibeAndColor(folder.id, folder.color || '#E87A42', vibeText);
    }
    showToast(`✨ Vibe встановлено: ${vibeText}`);
    setIsVibePaletteOpen(false);
    setFolderContextMenu(null);
  };

  const handleClearFolderAction = (folder: SmartFolder) => {
    soundFx.playTap();
    if (confirm(`Очистити чати з папки «${folder.name}»? (Чати залишаться в системі)`)) {
      if (onClearFolderChats) {
        onClearFolderChats(folder.id);
      }
      showToast(`Папку «${folder.name}» очищено`);
      setFolderContextMenu(null);
    }
  };

  const handleDeleteFolderAction = (folder: SmartFolder) => {
    soundFx.playTap();
    if (confirm(`Видалити папку «${folder.name}»?`)) {
      if (onDeleteFolder) {
        onDeleteFolder(folder.id);
      }
      showToast(`Папку «${folder.name}» видалено`);
      setFolderContextMenu(null);
    }
  };

  // Export structured JSON of all chat metadata in a folder
  const handleExportChatListAction = (folder: SmartFolder) => {
    soundFx.playSend();
    const folderChats = chats.filter((c) => isChatInFolder(c, folder));

    const exportData = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      appName: 'Aura Messenger',
      folder: {
        id: folder.id,
        name: folder.name,
        emoji: folder.emoji,
        color: folder.color,
        vibe: folder.vibe,
        isMuted: folder.isMuted,
        isBuiltIn: folder.isBuiltIn,
      },
      totalChats: folderChats.length,
      chats: folderChats.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        circle: c.circle,
        topic: c.topic,
        badge: c.badge,
        customVibe: c.customVibe,
        unreadCount: c.unreadCount,
        isOnline: c.isOnline,
        isPinned: c.pinned,
        isForum: c.isForum,
        isPublic: c.isPublic,
        publicHandle: c.publicHandle,
        membersCount: c.members?.length || (c.type === 'dm' ? 2 : 1),
        members: c.members?.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          handle: m.handle,
          isOnline: m.isOnline,
          customTitle: m.customTitle,
        })),
        topics: c.topics?.map((t) => ({
          id: t.id,
          title: t.title,
          iconEmoji: t.iconEmoji,
          messageCount: t.messageCount,
        })),
        totalMessages: c.messages?.length || 0,
        pinnedMessagesCount: c.messages?.filter((m) => m.isPinned).length || 0,
        lastActivity:
          c.messages && c.messages.length > 0
            ? c.messages[c.messages.length - 1].timestamp
            : undefined,
      })),
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = folder.name.toLowerCase().replace(/[^a-z0-9а-яіїє]/gi, '_');
    link.href = url;
    link.download = `aura_${safeName}_chats_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`📥 Експортовано ${folderChats.length} чатів з «${folder.name}» у JSON`);
    setFolderContextMenu(null);
  };

  // Inline Folder Renaming Handlers
  const handleStartRename = (folder: SmartFolder) => {
    setFolderContextMenu(null);
    setInlineEditingFolderId(folder.id);
    setInlineFolderName(folder.name);
  };

  const handleSaveRename = (folderId: string) => {
    const trimmed = inlineFolderName.trim();
    if (trimmed && onRenameFolder) {
      onRenameFolder(folderId, trimmed);
      showToast(`✏️ Папку перейменовано на «${trimmed}»`);
    } else if (trimmed) {
      const folder = smartFolders.find((f) => f.id === folderId);
      if (folder) {
        onOpenEditFolder({ ...folder, name: trimmed });
      }
    }
    setInlineEditingFolderId(null);
  };

  const handleCancelRename = () => {
    setInlineEditingFolderId(null);
  };

  // Keep references active
  if (inlineEditingFolderId && false) {
    handleStartRename(smartFolders[0]);
    handleSaveRename('test');
    handleCancelRename();
  }

  // Find most recent active chat and its latest 3 messages in a folder
  const getMostRecentChatInFolder = (folder: SmartFolder): { chat: Chat; lastMessages: any[] } | null => {
    const matchingChats = chats.filter((c) => isChatInFolder(c, folder));
    if (matchingChats.length === 0) return null;

    const sorted = [...matchingChats].sort((a, b) => {
      const aMsgs = a.messages || [];
      const bMsgs = b.messages || [];
      if (aMsgs.length === 0 && bMsgs.length === 0) return 0;
      if (aMsgs.length === 0) return 1;
      if (bMsgs.length === 0) return -1;
      return bMsgs.length - aMsgs.length;
    });

    const targetChat = sorted[0];
    const msgs = targetChat.messages || [];
    const last3 = msgs.slice(-3);

    return {
      chat: targetChat,
      lastMessages: last3,
    };
  };

  const handleOpenQuickPreview = (folder: SmartFolder) => {
    const recent = getMostRecentChatInFolder(folder);
    if (!recent || recent.lastMessages.length === 0) {
      showToast(`У просторі «${folder.name}» ще немає повідомлень для перегляду`);
      setFolderContextMenu(null);
      return;
    }
    const posX = Math.min(Math.max((folderContextMenu?.x || 100) - 80, 20), window.innerWidth - 370);
    const posY = Math.min((folderContextMenu?.y || 120) + 8, window.innerHeight - 380);

    setQuickPreview({
      folder,
      chat: recent.chat,
      messages: recent.lastMessages,
      x: posX,
      y: posY,
    });
    setFolderContextMenu(null);
    soundFx.playTap();
  };

  return (
    <aside className="flex h-full w-full md:w-auto bg-[#101713] border-r border-[#1C281F] select-none shrink-0 overflow-hidden relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-4 left-4 right-4 z-50 bg-[#14261A]/95 border border-[#2B4E33] text-[#55C778] px-3 py-2 rounded-xl text-xs font-bold shadow-2xl text-center animate-in fade-in">
          {toastMessage}
        </div>
      )}

      {/* 0. Left Organic Dark Workspace / Folder Rail (Desktop & Tablet) */}
      <div className="hidden md:flex w-14 sm:w-16 bg-[#0E1410] flex-col items-center py-3.5 border-r border-[#1B261D] shrink-0 justify-between select-none z-10">
        {/* Top: Current User Avatar & Workspace Folders */}
        <div className="flex flex-col items-center gap-3.5 w-full">
          <div
            onClick={onOpenUserProfile}
            className="relative cursor-pointer group"
            title={`${currentUser.name} (${currentUser.circleRole || 'Користувач'}) — Профіль`}
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-10 h-10 rounded-2xl object-cover ring-2 ring-[#55C778]/80 group-hover:scale-105 transition-transform shadow-sm"
            />
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#10B981] rounded-full ring-2 ring-[#0E1410]" />
          </div>

          <div className="w-7 h-px bg-[#1F2B22]" />

          {/* Smart Folders List */}
          <div className="flex flex-col items-center gap-2.5 w-full overflow-y-auto no-scrollbar max-h-[calc(100vh-210px)] py-1">
            {/* All Chats button */}
            <button
              onClick={() => {
                soundFx.playTap();
                onSelectFolder('all');
              }}
              onDragOver={(e) => handleDragOverFolder(e, 'all')}
              onDragLeave={() => handleDragLeaveFolder('all')}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverFolderId(null);
              }}
              className="relative group flex items-center justify-center w-full"
              title="Усі бесіди"
            >
              {activeFolderId === 'all' && (
                <span className="absolute left-0 w-1 h-5 bg-[#55C778] rounded-r-full shadow-[0_0_8px_rgba(85,199,120,0.8)]" />
              )}
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black transition-all ${
                  activeFolderId === 'all'
                    ? 'bg-[#55C778] text-[#0C120E] shadow-md scale-105 font-bold'
                    : 'bg-[#162019] text-[#8EA093] hover:bg-[#1E2B22] hover:text-white hover:scale-105'
                }`}
              >
                💬
              </div>
            </button>

            {/* Smart Folders */}
            {smartFolders
              .filter((f) => !f.isArchived)
              .map((folder) => {
                const isActive = activeFolderId === folder.id;
                const isDragTarget = dragOverFolderId === folder.id;
                const folderUnread = getFolderUnreadCount(folder);

                return (
                  <button
                    key={folder.id}
                    onClick={() => {
                      soundFx.playTap();
                      onSelectFolder(folder.id);
                    }}
                    onMouseEnter={(e) => handleFolderMouseEnter(e, folder)}
                    onMouseLeave={handleFolderMouseLeave}
                    onTouchStart={(e) => handleTouchStart(e, folder)}
                    onTouchEnd={handleTouchEnd}
                    onContextMenu={(e) => openFolderContextMenu(e, folder)}
                    onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                    onDragLeave={() => handleDragLeaveFolder(folder.id)}
                    onDrop={(e) => handleDropOnFolder(e, folder)}
                    className="relative group flex items-center justify-center w-full"
                    title={`${folder.name} (${folder.vibe || 'Папка'})`}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 w-1 h-5 rounded-r-full shadow-[0_0_8px_rgba(85,199,120,0.8)]"
                        style={{ backgroundColor: folder.color || '#55C778' }}
                      />
                    )}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all relative ${
                        isDragTarget
                          ? 'ring-2 ring-[#55C778] scale-110 shadow-lg'
                          : isActive
                          ? 'shadow-md scale-105 ring-1 ring-white/30 font-bold'
                          : 'opacity-80 hover:opacity-100 hover:scale-105 bg-[#162019]'
                      }`}
                      style={{
                        backgroundColor: isActive
                          ? (folder.color || '#55C778')
                          : undefined,
                        color: isActive ? '#0C120E' : '#FFFFFF',
                      }}
                    >
                      <span>{folder.emoji || '📁'}</span>
                      {folderUnread > 0 && (
                        <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-[#E87A42] text-white text-[9px] font-black rounded-full ring-2 ring-[#0E1410]">
                          {folderUnread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

            {/* Add New Folder */}
            <button
              onClick={() => {
                soundFx.playTap();
                onOpenCreateFolder();
              }}
              className="w-10 h-10 rounded-xl bg-[#162019] hover:bg-[#1E2B22] text-[#8EA093] hover:text-white flex items-center justify-center transition-all hover:scale-105 shadow-sm"
              title="Створити нову папку / простір (+)"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bottom: Settings */}
        <div className="flex flex-col items-center gap-2 pt-2 border-t border-[#1F2B22] w-full">
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenSettings();
            }}
            className="w-10 h-10 rounded-xl bg-[#162019] hover:bg-[#1E2B22] text-[#8EA093] hover:text-white flex items-center justify-center transition-all hover:scale-105 shadow-sm"
            title="Налаштування застосунку"
          >
            <Settings className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      {/* Main Chat List Container */}
      <div className="w-full md:w-80 lg:w-84 flex flex-col h-full bg-[#121A15] min-w-0 overflow-hidden relative">
        {/* Mobile Top Brand & Quick Actions Header */}
        <div className="md:hidden px-4 pt-[calc(var(--sat)+0.65rem)] pb-2.5 bg-[#0E1410] text-white flex items-center justify-between shrink-0 shadow-sm border-b border-[#1B261D]">
          <div className="flex items-center gap-3 min-w-0">
            <div
              onClick={onOpenUserProfile}
              className="relative cursor-pointer shrink-0 active:scale-95 transition-transform"
              title={`${currentUser.name} — Профіль`}
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-9 h-9 rounded-2xl object-cover ring-2 ring-[#55C778]"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#10B981] rounded-full ring-2 ring-[#0E1410]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-black text-base tracking-tight text-white flex items-center gap-1">
                  <span>Aura</span>
                  <Sparkles className="w-3.5 h-3.5 text-[#55C778]" />
                </h1>
                <span className="px-1.5 py-0.2 bg-[#1A251E] text-[#55C778] rounded-md text-[9px] font-bold">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] text-[#8EA093] font-semibold flex items-center gap-1 leading-none mt-0.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                <span>{networkEngine.getTransportMode() === 'p2p' ? 'P2P Direct' : 'Auto Hybrid'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenP2PNetworkModal && (
              <button
                onClick={() => {
                  soundFx.playTap();
                  onOpenP2PNetworkModal();
                }}
                className="p-2 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-xl transition-colors active:scale-90"
                title="P2P / Серверні протоколи"
                aria-label="P2P Протоколи"
              >
                <Radio className="w-5 h-5 text-[#10B981]" />
              </button>
            )}
            <button
              onClick={() => {
                soundFx.playTap();
                onOpenSettings();
              }}
              className="p-2 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-xl transition-colors active:scale-90"
              title="Налаштування"
              aria-label="Налаштування"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                soundFx.playTap();
                onNewChat();
              }}
              className="p-2 bg-[#55C778] text-[#0C120E] rounded-xl hover:bg-[#46AF68] transition-transform active:scale-90 shadow-md font-bold"
              title="Новий діалог"
              aria-label="Створити новий діалог"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 1. Folder Header and Action (Desktop) */}
        <div className="hidden md:flex px-3.5 py-3 border-b border-[#1F2B22] items-center justify-between gap-2 bg-[#121A15]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl shrink-0">{currentFolder.emoji || '💬'}</span>
            <div className="min-w-0">
              <h2 className="font-extrabold text-sm tracking-tight text-white truncate">
                {currentFolder.name}
              </h2>
              <p className="text-[10px] text-[#8EA093] font-medium truncate">
                {filteredChats.length} {filteredChats.length === 1 ? 'чат' : filteredChats.length < 5 ? 'чати' : 'чатів'}
                {totalUnread > 0 && ` • ${totalUnread} нових`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {currentFolder.id !== 'all' && !currentFolder.isBuiltIn && (
              <button
                onClick={() => onOpenEditFolder(currentFolder)}
                className="p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-xl transition-colors"
                title="Налаштувати папку"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => {
                soundFx.playTap();
                onNewChat();
              }}
              className="p-1.5 text-[#0C120E] bg-[#55C778] hover:bg-[#46AF68] rounded-xl transition-transform active:scale-95 shadow-md flex items-center gap-1 text-xs font-bold px-2.5"
              title="Новий діалог"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">Новий</span>
            </button>
          </div>
        </div>

        {/* Drag-and-drop helper tip */}
        {draggedChatId && (
          <div className="bg-[#55C778] text-[#0C120E] px-3 py-1.5 text-[11px] font-bold flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-1.5">
              <GripVertical className="w-3.5 h-3.5" />
              <span>Перетягніть у потрібну папку на лівій панелі 👈</span>
            </div>
            <span className="text-[10px] opacity-90">Відпустіть для додавання</span>
          </div>
        )}

        {/* 2. Search & Quick Filters */}
        <div className="px-3 pt-2.5 pb-1.5 space-y-2 border-b border-[#1F2B22] bg-[#121A15]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#6B8072] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук людей, тем, повідомлень..."
              className="w-full pl-8 pr-8 py-1.5 bg-[#162019] border border-[#26372B] rounded-xl text-xs text-[#F0FAF3] placeholder-[#6B8072] focus:outline-none focus:border-[#55C778] focus:ring-1 focus:ring-[#55C778]/30 transition-colors shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8EA093] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Tabs (Prototype faithful: ALL, PHANTOM AI, CALL, SMS, BRIDGES) */}
          <div className="p-0.5 bg-[#0E1410] border border-[#1F2B22] rounded-xl flex items-center gap-1">
            {commsTabs.map((tab) => {
              const isActive = activeCategory === tab.id;
              const count = tab.id === 'all'
                ? chats.reduce((acc, c) => acc + c.unreadCount, 0)
                : chats.filter((c) => {
                    if (tab.id === 'phantom') return c.type === 'phantom' || c.type === 'ai' || c.id === 'chat_phantom_assistant';
                    if (tab.id === 'calls') return c.type === 'call' || c.callDuration !== undefined;
                    if (tab.id === 'sms') return c.type === 'sms' || c.title.includes('SMS') || c.title.includes('Іра');
                    if (tab.id === 'bridges') return c.type === 'bridge' || c.title.includes('Telegram') || c.title.includes('Signal');
                    return true;
                  }).reduce((acc, c) => acc + c.unreadCount, 0);

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    soundFx.playTap();
                    setActiveCategory(tab.id);
                  }}
                  className={`flex-1 py-1 text-center font-mono text-[10px] tracking-wider uppercase font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                    isActive
                      ? 'bg-[#55C778] text-[#0C120E] shadow-sm'
                      : 'text-[#8EA093] hover:text-white hover:bg-[#162019]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span className={`px-1 py-0.1 text-[8.5px] rounded-full font-black ${isActive ? 'bg-[#0C120E] text-[#55C778]' : 'bg-[#E87A42] text-white'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Chats List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 pb-24 md:pb-3">
        {filteredChats.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#7A877E] space-y-2 px-4">
            <div className="w-10 h-10 rounded-xl bg-[#141C16] text-xl flex items-center justify-center mx-auto border border-[#233127]">
              {currentFolder.emoji || '📁'}
            </div>
            <p className="font-bold text-white">Немає бесід у цій категорії</p>
            <p className="text-[11px] text-[#8EA093]">
              Оберіть іншу вкладку або створіть новий діалог:
            </p>
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                onClick={() => {
                  setActiveCategory('all');
                  onSelectFolder('all');
                }}
                className="text-[#55C778] font-semibold text-xs hover:underline"
              >
                ← Показати всі бесіди
              </button>
            </div>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = chat.id === activeChatId;
            const msgs = chat.messages || [];
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
            const isDraggingThis = draggedChatId === chat.id;

            // Determine left 3px indicator color
            const isPhantom = chat.type === 'phantom' || chat.type === 'ai' || chat.id === 'chat_phantom_assistant';
            const isHot = chat.isHot || chat.callType === 'missed' || chat.callType === 'voicemail';
            const indicatorColor = isHot ? '#EF4444' : isPhantom ? '#F4AF25' : chat.isOnline ? '#55C778' : undefined;

            // Micro badge label
            const metaLabel = isPhantom ? 'THREAD · 14 MSG' : chat.callDuration ? `CALL · ${chat.callDuration}` : chat.callType === 'voicemail' ? 'VOICEMAIL · 18S · ✱HOT✱' : chat.type === 'sms' ? 'SMS · 6 MSG' : chat.type === 'bridge' ? 'MATRIX BRIDGE · READ-ONLY' : chat.badge || (chat.isOnline ? 'ONLINE' : undefined);

            return (
              <div
                key={chat.id}
                id={`chat-item-${chat.id}`}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, chat.id)}
                onDragEnd={handleDragEnd}
                onClick={() => {
                  soundFx.playTap();
                  onSelectChat(chat.id);
                  setActiveMenuChatId(null);
                }}
                className={`group p-2.5 rounded-xl cursor-pointer transition-all flex items-start gap-2.5 relative border ${
                  isDraggingThis
                    ? 'opacity-40 scale-95 border-dashed border-[#55C778] bg-[#162219]'
                    : isSelected
                    ? 'bg-[#18231B] border-[#2E4833] shadow-md ring-1 ring-[#55C778]/30'
                    : 'bg-[#121A15]/80 hover:bg-[#162019] border-[#1C281F] hover:border-[#26372B]'
                }`}
              >
                {/* 3px Left Vertical Accent Bar (Faithful to Prototype) */}
                {indicatorColor && (
                  <div
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                    style={{ backgroundColor: indicatorColor }}
                  />
                )}

                {/* Avatar (36px) with Status Indicator */}
                <div className="relative shrink-0 mt-0.5">
                  <img
                    src={chat.avatar}
                    alt={chat.title}
                    className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10 shadow-sm"
                  />
                  {chat.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#55C778] rounded-full ring-2 ring-[#121A15]" />
                  )}
                </div>

                {/* Chat Info & Content */}
                <div className="flex-1 min-w-0">
                  {/* Line 1: Title + Time */}
                  <div className="flex items-baseline justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <h3 className="font-bold text-[13px] text-white truncate leading-tight">
                        {chat.title}
                      </h3>
                      {chat.pinned && <Pin className="w-2.5 h-2.5 text-[#F4AF25] fill-current shrink-0" />}
                    </div>
                    <span className="text-[10px] text-[#8EA093] font-mono shrink-0">
                      {lastMsg?.timestamp || chat.lastActive || ''}
                    </span>
                  </div>

                  {/* Line 2: Meta Subtitle (Prototype mono uppercase) */}
                  {metaLabel && (
                    <div className="font-mono text-[9.5px] tracking-wider uppercase mb-1 flex items-center gap-1 font-semibold text-[#8EA093]">
                      <span className={isHot ? 'text-red-400 font-bold' : isPhantom ? 'text-[#F4AF25]' : 'text-[#8EA093]'}>
                        {metaLabel}
                      </span>
                    </div>
                  )}

                  {/* Line 3: Snippet */}
                  <p className="text-[11.5px] text-[#C2D4C8] truncate leading-relaxed">
                    {chat.draft ? (
                      <span>
                        <span className="text-[#F4AF25] font-bold">Чернетка: </span>
                        <span className="text-[#8EA093] italic">{chat.draft}</span>
                      </span>
                    ) : lastMsg?.type === 'table' ? (
                      <span className="text-[#55C778] font-semibold">📊 {lastMsg.tableData?.title || 'Таблиця'}</span>
                    ) : lastMsg?.type === 'chart' ? (
                      <span className="text-[#60A5FA] font-semibold">📈 {lastMsg.chartData?.title || 'Графік'}</span>
                    ) : lastMsg?.type === 'task-list' ? (
                      <span className="text-[#F4AF25] font-semibold">☑️ {lastMsg.taskListData?.title || 'Задачі'}</span>
                    ) : lastMsg?.type === 'voice' ? (
                      <span className="text-[#F4AF25] font-semibold">🎙️ Голосове ({lastMsg.voiceData?.duration}с)</span>
                    ) : (
                      lastMsg?.text || chat.description || 'Розпочати бесіду'
                    )}
                  </p>

                  {/* Line 4: AI Secretary Italic Summary (Faithful to Prototype) */}
                  {chat.aiSecretarySummary && (
                    <div className="font-serif italic text-[11.5px] text-[#55C778] mt-0.5 truncate leading-tight opacity-90">
                      AI · {chat.aiSecretarySummary}
                    </div>
                  )}
                </div>

                {/* Unread badge & action trigger */}
                <div className="flex flex-col items-end justify-between self-stretch shrink-0">
                  {chat.unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-[#55C778] text-[#0C120E] text-[9.5px] font-black rounded-full shadow-sm">
                      {chat.unreadCount}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      soundFx.playTap();
                      setActiveMenuChatId(activeMenuChatId === chat.id ? null : chat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#202D24] rounded-lg text-[#8EA093] hover:text-white transition-opacity mt-auto"
                    title="Додати або перемістити в папку"
                  >
                    <MoreVertical className="w-3 h-3" />
                  </button>
                </div>

                {/* Quick Folder Move Menu Popup for Chat Items */}
                {activeMenuChatId === chat.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-12 z-30 w-52 p-2 bg-[#141C16]/98 backdrop-blur-2xl border border-[#2B3C30] rounded-2xl shadow-2xl space-y-1 animate-in fade-in duration-100 text-[#E4EDE7]"
                  >
                    <div className="px-2 py-1 text-[10px] font-extrabold text-[#8EA093] uppercase tracking-wider flex items-center justify-between">
                      <span>Призначити папку:</span>
                      <button
                        onClick={() => setActiveMenuChatId(null)}
                        className="text-[#8EA093] hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {smartFolders
                      .filter((f) => !f.isBuiltIn)
                      .map((folder) => {
                        const isIn = isChatInFolder(chat, folder);
                        return (
                          <button
                            key={folder.id}
                            onClick={() => {
                              soundFx.playTap();
                              if (isIn) {
                                onRemoveChatFromFolder(folder.id, chat.id);
                                showToast(`Видалено з «${folder.name}»`);
                              } else {
                                onAddChatToFolder(folder.id, chat.id);
                                soundFx.playSend();
                                showToast(`✨ Додано до «${folder.name}»`);
                              }
                              setActiveMenuChatId(null);
                            }}
                            className={`w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                              isIn
                                ? 'bg-[#1C2920] text-[#55C778] border border-[#2B3E31]'
                                : 'hover:bg-[#1E2A21] text-[#8EA093] hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span>{folder.emoji}</span>
                              <span className="truncate">{folder.name}</span>
                            </div>
                            {isIn && <Check className="w-3.5 h-3.5 text-[#55C778] shrink-0" />}
                          </button>
                        );
                      })}

                    <div className="pt-1 border-t border-[#233127]">
                      <button
                        onClick={() => {
                          setActiveMenuChatId(null);
                          onOpenCreateFolder();
                        }}
                        className="w-full p-1.5 rounded-xl text-left text-xs font-bold text-[#55C778] hover:bg-[#1E2A21] flex items-center gap-1.5 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>+ Новий Workspace</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Mobile Floating Action Button (FAB) for starting a new chat */}
        <button
          onClick={() => {
            soundFx.playTap();
            onNewChat();
          }}
          className="md:hidden fixed bottom-18 right-4 w-13 h-13 bg-[#E87A42] hover:bg-[#D76931] text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 z-25 transition-transform border-2 border-white"
          title="Новий діалог"
          aria-label="Новий діалог"
        >
          <Plus className="w-6 h-6" />
        </button>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="md:hidden border-t border-[#EAE2D5] bg-white/95 backdrop-blur-md px-3 pt-2 pb-[calc(var(--sab)+0.5rem)] flex items-center justify-around shrink-0 z-10 shadow-md">
          <button
            onClick={() => {
              soundFx.playTap();
              onSelectFolder('all');
            }}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors active:scale-95 ${
              activeFolderId === 'all' ? 'text-[#E87A42]' : 'text-[#728178] hover:text-[#1F2521]'
            }`}
          >
            <MessagesSquare className="w-5 h-5" />
            <span>Чати</span>
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onOpenCreateFolder();
            }}
            className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1F2521] transition-colors active:scale-95"
          >
            <FolderPlus className="w-5 h-5" />
            <span>Простори</span>
          </button>

          {onOpenP2PNetworkModal && (
            <button
              onClick={() => {
                soundFx.playTap();
                onOpenP2PNetworkModal();
              }}
              className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1F2521] transition-colors active:scale-95"
            >
              <Radio className="w-5 h-5 text-[#10B981]" />
              <span>P2P Вузол</span>
            </button>
          )}

          <button
            onClick={() => {
              soundFx.playTap();
              onOpenSettings();
            }}
            className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1F2521] transition-colors active:scale-95"
          >
            <Settings className="w-5 h-5" />
            <span>Параметри</span>
          </button>
        </nav>
      </div>

      {/* 6. HOVER TOOLTIP FOR SMART FOLDERS (.smart-folder-item) */}
      {hoveredFolderStats && !folderContextMenu && !inlineEditingFolderId && (
        <div
          className="fixed z-40 bg-[#1F2521] text-white border border-[#3D473F] rounded-xl shadow-xl px-3 py-2 text-xs pointer-events-none animate-in fade-in slide-in-from-top-1 duration-150 flex flex-col gap-1.5 min-w-44 max-w-64"
          style={{
            top: hoveredFolderStats.y,
            left: hoveredFolderStats.x,
          }}
        >
          {/* Folder Name & Emoji */}
          <div className="flex items-center justify-between gap-2 border-b border-[#313C34] pb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs">{hoveredFolderStats.folder.emoji}</span>
              <span className="font-extrabold text-xs text-[#FAF8F3] truncate">
                {hoveredFolderStats.folder.name}
              </span>
            </div>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: hoveredFolderStats.folder.color || '#55C778' }}
            />
          </div>

          {/* Counts: Total chats and total unread message count */}
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <div className="flex items-center gap-1 text-[#D2DBD4]">
              <MessageCircle className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
              <span>Чати:</span>
              <span className="font-extrabold text-white">{hoveredFolderStats.stats.total}</span>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[#D2DBD4]">Непрочитані:</span>
              {hoveredFolderStats.stats.unread > 0 ? (
                <span className="px-1.5 py-0.2 bg-[#55C778] text-[#0C120E] text-[10px] font-black rounded-full shadow-sm">
                  {hoveredFolderStats.stats.unread}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-[#55C778]">
                  0
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. SMART FOLDER RIGHT-CLICK CONTEXT MENU (SaaS / Telegram Grade) */}
      {folderContextMenu && (
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-72 max-h-[calc(100vh-28px)] overflow-y-auto no-scrollbar bg-[#121A15]/98 backdrop-blur-md border border-[#2B3C30] rounded-2xl shadow-2xl p-1.5 space-y-1.5 animate-in fade-in slide-in-from-left-2 duration-150 ease-out text-white select-none"
          style={{
            top: folderContextMenu.y,
            left: folderContextMenu.x,
          }}
        >
          {/* Menu Header with Folder Info */}
          <div className="px-2.5 py-2 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16] rounded-xl">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base shrink-0">{folderContextMenu.folder.emoji}</span>
              <div className="min-w-0">
                <h4 className="font-extrabold text-xs text-white truncate">
                  {folderContextMenu.folder.name}
                </h4>
                <p className="text-[10px] text-[#8EA093] truncate">
                  {folderContextMenu.folder.vibe || 'Розумний простір'}
                </p>
              </div>
            </div>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
              style={{ backgroundColor: folderContextMenu.folder.color || '#55C778' }}
            />
          </div>

          {/* Section 1: Actions */}
          <div className="space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#8EA093] uppercase tracking-wider">
              Основні дії
            </div>

            {/* Mark all as read */}
            <button
              onClick={() => handleMarkAllAsReadAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CheckCheck className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Позначити як прочитані</span>
              </div>
              {getFolderUnreadCount(folderContextMenu.folder) > 0 && (
                <span className="px-1.5 py-0.2 bg-[#55C778] text-[#0C120E] text-[9px] font-extrabold rounded-full shrink-0">
                  {getFolderUnreadCount(folderContextMenu.folder)}
                </span>
              )}
            </button>

            {/* Priority View for this folder */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                onSelectFolder(f.id);
                setShowOnlyUnread(true);
                soundFx.playTap();
                showToast(`⚡ Priority View: тільки бесіди з новими в «${f.name}»`);
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Priority View (лише нові)</span>
              </div>
              {getFolderUnreadCount(folderContextMenu.folder) > 0 && (
                <span className="px-1.5 py-0.2 bg-[#55C778] text-[#0C120E] text-[9px] font-extrabold rounded-full shrink-0">
                  {getFolderUnreadCount(folderContextMenu.folder)}
                </span>
              )}
            </button>

            {/* Quick Preview (Last 3 messages from most recent chat) */}
            <button
              onClick={() => handleOpenQuickPreview(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Eye className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Швидкий перегляд (3 ост.)</span>
              </div>
              <span className="text-[10px] text-[#8EA093] font-mono shrink-0 whitespace-nowrap">
                Останній чат
              </span>
            </button>

            {/* Toggle Notifications (Mute / Unmute) */}
            <button
              onClick={() => handleToggleMuteAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {folderContextMenu.folder.isMuted ? (
                  <Bell className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                ) : (
                  <BellOff className="w-3.5 h-3.5 text-[#8EA093] shrink-0" />
                )}
                <span className="truncate">
                  {folderContextMenu.folder.isMuted ? 'Увімкнути звук' : 'Вимкнути звук'}
                </span>
              </div>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap ${
                  folderContextMenu.folder.isMuted
                    ? 'bg-[#1F2B22] text-[#8EA093]'
                    : 'bg-[#183021] text-[#55C778]'
                }`}
              >
                {folderContextMenu.folder.isMuted ? '🔕 Muted' : '🔔 Active'}
              </span>
            </button>
          </div>

          {/* Section 2: Style & Customization */}
          <div className="border-t border-[#1F2B22] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#8EA093] uppercase tracking-wider">
              Стиль & Персоналізація
            </div>

            {/* Set Folder Accent Color */}
            <div>
              <button
                onClick={() => {
                  setIsColorPaletteOpen(!isColorPaletteOpen);
                  setIsVibePaletteOpen(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Palette className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                  <span className="truncate">Колірний акцент</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="w-3 h-3 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: folderContextMenu.folder.color || '#55C778' }}
                  />
                  <ChevronDown
                    className={`w-3 h-3 text-[#8EA093] transition-transform ${
                      isColorPaletteOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {isColorPaletteOpen && (
                <div className="p-2 bg-[#141C16] rounded-xl mt-1 space-y-2 border border-[#223126] animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#8EA093]">
                    <span>Палітра:</span>
                    <span
                      className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-[#0E1410] border border-[#1F2B22] font-bold"
                      style={{ color: folderContextMenu.folder.color || '#55C778' }}
                    >
                      {folderContextMenu.folder.color || '#55C778'}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {colorPalette.map((c) => {
                      const isSelected = folderContextMenu.folder.color === c.hex;
                      return (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => handleSetColorAction(folderContextMenu.folder, c.hex)}
                          className={`h-6 rounded-lg flex items-center justify-center transition-all ${
                            isSelected
                              ? 'ring-2 ring-white scale-105 shadow-sm font-bold text-white'
                              : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.label}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#1F2B22]">
                    <label
                      htmlFor="folder-custom-color"
                      className="text-[10px] font-bold text-[#8EA093] flex items-center gap-1 cursor-pointer flex-1"
                    >
                      <Pipette className="w-3 h-3 text-[#8EA093]" />
                      <span>Свій відтінок:</span>
                    </label>
                    <input
                      id="folder-custom-color"
                      type="color"
                      value={folderContextMenu.folder.color || '#55C778'}
                      onChange={(e) => handleSetColorAction(folderContextMenu.folder, e.target.value)}
                      className="w-8 h-6 p-0 border border-[#223126] rounded-md cursor-pointer bg-transparent"
                      title="Обрати довільний колір"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Set Folder Vibe Presets */}
            <div>
              <button
                onClick={() => {
                  setIsVibePaletteOpen(!isVibePaletteOpen);
                  setIsColorPaletteOpen(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                  <span className="truncate">Налаштувати Vibe</span>
                </div>
                <ChevronDown
                  className={`w-3 h-3 text-[#8EA093] transition-transform shrink-0 ${
                    isVibePaletteOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isVibePaletteOpen && (
                <div className="p-2 bg-[#141C16] rounded-xl mt-1 space-y-2 border border-[#223126] animate-in fade-in slide-in-from-top-1 duration-150">
                  <label className="block text-[10px] font-bold text-[#8EA093]">
                    Швидкі пресети:
                  </label>
                  <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                    {vibePresets.map((v) => (
                      <button
                        key={v}
                        onClick={() => handleSetVibeAction(folderContextMenu.folder, v)}
                        className="text-left text-[11px] px-2 py-1 bg-[#0E1410] hover:bg-[#18231B] rounded-lg text-white font-medium truncate transition-colors border border-[#1F2B22]"
                      >
                        {v}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-1 pt-1">
                    <input
                      type="text"
                      value={customVibeInput}
                      onChange={(e) => setCustomVibeInput(e.target.value)}
                      placeholder="Власний vibe..."
                      className="flex-1 px-2 py-1 text-[11px] bg-[#0E1410] border border-[#1F2B22] rounded-lg text-white placeholder-[#8EA093] focus:outline-none focus:border-[#55C778]"
                    />
                    <button
                      onClick={() => handleSetVibeAction(folderContextMenu.folder, customVibeInput)}
                      disabled={!customVibeInput.trim()}
                      className="px-2 py-1 bg-[#55C778] hover:bg-[#46AF68] disabled:opacity-50 text-[#0C120E] text-[10px] font-bold rounded-lg transition-colors shrink-0"
                    >
                      ОК
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Choose Folder Icon & Emoji */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                setIconPickerFolder(f);
                soundFx.playTap();
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Smile className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Змінити Emoji</span>
              </div>
              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-[#141C16] border border-[#223126] shrink-0">
                {folderContextMenu.folder.emoji}
              </span>
            </button>
          </div>

          {/* Section 3: Tools & Sharing */}
          <div className="border-t border-[#1F2B22] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#8EA093] uppercase tracking-wider">
              Інструменти & Шеринг
            </div>

            {/* View Folder Insights */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                setInsightsFolder(f);
                soundFx.playTap();
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <BarChart2 className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Аналітика (Insights)</span>
              </div>
              <span className="text-[10px] text-[#55C778] font-mono font-bold bg-[#183021] px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap">
                30 днів
              </span>
            </button>

            {/* Copy Folder Link (Deep Link) */}
            <button
              onClick={() => handleCopyFolderLinkAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Копіювати посилання</span>
              </div>
              <span className="text-[10px] text-[#55C778] font-mono font-bold bg-[#183021] px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap">
                Deep Link
              </span>
            </button>

            {/* Share Folder */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                setSharingFolder(f);
                soundFx.playTap();
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Share2 className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Поділитися простором</span>
              </div>
              <span className="text-[10px] text-[#8EA093] font-mono shrink-0 whitespace-nowrap">
                Код
              </span>
            </button>

            {/* Export Chat List as JSON */}
            <button
              onClick={() => handleExportChatListAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Download className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                <span className="truncate">Експорт чатів</span>
              </div>
              <span className="text-[10px] text-[#55C778] font-mono font-bold bg-[#183021] px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap">
                JSON
              </span>
            </button>
          </div>

          {/* Section 4: Management */}
          <div className="border-t border-[#1F2B22] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#8EA093] uppercase tracking-wider">
              Керування
            </div>

            {/* Rename Folder (Inline overlay) */}
            <button
              onClick={() => handleStartRename(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center gap-2 text-[#D1DFD6] hover:text-white transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
              <span className="truncate">Перейменувати</span>
            </button>

            {/* Edit Folder */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                onOpenEditFolder(f);
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center gap-2 text-[#D1DFD6] hover:text-white transition-colors"
            >
              <FolderEdit className="w-3.5 h-3.5 text-[#8EA093] shrink-0" />
              <span className="truncate">Налаштувати простір...</span>
            </button>

            {/* Archive / Restore Folder */}
            <button
              onClick={() => handleToggleArchiveAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center justify-between text-[#D1DFD6] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {folderContextMenu.folder.isArchived ? (
                  <ArchiveRestore className="w-3.5 h-3.5 text-[#55C778] shrink-0" />
                ) : (
                  <Archive className="w-3.5 h-3.5 text-[#F4AF25] shrink-0" />
                )}
                <span className="truncate">
                  {folderContextMenu.folder.isArchived ? 'Розархівувати' : 'В архів'}
                </span>
              </div>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap ${
                  folderContextMenu.folder.isArchived
                    ? 'bg-[#183021] text-[#55C778]'
                    : 'bg-[#F4AF25]/15 text-[#F4AF25]'
                }`}
              >
                {folderContextMenu.folder.isArchived ? 'Відновити' : 'Архів'}
              </span>
            </button>

            {/* Clear / Delete for custom folders */}
            {!folderContextMenu.folder.isBuiltIn && (
              <div className="border-t border-[#1F2B22] pt-1 space-y-0.5">
                <button
                  onClick={() => handleClearFolderAction(folderContextMenu.folder)}
                  className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#18231B] text-left text-xs font-semibold flex items-center gap-2 text-[#8EA093] hover:text-white transition-colors"
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Очистити чати</span>
                </button>

                <button
                  onClick={() => handleDeleteFolderAction(folderContextMenu.folder)}
                  className="w-full px-2.5 py-1.5 rounded-xl hover:bg-red-950/40 text-left text-xs font-semibold flex items-center gap-2 text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Видалити папку</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. QUICK PREVIEW FLOATING CARD (Last 3 messages from most recent chat) */}
      {quickPreview && (
        <div
          ref={quickPreviewRef}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-80 sm:w-88 bg-[#121A15]/98 backdrop-blur-md border border-[#2B3C30] rounded-2xl shadow-2xl p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-200 text-white"
          style={{
            top: quickPreview.y,
            left: quickPreview.x,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-[#1F2B22] pb-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={quickPreview.chat.avatar}
                alt={quickPreview.chat.title}
                className="w-8 h-8 rounded-xl object-cover ring-1 ring-[#223126] shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="font-extrabold text-xs text-white truncate">
                    {quickPreview.chat.title}
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.2 bg-[#141C16] text-[#55C778] font-bold rounded-md shrink-0 border border-[#223126]">
                    {quickPreview.folder.emoji} {quickPreview.folder.name}
                  </span>
                </div>
                <p className="text-[10px] text-[#8EA093] truncate">
                  {quickPreview.chat.description || quickPreview.chat.topic || 'Остання активність у просторі'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setQuickPreview(null)}
              className="p-1 hover:bg-[#18231B] rounded-lg text-[#8EA093] hover:text-white transition-colors shrink-0"
              title="Закрити"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Last 3 Messages Container */}
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {quickPreview.messages.map((msg, index) => {
              const isSelf = msg.isSelf || msg.senderId === currentUser.id;
              return (
                <div
                  key={msg.id || index}
                  className={`flex items-start gap-1.5 text-xs ${isSelf ? 'flex-row-reverse' : ''}`}
                >
                  {!isSelf && (
                    <img
                      src={msg.senderAvatar || quickPreview.chat.avatar}
                      alt={msg.senderName}
                      className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5"
                    />
                  )}
                  <div
                    className={`rounded-xl px-2.5 py-1.5 max-w-[85%] space-y-0.5 ${
                      isSelf
                        ? 'bg-gradient-to-r from-[#2E6B3E] to-[#1E4E2C] text-white rounded-tr-xs shadow-sm'
                        : 'bg-[#141C16] border border-[#1F2B22] text-[#E4EDE7] rounded-tl-xs shadow-sm'
                    }`}
                  >
                    {!isSelf && (
                      <span className="font-extrabold text-[10px] text-[#55C778] block leading-none">
                        {msg.senderName}
                      </span>
                    )}
                    <p className="text-xs break-words line-clamp-3 leading-relaxed">
                      {msg.text || (msg.mediaUrl ? '📎 Вкладення' : msg.voiceDuration ? '🎤 Голосове' : 'Повідомлення')}
                    </p>
                    <span
                      className={`text-[9px] block text-right font-mono ${
                        isSelf ? 'text-white/80' : 'text-[#8EA093]'
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div className="pt-2 border-t border-[#1F2B22] flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-[#8EA093] flex items-center gap-1">
              <Eye className="w-3 h-3 text-[#55C778]" />
              <span>Швидкий перегляд</span>
            </span>

            <button
              onClick={() => {
                onSelectFolder(quickPreview.folder.id);
                onSelectChat(quickPreview.chat.id);
                setQuickPreview(null);
                soundFx.playTap();
              }}
              className="px-3 py-1.5 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span>Відкрити чат</span>
              <MoveRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 9. Share Folder Modal */}
      {sharingFolder && (
        <ShareFolderModal
          isOpen={!!sharingFolder}
          onClose={() => setSharingFolder(null)}
          folder={sharingFolder}
          chats={chats}
          onSendToChat={(folder) => {
            showToast(`🚀 Запрошення у «${folder.name}» надіслано в активний чат!`);
          }}
        />
      )}

      {/* 10. Folder Insights Modal (30-day message frequency chart) */}
      {insightsFolder && (
        <FolderInsightsModal
          isOpen={!!insightsFolder}
          onClose={() => setInsightsFolder(null)}
          folder={insightsFolder}
          chats={chats}
        />
      )}

      {/* 11. Folder Icon & Emoji Picker Modal */}
      {iconPickerFolder && (
        <FolderIconPickerModal
          isOpen={!!iconPickerFolder}
          onClose={() => setIconPickerFolder(null)}
          folder={iconPickerFolder}
          onSelectIcon={(folderId, emoji) => {
            if (onSetFolderIcon) {
              onSetFolderIcon(folderId, emoji);
            }
            showToast(`✨ Іконку простору оновлено на ${emoji}`);
          }}
        />
      )}

      {/* 7.5 ARCHIVED SMART FOLDERS SECTION (Dimmed Appearance at Bottom of Sidebar) */}
      {smartFolders.some((f) => f.isArchived) && (
        <div className="border-t border-[#E5DAC8] bg-[#EFE7D8]/85 p-2 space-y-1.5 transition-colors">
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              setIsArchiveSectionExpanded(!isArchiveSectionExpanded);
            }}
            className="w-full flex items-center justify-between text-xs font-bold text-[#717E75] hover:text-[#1F2521] px-1.5 py-1 rounded-lg hover:bg-white/40 transition-colors select-none"
          >
            <div className="flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5 text-[#8C461A]" />
              <span>Архів просторів</span>
              <span className="px-1.5 py-0.2 bg-[#DFD6C5] text-[#5E6B62] rounded-full text-[10px] font-extrabold">
                {smartFolders.filter((f) => f.isArchived).length}
              </span>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#717E75] transition-transform duration-200 ${
                isArchiveSectionExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isArchiveSectionExpanded && (
            <div className="flex flex-wrap gap-1.5 pt-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {smartFolders
                .filter((f) => f.isArchived)
                .map((folder) => {
                  const isActive = activeFolderId === folder.id;
                  const folderUnread = getFolderUnreadCount(folder);

                  return (
                    <div
                      key={folder.id}
                      onContextMenu={(e) => openFolderContextMenu(e, folder)}
                      onClick={() => {
                        soundFx.playTap();
                        onSelectFolder(folder.id);
                      }}
                      className={`smart-folder-item group px-2.5 py-1.5 rounded-xl cursor-pointer flex items-center gap-1.5 text-xs whitespace-nowrap border transition-all select-none opacity-60 hover:opacity-100 filter grayscale-40 hover:grayscale-0 ${
                        isActive
                          ? 'bg-white text-[#1F2521] font-bold shadow-xs border-[#C9BFA8] ring-1 ring-[#8C988E]'
                          : 'bg-white/45 text-[#717E75] hover:bg-white/90 border-dashed border-[#D2C5B2]'
                      }`}
                      title={`Архівований простір: «${folder.name}» (правий клік для опцій / розархівації)`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          soundFx.playTap();
                          setIconPickerFolder(folder);
                        }}
                        title={
                          chats.filter((c) => isChatInFolder(c, folder)).length === 0
                            ? `Порожній простір (0 чатів)`
                            : `Змінити іконку`
                        }
                        className={`w-4.5 h-4.5 rounded-md flex items-center justify-center text-xs shrink-0 bg-[#E8DFD1]/60 text-[#717E75] hover:scale-110 transition-all ${
                          chats.filter((c) => isChatInFolder(c, folder)).length === 0
                            ? 'opacity-35 hover:opacity-80 grayscale-50'
                            : 'opacity-100'
                        }`}
                      >
                        {folder.emoji}
                      </button>
                      <span className="truncate max-w-24 line-through decoration-[#8C988E]/70">
                        {folder.name}
                      </span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#DFD6C5]/70 text-[#717E75] font-mono font-bold">
                        Архів
                      </span>
                      {folderUnread > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#8C988E] text-white text-[9px] font-bold rounded-full">
                          {folderUnread}
                        </span>
                      )}

                      {/* Explicit Folder Settings / Context Menu Trigger Button */}
                      <button
                        type="button"
                        data-action="folder-settings"
                        onClick={(e) => {
                          e.stopPropagation();
                          soundFx.playTap();
                          openFolderContextMenu(e, folder);
                        }}
                        className="folder-settings opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#DFD6C5] rounded-md text-[#717E75] hover:text-[#1F2521] transition-all cursor-pointer hover:scale-110 active:scale-95 ml-0.5"
                        title="Налаштування та опції архівованого простору"
                        aria-label="folder-settings"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* 8. Bottom Multi-Sphere Persona Panel */}
      <div className="p-2.5 border-t border-[#1C281F] bg-[#0E1410] relative">
        {/* Persona quick switcher popup */}
        {isPersonaMenuOpen && onSwitchPersonaSphere && (
          <div className="absolute bottom-full left-2 right-2 mb-2 p-2 bg-[#141C16]/98 backdrop-blur-2xl border border-[#2B3C30] rounded-2xl shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100 text-[#E4EDE7]">
            <div className="px-2 py-1 text-[10px] font-extrabold text-[#8EA093] uppercase tracking-wider">
              Перемкнути активну ідентичність
            </div>
            {(['work', 'personal', 'creative', 'family'] as PersonaSphere[]).map((sphere) => {
              const meta = sphereLabels[sphere];
              const isSelected = activeSphere === sphere;
              return (
                <button
                  key={sphere}
                  onClick={() => {
                    soundFx.playTap();
                    onSwitchPersonaSphere(sphere);
                    setIsPersonaMenuOpen(false);
                  }}
                  className={`w-full p-2 rounded-xl text-left flex items-center justify-between text-xs font-bold transition-colors ${
                    isSelected
                      ? 'bg-[#1C2920] text-[#55C778] border border-[#2B3E31]'
                      : 'hover:bg-[#1E2A21] text-[#E4EDE7]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                  </div>
                  <span className={`text-[10px] ${isSelected ? 'text-[#55C778]' : 'text-[#8EA093]'}`}>
                    {currentUser.personas?.[sphere]?.statusText || 'В мережі'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Main user clickable card */}
          <div
            onClick={() => {
              soundFx.playTap();
              onOpenUserProfile();
            }}
            className="flex-1 p-2 bg-[#141C16] hover:bg-[#18231B] border border-[#233127] rounded-2xl flex items-center justify-between cursor-pointer transition-all shadow-sm group min-w-0"
            title="Відкрити картку профілю"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative shrink-0">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-8 h-8 rounded-xl object-cover ring-1 ring-white/10"
                />
                <span className="absolute -bottom-1 -right-1 text-[10px]">
                  {currentUser.statusEmoji}
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-extrabold text-xs text-white truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <span
                    className="px-1.5 py-0.2 text-[9px] font-extrabold rounded-md uppercase bg-[#1B271F] text-[#55C778] border border-[#2B3E31]"
                  >
                    {activeSphere}
                  </span>
                </div>
                <p className="text-[10px] text-[#8EA093] truncate">
                  {currentUser.status}
                </p>
              </div>
            </div>
          </div>

          {/* Quick sphere toggle button */}
          <button
            onClick={() => {
              soundFx.playTap();
              setIsPersonaMenuOpen(!isPersonaMenuOpen);
            }}
            className="p-2 bg-[#141C16] hover:bg-[#18231B] border border-[#233127] rounded-2xl text-[#8EA093] hover:text-white shadow-sm transition-colors shrink-0"
            title="Швидка зміна сфери"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${isPersonaMenuOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
};
