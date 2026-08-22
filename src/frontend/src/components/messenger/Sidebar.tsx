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
  Eraser,
  Inbox,
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
  Link2,
  Briefcase,
  House,
  Leaf,
  Bookmark,
  Users,
  GraduationCap,
  ListChecks,
  Table2,
  Paperclip,
  Mic,
  Image as ImageIcon,
  MapPin,
  Vote,
  Calendar,
  Code,
  Receipt
} from 'lucide-react';
import { Chat, ChatCircle, PersonaSphere, SmartFolder, UserProfile } from '../../types/messenger';
import { Avatar } from './Avatar';
import { soundFx } from '../../utils/messengerSound';
import { networkEngine } from '../../services/messengerNetworkEngine';
import { messengerApi } from '../../services/messengerApi';
import { useMessengerStore } from '../../stores/messengerStore';
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

const circleTabs: { id: ChatCircle; label: string }[] = [
  { id: 'work', label: 'Робота' },
  { id: 'family', label: 'Сім’я' },
  { id: 'friends', label: 'Друзі' },
  { id: 'study', label: 'Навчання' },
  { id: 'communities', label: 'Спільноти' },
  { id: 'saved', label: 'Збережене' },
];

// Рейка папок: іконку виводимо зі змісту папки (кола → сенс), емодзі лишається лише в даних.
const folderIcon = (folder: SmartFolder): typeof Table2 => {
  if (folder.id === 'all') return MessagesSquare;

  const hint = `${folder.emoji || ''} ${folder.name}`.toLowerCase();
  if (/задач|спринт|sprint|tasks/.test(hint)) return ListChecks;
  if (/дім|родин|сім|family|home/.test(hint)) return House;
  if (/збереж|saved|нотат/.test(hint)) return Bookmark;
  if (/навчан|study|курс/.test(hint)) return GraduationCap;

  const circles = folder.filterRules?.includeCircles || [];
  if (circles.includes('family')) return House;
  if (circles.includes('communities') || circles.includes('friends')) return Users;
  if (circles.includes('work')) return Briefcase;
  if (circles.includes('saved')) return Bookmark;
  if (circles.includes('study')) return GraduationCap;

  if (/робот|проєкт|проект|project|work|design/.test(hint)) return Briefcase;
  if (/особист|private|chill|інтерес/.test(hint)) return Leaf;
  if (/спільнот|друз|community|friends/.test(hint)) return Users;
  return Folder;
};

// Вузол віддає час без зони — тлумачимо його як UTC, як це вже робить messengerApi.
const parseNodeTime = (iso: string): Date | null => {
  const d = new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const chatTimeLabel = (iso?: string): string => {
  if (!iso) return '';
  const d = parseNodeTime(iso);
  if (!d) return '';

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);

  if (days <= 0) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Вчора';
  if (days < 365) return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// Прев'ю нетекстового повідомлення: тип видно з іконки, тіла ми не показуємо.
const kindPreview: Record<string, { icon: typeof Table2; label: string }> = {
  table: { icon: Table2, label: 'Таблиця' },
  chart: { icon: BarChart2, label: 'Графік' },
  'task-list': { icon: ListChecks, label: 'Задачі' },
  file: { icon: Paperclip, label: 'Файл' },
  voice: { icon: Mic, label: 'Голосове' },
  image: { icon: ImageIcon, label: 'Фото' },
  location: { icon: MapPin, label: 'Локація' },
  poll: { icon: Vote, label: 'Опитування' },
  event: { icon: Calendar, label: 'Подія' },
  code: { icon: Code, label: 'Код' },
  'split-bill': { icon: Receipt, label: 'Рахунок' },
};

// Вузол міг не встигнути дати розмові людську назву — тоді в title лежить хеш.
const hashTitle = /^[0-9a-f]{12,}$/;
const displayTitle = (title: string): string => {
  const raw = (title || '').trim();
  return hashTitle.test(raw) ? `Вузол ${raw.slice(0, 8)}…` : raw;
};



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
  { hex: '#E6DFD3', label: 'Графіт' },
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
  // Кола та перейменування живуть у сторі — сюди беремо їх напряму, бо пропів на них немає.
  const activeCircle = useMessengerStore((s) => s.activeCircle);
  const setActiveCircle = useMessengerStore((s) => s.setActiveCircle);
  const updateChat = useMessengerStore((s) => s.updateChat);

  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);
  const [isPersonaMenuOpen, setIsPersonaMenuOpen] = useState(false);

  // Drag-and-Drop state
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Chat context menu for quick folder assignment.
  // Координати тримаємо окремо: меню малюється поза списком, інакше його ріже скрол-контейнер.
  const [activeMenuChatId, setActiveMenuChatId] = useState<string | null>(null);
  const [chatMenuPos, setChatMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Перейменування живе інлайн у меню: нативного window.prompt у WebView Tauri немає.
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Деструктивні дії проходять лише через підтвердження просто в меню.
  const [chatConfirm, setChatConfirm] = useState<'clear' | 'delete' | null>(null);
  // «N листів чекають» — стан черги вузла під карткою профілю.
  const [queuedCount, setQueuedCount] = useState(0);

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
  const chatMenuRef = useRef<HTMLDivElement>(null);
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
      // Клік по самих трьох крапках не гасимо тут — інакше повторний клік не закриє меню.
      const onTrigger = (e.target as Element)?.closest?.('[data-chat-menu-trigger]');
      if (!onTrigger && chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setActiveMenuChatId(null);
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

  // Меню закрилось чи перемкнулось на іншу розмову — гасимо його підстани.
  useEffect(() => {
    setRenamingChatId(null);
    setChatConfirm(null);
  }, [activeMenuChatId]);

  // Стан черги опитуємо, лише поки список відкритий; вузол мовчить — лічильник стоїть.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { queued } = await messengerApi.queueStatus();
        if (alive) setQueuedCount(queued);
      } catch {
        /* вузол недоступний — не чіпаємо попереднє значення */
      }
    };
    void tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
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

  // Filter chats by Active Smart Folder, Circle, Search Query & Unread status
  const filteredChats = chats.filter((c) => {
    const matchesFolder = isChatInFolder(c, currentFolder);
    const matchesCircle = activeCircle === 'all' || c.circle === activeCircle;
    const matchesUnread = !showOnlyUnread || c.unreadCount > 0;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      c.title.toLowerCase().includes(q) ||
      // Плейсхолдер обіцяє «повідомлення» — тож матчимо й останній лист та автора.
      (c.lastSnippet && c.lastSnippet.toLowerCase().includes(q)) ||
      (c.lastAuthor && c.lastAuthor.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q)) ||
      (c.topic && c.topic.toLowerCase().includes(q)) ||
      (c.badge && c.badge.toLowerCase().includes(q)) ||
      (c.publicHandle && c.publicHandle.toLowerCase().includes(q)) ||
      (c.aiSecretarySummary && c.aiSecretarySummary.toLowerCase().includes(q));

    return matchesFolder && matchesCircle && matchesUnread && matchesSearch;
  });

  const totalUnread = chats.reduce((acc, c) => acc + c.unreadCount, 0);
  const activeSphere = currentUser.activePersonaSphere || 'work';
  const menuChat = activeMenuChatId ? chats.find((c) => c.id === activeMenuChatId) : undefined;

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
      appName: 'PHANTOM Messenger',
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

  // Перейменування — інлайн у меню (нативного prompt у WebView немає).
  const startRenameChat = (chat: Chat) => {
    setRenameDraft(chat.title);
    setRenamingChatId(chat.id);
  };

  // Назва розмови живе на вузлі — спершу пишемо туди, і лише тоді міняємо UI.
  const saveRenameChat = async (chat: Chat) => {
    const trimmed = renameDraft.trim();
    setRenamingChatId(null);
    setActiveMenuChatId(null);
    if (!trimmed || trimmed === chat.title) return;
    try {
      await messengerApi.renameConversation(chat.id, trimmed);
      updateChat(chat.id, { title: trimmed });
      showToast(`✏️ Перейменовано на «${trimmed}»`);
    } catch {
      showToast('Вузол не прийняв нову назву');
    }
  };

  // Позначаємо прочитаним до останнього листа: вузол сам обріже seq до наявного.
  const handleMarkChatRead = async (chat: Chat) => {
    setActiveMenuChatId(null);
    try {
      await messengerApi.markRead(chat.id, Number.MAX_SAFE_INTEGER);
      updateChat(chat.id, { unreadCount: 0 });
      soundFx.playTap();
    } catch {
      showToast('Вузол не позначив прочитаним');
    }
  };

  // Історія зникає з ЦЬОГО вузла; копію співрозмовника вузол не чіпає.
  const handleClearChat = async (chat: Chat) => {
    try {
      await messengerApi.clearConversation(chat.id);
      updateChat(chat.id, {
        messages: [],
        lastSnippet: undefined,
        lastKind: undefined,
        lastAuthor: undefined,
        unreadCount: 0,
      });
      showToast('🧹 Історію очищено на цьому вузлі');
    } catch {
      showToast('Не вдалося очистити історію');
    }
    setChatConfirm(null);
    setActiveMenuChatId(null);
  };

  const handleDeleteChat = async (chat: Chat) => {
    try {
      await messengerApi.deleteConversation(chat.id);
      useMessengerStore.setState((s) => {
        const rest = s.chats.filter((c) => c.id !== chat.id);
        return {
          chats: rest,
          activeChatId: s.activeChatId === chat.id ? (rest[0]?.id ?? '') : s.activeChatId,
        };
      });
      showToast('Розмову видалено з цього вузла');
    } catch {
      showToast('Не вдалося видалити розмову');
    }
    setChatConfirm(null);
    setActiveMenuChatId(null);
  };

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
    <aside className="flex h-full w-full md:w-auto bg-[#F9F7F1] border-r border-[#E6DFD3] select-none shrink-0 overflow-hidden relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-4 left-4 right-4 z-50 bg-[#F9F7F1]/95 border border-[#E6DFD3] text-[#E87A42] px-3 py-2 rounded-xl text-xs font-bold shadow-2xl text-center animate-in fade-in">
          {toastMessage}
        </div>
      )}

      {/* 0. Left Organic Dark Workspace / Folder Rail (Desktop & Tablet) */}
      <div className="hidden md:flex w-14 sm:w-16 bg-[#F7F5EF] flex-col items-center py-3 border-r border-[#E8E1D3] shrink-0 justify-between select-none z-10">
        {/* Top: Current User Avatar & Workspace Folders */}
        <div className="flex flex-col items-center gap-3 w-full">
          <div
            onClick={onOpenUserProfile}
            className="relative cursor-pointer"
            title={`${currentUser.name} (${currentUser.circleRole || 'Користувач'}) — Профіль`}
          >
            <Avatar src={currentUser.avatar} name={currentUser.name} className="w-9 h-9" />
            <span className="absolute bottom-0 right-0 w-1.5 h-1.5 bg-[#4C8A55] rounded-full ring-2 ring-[#F7F5EF]" />
          </div>

          <div className="w-7 h-px bg-[#E8E1D3]" />

          {/* Smart Folders List */}
          <div className="flex flex-col items-center gap-1 w-full overflow-y-auto no-scrollbar max-h-[calc(100vh-210px)] py-0.5">
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
              className="flex items-center justify-center w-full min-h-0"
              title="Усі бесіди"
            >
              <div
                className={`w-[36px] h-[36px] rounded-[10px] flex items-center justify-center transition-colors ${
                  activeFolderId === 'all'
                    ? 'bg-[#F1EBDD] text-[#21261F]'
                    : 'text-[#6E7568] hover:bg-[#F1EBDD]/60 hover:text-[#21261F]'
                }`}
              >
                <MessagesSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
              </div>
            </button>

            {/* Smart Folders — «Усі» вже має власну кнопку вище, другий раз її не малюємо */}
            {smartFolders
              .filter((f) => !f.isArchived && f.id !== 'all')
              .map((folder) => {
                const isActive = activeFolderId === folder.id;
                const isDragTarget = dragOverFolderId === folder.id;
                const folderUnread = getFolderUnreadCount(folder);
                const FolderGlyph = folderIcon(folder);

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
                    className="flex items-center justify-center w-full min-h-0"
                    title={`${folder.name} (${folder.vibe || 'Папка'})`}
                  >
                    <div
                      className={`w-[36px] h-[36px] rounded-[10px] flex items-center justify-center transition-colors relative ${
                        isDragTarget
                          ? 'ring-1 ring-[#D96C35] bg-[#F1EBDD] text-[#21261F]'
                          : isActive
                          ? 'bg-[#F1EBDD] text-[#21261F]'
                          : 'text-[#6E7568] hover:bg-[#F1EBDD]/60 hover:text-[#21261F]'
                      }`}
                    >
                      <FolderGlyph className="w-[18px] h-[18px]" strokeWidth={1.75} />
                      {folderUnread > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 bg-[#D96C35] text-[#FDFCF9] text-[10px] font-semibold rounded-full ring-2 ring-[#F7F5EF] flex items-center justify-center leading-none">
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
              className="w-[36px] h-[36px] min-h-0 min-w-0 rounded-[10px] text-[#6E7568] hover:bg-[#F1EBDD]/60 hover:text-[#21261F] flex items-center justify-center transition-colors"
              title="Створити нову папку / простір (+)"
            >
              <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Bottom: Settings */}
        <div className="flex flex-col items-center gap-2 pt-2 border-t border-[#E8E1D3] w-full">
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenSettings();
            }}
            className="w-[36px] h-[36px] min-h-0 min-w-0 rounded-[10px] text-[#6E7568] hover:bg-[#F1EBDD]/60 hover:text-[#21261F] flex items-center justify-center transition-colors"
            title="Налаштування застосунку"
          >
            <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Main Chat List Container */}
      <div className="w-full md:w-80 lg:w-84 flex flex-col h-full bg-[#FDFCF9] min-w-0 overflow-hidden relative">
        {/* Mobile Top Brand & Quick Actions Header */}
        <div className="md:hidden px-4 pt-[calc(var(--sat)+0.65rem)] pb-2.5 bg-[#F7F5EE] text-[#1E2521] flex items-center justify-between shrink-0 shadow-sm border-b border-[#E6DFD3]">
          <div className="flex items-center gap-3 min-w-0">
            <div
              onClick={onOpenUserProfile}
              className="relative cursor-pointer shrink-0 active:scale-95 transition-transform"
              title={`${currentUser.name} — Профіль`}
            >
              <Avatar src={currentUser.avatar} name={currentUser.name} className="w-9 h-9" />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#10B981] rounded-full ring-2 ring-[#F7F5EE]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-black text-base tracking-tight text-[#1E2521] flex items-center gap-1">
                  <span>PHANTOM</span>
                  <Sparkles className="w-3.5 h-3.5 text-[#E87A42]" />
                </h1>
                <span className="px-1.5 py-0.2 bg-[#F9F7F1] text-[#E87A42] rounded-md text-[9px] font-bold">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] text-[#5F6A60] font-semibold flex items-center gap-1 leading-none mt-0.5 truncate">
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
                className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F9F7F1] rounded-xl transition-colors active:scale-90"
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
              className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F9F7F1] rounded-xl transition-colors active:scale-90"
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
              className="p-2 bg-[#E87A42] text-[#F7F5EE] rounded-xl hover:bg-[#C25925] transition-transform active:scale-90 shadow-md font-bold"
              title="Новий діалог"
              aria-label="Створити новий діалог"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 1. Folder Header and Action (Desktop) */}
        <div className="hidden md:flex px-3.5 py-2.5 border-b border-[#E8E1D3] items-center justify-between gap-2 bg-[#FDFCF9]">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <h2 className="font-semibold text-[13px] text-[#21261F] truncate">
              {currentFolder.name}
            </h2>
            <p className="text-[11.5px] text-[#6E7568] truncate">
              · {filteredChats.length} {filteredChats.length === 1 ? 'чат' : filteredChats.length < 5 ? 'чати' : 'чатів'}
              {totalUnread > 0 && ` · ${totalUnread} нових`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {currentFolder.id !== 'all' && !currentFolder.isBuiltIn && (
              <button
                onClick={() => onOpenEditFolder(currentFolder)}
                className="w-[30px] h-[30px] min-h-0 min-w-0 flex items-center justify-center text-[#6E7568] hover:text-[#21261F] hover:bg-[#F7F5EF] rounded-[10px] transition-colors"
                title="Налаштувати папку"
              >
                <SlidersHorizontal className="w-4 h-4" strokeWidth={1.75} />
              </button>
            )}
            <button
              onClick={() => {
                soundFx.playTap();
                onNewChat();
              }}
              className="h-[30px] min-h-0 min-w-0 px-2.5 text-[#21261F] bg-transparent border border-[#E8E1D3] hover:bg-[#F7F5EF] rounded-[10px] transition-colors flex items-center gap-1.5 text-[12px] font-medium"
              title="Новий діалог"
            >
              <Plus className="w-[16px] h-[16px]" strokeWidth={1.75} />
              <span className="hidden sm:inline">Новий</span>
            </button>
          </div>
        </div>

        {/* Drag-and-drop helper tip */}
        {draggedChatId && (
          <div className="bg-[#F7F5EF] border-b border-[#E8E1D3] text-[#6E7568] px-3 py-1.5 text-[11.5px] flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <GripVertical className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>Перетягніть у потрібну папку на лівій панелі</span>
            </div>
            <span className="text-[11px] text-[#98A092]">Відпустіть для додавання</span>
          </div>
        )}

        {/* 2. Search & Quick Filters */}
        <div className="px-3 pt-2.5 pb-2 space-y-2 border-b border-[#E8E1D3] bg-[#FDFCF9]">
          <div className="relative">
            <Search className="w-[16px] h-[16px] text-[#98A092] absolute left-2.5 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук людей, тем, повідомлень…"
              className="w-full h-[32px] min-h-0 min-w-0 pl-8 pr-8 bg-transparent border border-[#E8E1D3] rounded-[10px] text-[13px] text-[#21261F] placeholder-[#98A092] focus:outline-none focus:border-[#D2C8B4] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 min-h-0 min-w-0 text-[#98A092] hover:text-[#21261F]"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>

          {/* Кола: показуємо лише ті, у яких справді є бесіди — решта була б мертвим фільтром. */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-0.5 px-0.5 py-0.5">
            <button
              onClick={() => {
                soundFx.playTap();
                setShowOnlyUnread(false);
                setActiveCircle('all');
              }}
              className={`shrink-0 h-[26px] min-h-0 min-w-0 px-2.5 rounded-[10px] text-[12px] font-medium border transition-colors flex items-center ${
                activeCircle === 'all' && !showOnlyUnread
                  ? 'bg-[#F1EBDD] text-[#21261F] border-[#E0D7C4]'
                  : 'bg-transparent text-[#6E7568] border-[#E8E1D3] hover:text-[#21261F] hover:bg-[#F7F5EF]'
              }`}
            >
              Всі
            </button>

            {totalUnread > 0 && (
              <button
                onClick={() => {
                  soundFx.playTap();
                  setShowOnlyUnread(!showOnlyUnread);
                }}
                className={`shrink-0 h-[26px] min-h-0 min-w-0 px-2.5 rounded-[10px] text-[12px] font-medium border transition-colors flex items-center gap-1 ${
                  showOnlyUnread
                    ? 'bg-[#F1EBDD] text-[#21261F] border-[#E0D7C4]'
                    : 'bg-transparent text-[#6E7568] border-[#E8E1D3] hover:text-[#21261F] hover:bg-[#F7F5EF]'
                }`}
              >
                <span>Непрочитані</span>
                <span className="text-[#D96C35] font-semibold">{totalUnread}</span>
              </button>
            )}

            {circleTabs
              .filter((circle) => chats.some((c) => c.circle === circle.id))
              .map((circle) => {
                const isActive = activeCircle === circle.id && !showOnlyUnread;
                return (
                  <button
                    key={circle.id}
                    onClick={() => {
                      soundFx.playTap();
                      setShowOnlyUnread(false);
                      setActiveCircle(isActive ? 'all' : circle.id);
                    }}
                    className={`shrink-0 h-[26px] min-h-0 min-w-0 px-2.5 rounded-[10px] text-[12px] font-medium border transition-colors flex items-center ${
                      isActive
                        ? 'bg-[#F1EBDD] text-[#21261F] border-[#E0D7C4]'
                        : 'bg-transparent text-[#6E7568] border-[#E8E1D3] hover:text-[#21261F] hover:bg-[#F7F5EF]'
                    }`}
                  >
                    {circle.label}
                  </button>
                );
              })}
          </div>
        </div>

        {/* 3. Chats List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
        {filteredChats.length === 0 ? (
          <div className="py-12 text-center space-y-2 px-4">
            <div className="w-9 h-9 rounded-[10px] text-[#98A092] flex items-center justify-center mx-auto border border-[#E8E1D3]">
              {React.createElement(folderIcon(currentFolder), { className: 'w-[18px] h-[18px]', strokeWidth: 1.75 })}
            </div>
            <p className="text-[13px] font-semibold text-[#21261F]">
              {searchQuery
                ? 'Нічого не знайдено'
                : showOnlyUnread
                ? 'Непрочитаних немає'
                : 'Тут поки порожньо'}
            </p>
            {(searchQuery || showOnlyUnread || activeCircle !== 'all' || currentFolder.id !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowOnlyUnread(false);
                  setActiveCircle('all');
                  onSelectFolder('all');
                }}
                className="text-[12.5px] min-h-0 min-w-0 text-[#6E7568] hover:text-[#21261F] transition-colors"
              >
                Показати всі бесіди
              </button>
            )}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = chat.id === activeChatId;
            const msgs = chat.messages || [];
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
            const isDraggingThis = draggedChatId === chat.id;

            // Зведення з вузла — джерело правди; завантажена стрічка лише підстраховує.
            const lastKind = chat.lastKind || lastMsg?.type;
            const lastSnippet = chat.lastSnippet || lastMsg?.text;
            const lastAuthor = chat.lastAuthor || lastMsg?.senderName;
            const timeLabel = chatTimeLabel(chat.lastAt || lastMsg?.sentAt);
            const hasHistory = Boolean(lastKind || lastSnippet);

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
                className={`group px-2.5 py-2.5 rounded-[10px] cursor-pointer transition-colors flex items-center gap-2.5 relative border ${
                  isDraggingThis
                    ? 'opacity-40 border-dashed border-[#D96C35] bg-[#F1EBDD]'
                    : isSelected
                    ? 'bg-[#F1EBDD] border-[#E0D7C4]'
                    : 'bg-transparent border-transparent hover:bg-[#F7F5EF]'
                }`}
              >
                {/* Avatar (40px) with Status Indicator */}
                <div className="relative shrink-0">
                  <Avatar src={chat.avatar} name={chat.title} className="w-10 h-10" />
                  {chat.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-[#4C8A55] rounded-full ring-2 ring-[#FDFCF9]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Лінія 1: назва + час */}
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="font-semibold text-[13.5px] text-[#21261F] truncate leading-tight">
                        {displayTitle(chat.title)}
                      </h3>
                      {chat.pinned && <Pin className="w-3 h-3 text-[#98A092] shrink-0" strokeWidth={1.75} />}
                      {chat.isDemo && (
                        <span className="px-1 py-px rounded-[4px] border border-[#E8E1D3] text-[#98A092] text-[10px] shrink-0 leading-[13px]">
                          демо
                        </span>
                      )}
                    </div>
                    {timeLabel && (
                      /* На ховері звільняємо кут під кнопку дій — інакше час ріжеться навпіл */
                      <span
                        className={`text-[11.5px] text-[#98A092] shrink-0 leading-tight transition-opacity ${
                          activeMenuChatId === chat.id ? 'opacity-0' : 'group-hover:opacity-0'
                        }`}
                      >
                        {timeLabel}
                      </span>
                    )}
                  </div>

                  {/* Лінія 2: прев'ю + непрочитані */}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="text-[12.5px] truncate leading-tight min-w-0 flex-1 flex items-center gap-1">
                      {chat.draft ? (
                        <span className="truncate">
                          <span className="text-[#D96C35]">Чернетка: </span>
                          <span className="text-[#6E7568]">{chat.draft}</span>
                        </span>
                      ) : !hasHistory ? (
                        <span className="text-[#98A092] truncate">Ще немає повідомлень</span>
                      ) : lastKind && lastKind !== 'text' ? (
                        <>
                          {React.createElement(kindPreview[lastKind]?.icon || Paperclip, {
                            className: 'w-3.5 h-3.5 text-[#98A092] shrink-0',
                            strokeWidth: 1.75,
                          })}
                          <span className="text-[#6E7568] truncate">
                            {kindPreview[lastKind]?.label || 'Вкладення'}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#6E7568] truncate">
                          {lastAuthor ? `${lastAuthor}: ` : ''}
                          {lastSnippet}
                        </span>
                      )}
                    </div>

                    {chat.unreadCount > 0 && (
                      <span className="px-1.5 min-w-[18px] text-center bg-[#D96C35] text-[#FDFCF9] text-[10.5px] font-semibold rounded-full shrink-0 leading-[16px]">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Три крапки: зʼявляються поверх часу, щоб не красти ширину в рядка */}
                <button
                  type="button"
                  data-chat-menu-trigger
                  onClick={(e) => {
                    e.stopPropagation();
                    soundFx.playTap();
                    if (activeMenuChatId === chat.id) {
                      setActiveMenuChatId(null);
                      return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    setChatMenuPos({
                      x: Math.min(Math.max(r.right - 224, 12), window.innerWidth - 236),
                      y: Math.min(r.bottom + 6, window.innerHeight - 332),
                    });
                    setActiveMenuChatId(chat.id);
                  }}
                  className={`absolute right-1.5 top-1.5 w-[22px] h-[22px] min-h-0 min-w-0 flex items-center justify-center rounded-[6px] bg-[#F1EBDD] text-[#6E7568] hover:text-[#21261F] transition-opacity ${
                    activeMenuChatId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Дії з бесідою"
                >
                  <MoreVertical className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
            );
          })
        )}
        </div>

        {/* Mobile Floating Action Button (FAB) for starting a new chat */}
        <button
          onClick={() => {
            soundFx.playTap();
            onNewChat();
          }}
          className="md:hidden fixed bottom-18 right-4 w-13 h-13 bg-[#E87A42] hover:bg-[#C25925] text-[#FFF8F2] rounded-full shadow-xl flex items-center justify-center active:scale-90 z-25 transition-transform border-2 border-[#FDFCF9]"
          title="Новий діалог"
          aria-label="Новий діалог"
        >
          <Plus className="w-6 h-6" />
        </button>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="md:hidden border-t border-[#E6DFD3] bg-[#FDFCF9] px-3 pt-2 pb-[calc(var(--sab)+0.5rem)] flex items-center justify-around shrink-0 z-10">
          <button
            onClick={() => {
              soundFx.playTap();
              onSelectFolder('all');
            }}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors active:scale-95 ${
              activeFolderId === 'all' ? 'text-[#E87A42]' : 'text-[#728178] hover:text-[#1E2521]'
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
            className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1E2521] transition-colors active:scale-95"
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
              className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1E2521] transition-colors active:scale-95"
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
            className="flex flex-col items-center gap-0.5 text-[10px] font-bold text-[#728178] hover:text-[#1E2521] transition-colors active:scale-95"
          >
            <Settings className="w-5 h-5" />
            <span>Параметри</span>
          </button>
        </nav>

      {/* 5.5 Меню бесіди (три крапки) — fixed, щоб його не різав скрол списку */}
      {menuChat && chatMenuPos && (
        <div
          ref={chatMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ top: chatMenuPos.y, left: chatMenuPos.x }}
          className="fixed z-50 w-56 max-h-80 overflow-y-auto no-scrollbar p-2 bg-[#FDFCF9] border border-[#E0D5C2] rounded-2xl shadow-xl space-y-1 animate-in fade-in duration-100 text-[#1E2521]"
        >
          <div className="px-2 py-1 text-[10px] font-extrabold text-[#8A9186] uppercase tracking-wider flex items-center justify-between">
            <span className="truncate">{displayTitle(menuChat.title)}</span>
            <button
              onClick={() => setActiveMenuChatId(null)}
              className="text-[#8A9186] hover:text-[#1E2521] shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {renamingChatId === menuChat.id ? (
            /* Інлайн-перейменування — замість мертвого нативного prompt */
            <div className="p-1.5 space-y-1.5">
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRenameChat(menuChat);
                  if (e.key === 'Escape') setRenamingChatId(null);
                }}
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-[#E0D5C2] bg-white focus:outline-none focus:border-[#E87A42]"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void saveRenameChat(menuChat)}
                  className="px-3 py-1.5 rounded-lg bg-[#E87A42] text-[#1E2521] text-[11px] font-bold active:scale-95 transition-transform"
                >
                  Зберегти
                </button>
                <button
                  onClick={() => setRenamingChatId(null)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#5F6A60] hover:bg-[#F1EBDD] transition-colors"
                >
                  Скасувати
                </button>
              </div>
            </div>
          ) : chatConfirm ? (
            /* Підтвердження деструктивної дії — з чесним текстом про межі видалення */
            <div className="p-1.5 space-y-2">
              <span className="text-[11px] text-[#5F6A60] leading-relaxed block px-0.5">
                {chatConfirm === 'clear'
                  ? 'Історія зникне з цього вузла. Копію співрозмовника ми не чіпаємо.'
                  : 'Розмова зникне з цього вузла; копію співрозмовника не чіпаємо.'}
              </span>
              <div className="flex items-center gap-2 px-0.5">
                <button
                  onClick={() =>
                    chatConfirm === 'clear'
                      ? void handleClearChat(menuChat)
                      : void handleDeleteChat(menuChat)
                  }
                  className="px-3 py-1.5 rounded-lg bg-[#B4432E] text-[#FDFCF9] text-[11px] font-bold active:scale-95 transition-transform"
                >
                  {chatConfirm === 'clear' ? 'Очистити' : 'Видалити'}
                </button>
                <button
                  onClick={() => setChatConfirm(null)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#5F6A60] hover:bg-[#F1EBDD] transition-colors"
                >
                  Скасувати
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => startRenameChat(menuChat)}
                className="w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center gap-1.5 text-[#1E2521] hover:bg-[#F4F1E8] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5 text-[#C25925] shrink-0" />
                <span>Перейменувати</span>
              </button>

              <button
                onClick={() => void handleMarkChatRead(menuChat)}
                className="w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center gap-1.5 text-[#1E2521] hover:bg-[#F4F1E8] transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5 text-[#3F7A4B] shrink-0" />
                <span>Позначити прочитаним</span>
              </button>

              <button
                onClick={() => setChatConfirm('clear')}
                className="w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center gap-1.5 text-[#1E2521] hover:bg-[#F4F1E8] transition-colors"
              >
                <Eraser className="w-3.5 h-3.5 text-[#8A9186] shrink-0" />
                <span>Очистити історію</span>
              </button>

              <button
                onClick={() => setChatConfirm('delete')}
                className="w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center gap-1.5 text-[#B4432E] hover:bg-[#F7ECE7] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Видалити розмову</span>
              </button>

              <div className="px-2 pt-1.5 text-[10px] font-extrabold text-[#8A9186] uppercase tracking-wider border-t border-[#EFEBE0]">
                Призначити папку
              </div>

              {smartFolders
                .filter((f) => !f.isBuiltIn)
                .map((folder) => {
                  const isIn = isChatInFolder(menuChat, folder);
                  return (
                    <button
                      key={folder.id}
                      onClick={() => {
                        soundFx.playTap();
                        if (isIn) {
                          onRemoveChatFromFolder(folder.id, menuChat.id);
                          showToast(`Видалено з «${folder.name}»`);
                        } else {
                          onAddChatToFolder(folder.id, menuChat.id);
                          soundFx.playSend();
                          showToast(`✨ Додано до «${folder.name}»`);
                        }
                        setActiveMenuChatId(null);
                      }}
                      className={`w-full p-1.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                        isIn
                          ? 'bg-[#F4F1E8] text-[#C25925] border border-[#E0D5C2]'
                          : 'hover:bg-[#F4F1E8] text-[#5F6A60] hover:text-[#1E2521]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span>{folder.emoji}</span>
                        <span className="truncate">{folder.name}</span>
                      </div>
                      {isIn && <Check className="w-3.5 h-3.5 text-[#C25925] shrink-0" />}
                    </button>
                  );
                })}

              <div className="pt-1 border-t border-[#EFEBE0]">
                <button
                  onClick={() => {
                    setActiveMenuChatId(null);
                    onOpenCreateFolder();
                  }}
                  className="w-full p-1.5 rounded-xl text-left text-xs font-bold text-[#C25925] hover:bg-[#F4F1E8] flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Новий простір</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 6. HOVER TOOLTIP FOR SMART FOLDERS (.smart-folder-item) */}
      {hoveredFolderStats && !folderContextMenu && !inlineEditingFolderId && (
        <div
          className="fixed z-40 bg-[#FDFCF9] text-[#1E2521] border border-[#E0D5C2] rounded-xl shadow-xl px-3 py-2 text-xs pointer-events-none animate-in fade-in slide-in-from-top-1 duration-150 flex flex-col gap-1.5 min-w-44 max-w-64"
          style={{
            top: hoveredFolderStats.y,
            left: hoveredFolderStats.x,
          }}
        >
          {/* Folder Name & Emoji */}
          <div className="flex items-center justify-between gap-2 border-b border-[#E6DFD3] pb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs">{hoveredFolderStats.folder.emoji}</span>
              <span className="font-extrabold text-xs text-[#1E2521] truncate">
                {hoveredFolderStats.folder.name}
              </span>
            </div>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: hoveredFolderStats.folder.color || '#E87A42' }}
            />
          </div>

          {/* Counts: Total chats and total unread message count */}
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <div className="flex items-center gap-1 text-[#7A8479]">
              <MessageCircle className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
              <span>Чати:</span>
              <span className="font-extrabold text-[#1E2521]">{hoveredFolderStats.stats.total}</span>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[#7A8479]">Непрочитані:</span>
              {hoveredFolderStats.stats.unread > 0 ? (
                <span className="px-1.5 py-0.2 bg-[#E87A42] text-[#F7F5EE] text-[10px] font-black rounded-full shadow-sm">
                  {hoveredFolderStats.stats.unread}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-[#E87A42]">
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
          className="fixed z-50 w-72 max-h-[calc(100vh-28px)] overflow-y-auto no-scrollbar bg-[#FDFCF9]/98 backdrop-blur-md border border-[#DDD4C4] rounded-2xl shadow-2xl p-1.5 space-y-1.5 animate-in fade-in slide-in-from-left-2 duration-150 ease-out text-[#1E2521] select-none"
          style={{
            top: folderContextMenu.y,
            left: folderContextMenu.x,
          }}
        >
          {/* Menu Header with Folder Info */}
          <div className="px-2.5 py-2 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] rounded-xl">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base shrink-0">{folderContextMenu.folder.emoji}</span>
              <div className="min-w-0">
                <h4 className="font-extrabold text-xs text-[#1E2521] truncate">
                  {folderContextMenu.folder.name}
                </h4>
                <p className="text-[10px] text-[#5F6A60] truncate">
                  {folderContextMenu.folder.vibe || 'Розумний простір'}
                </p>
              </div>
            </div>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
              style={{ backgroundColor: folderContextMenu.folder.color || '#E87A42' }}
            />
          </div>

          {/* Section 1: Actions */}
          <div className="space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#5F6A60] uppercase tracking-wider">
              Основні дії
            </div>

            {/* Mark all as read */}
            <button
              onClick={() => handleMarkAllAsReadAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CheckCheck className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Позначити як прочитані</span>
              </div>
              {getFolderUnreadCount(folderContextMenu.folder) > 0 && (
                <span className="px-1.5 py-0.2 bg-[#E87A42] text-[#F7F5EE] text-[9px] font-extrabold rounded-full shrink-0">
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
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Priority View (лише нові)</span>
              </div>
              {getFolderUnreadCount(folderContextMenu.folder) > 0 && (
                <span className="px-1.5 py-0.2 bg-[#E87A42] text-[#F7F5EE] text-[9px] font-extrabold rounded-full shrink-0">
                  {getFolderUnreadCount(folderContextMenu.folder)}
                </span>
              )}
            </button>

            {/* Quick Preview (Last 3 messages from most recent chat) */}
            <button
              onClick={() => handleOpenQuickPreview(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Eye className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Швидкий перегляд (3 ост.)</span>
              </div>
              <span className="text-[10px] text-[#5F6A60] font-mono shrink-0 whitespace-nowrap">
                Останній чат
              </span>
            </button>

            {/* Toggle Notifications (Mute / Unmute) */}
            <button
              onClick={() => handleToggleMuteAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {folderContextMenu.folder.isMuted ? (
                  <Bell className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                ) : (
                  <BellOff className="w-3.5 h-3.5 text-[#5F6A60] shrink-0" />
                )}
                <span className="truncate">
                  {folderContextMenu.folder.isMuted ? 'Увімкнути звук' : 'Вимкнути звук'}
                </span>
              </div>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap ${
                  folderContextMenu.folder.isMuted
                    ? 'bg-[#E6DFD3] text-[#5F6A60]'
                    : 'bg-[#F1EDE3] text-[#E87A42]'
                }`}
              >
                {folderContextMenu.folder.isMuted ? '🔕 Muted' : '🔔 Active'}
              </span>
            </button>
          </div>

          {/* Section 2: Style & Customization */}
          <div className="border-t border-[#E6DFD3] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#5F6A60] uppercase tracking-wider">
              Стиль & Персоналізація
            </div>

            {/* Set Folder Accent Color */}
            <div>
              <button
                onClick={() => {
                  setIsColorPaletteOpen(!isColorPaletteOpen);
                  setIsVibePaletteOpen(false);
                }}
                className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Palette className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                  <span className="truncate">Колірний акцент</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="w-3 h-3 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: folderContextMenu.folder.color || '#E87A42' }}
                  />
                  <ChevronDown
                    className={`w-3 h-3 text-[#5F6A60] transition-transform ${
                      isColorPaletteOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {isColorPaletteOpen && (
                <div className="p-2 bg-[#FDFCF9] rounded-xl mt-1 space-y-2 border border-[#E6DFD3] animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#5F6A60]">
                    <span>Палітра:</span>
                    <span
                      className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-[#F7F5EE] border border-[#E6DFD3] font-bold"
                      style={{ color: folderContextMenu.folder.color || '#E87A42' }}
                    >
                      {folderContextMenu.folder.color || '#E87A42'}
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
                              ? 'ring-2 ring-white scale-105 shadow-sm font-bold text-[#1E2521]'
                              : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.label}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#1E2521] stroke-[3]" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E6DFD3]">
                    <label
                      htmlFor="folder-custom-color"
                      className="text-[10px] font-bold text-[#5F6A60] flex items-center gap-1 cursor-pointer flex-1"
                    >
                      <Pipette className="w-3 h-3 text-[#5F6A60]" />
                      <span>Свій відтінок:</span>
                    </label>
                    <input
                      id="folder-custom-color"
                      type="color"
                      value={folderContextMenu.folder.color || '#E87A42'}
                      onChange={(e) => handleSetColorAction(folderContextMenu.folder, e.target.value)}
                      className="w-8 h-6 p-0 border border-[#E6DFD3] rounded-md cursor-pointer bg-transparent"
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
                className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                  <span className="truncate">Налаштувати Vibe</span>
                </div>
                <ChevronDown
                  className={`w-3 h-3 text-[#5F6A60] transition-transform shrink-0 ${
                    isVibePaletteOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isVibePaletteOpen && (
                <div className="p-2 bg-[#FDFCF9] rounded-xl mt-1 space-y-2 border border-[#E6DFD3] animate-in fade-in slide-in-from-top-1 duration-150">
                  <label className="block text-[10px] font-bold text-[#5F6A60]">
                    Швидкі пресети:
                  </label>
                  <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                    {vibePresets.map((v) => (
                      <button
                        key={v}
                        onClick={() => handleSetVibeAction(folderContextMenu.folder, v)}
                        className="text-left text-[11px] px-2 py-1 bg-[#F7F5EE] hover:bg-[#F9F7F1] rounded-lg text-[#1E2521] font-medium truncate transition-colors border border-[#E6DFD3]"
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
                      className="flex-1 px-2 py-1 text-[11px] bg-[#F7F5EE] border border-[#E6DFD3] rounded-lg text-[#1E2521] placeholder-[#5F6A60] focus:outline-none focus:border-[#E87A42]"
                    />
                    <button
                      onClick={() => handleSetVibeAction(folderContextMenu.folder, customVibeInput)}
                      disabled={!customVibeInput.trim()}
                      className="px-2 py-1 bg-[#E87A42] hover:bg-[#C25925] disabled:opacity-50 text-[#F7F5EE] text-[10px] font-bold rounded-lg transition-colors shrink-0"
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
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Smile className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Змінити Emoji</span>
              </div>
              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-[#FDFCF9] border border-[#E6DFD3] shrink-0">
                {folderContextMenu.folder.emoji}
              </span>
            </button>
          </div>

          {/* Section 3: Tools & Sharing */}
          <div className="border-t border-[#E6DFD3] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#5F6A60] uppercase tracking-wider">
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
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <BarChart2 className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Склад папки</span>
              </div>
            </button>

            {/* Copy Folder Link (Deep Link) */}
            <button
              onClick={() => handleCopyFolderLinkAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Копіювати посилання</span>
              </div>
              <span className="text-[10px] text-[#E87A42] font-mono font-bold bg-[#F1EDE3] px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap">
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
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Share2 className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Поділитися простором</span>
              </div>
              <span className="text-[10px] text-[#5F6A60] font-mono shrink-0 whitespace-nowrap">
                Код
              </span>
            </button>

            {/* Export Chat List as JSON */}
            <button
              onClick={() => handleExportChatListAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Download className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
                <span className="truncate">Експорт чатів</span>
              </div>
              <span className="text-[10px] text-[#E87A42] font-mono font-bold bg-[#F1EDE3] px-1.5 py-0.2 rounded shrink-0 whitespace-nowrap">
                JSON
              </span>
            </button>
          </div>

          {/* Section 4: Management */}
          <div className="border-t border-[#E6DFD3] pt-1 space-y-0.5">
            <div className="px-2 py-0.5 text-[9px] font-extrabold text-[#5F6A60] uppercase tracking-wider">
              Керування
            </div>

            {/* Rename Folder (Inline overlay) */}
            <button
              onClick={() => handleStartRename(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center gap-2 text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
              <span className="truncate">Перейменувати</span>
            </button>

            {/* Edit Folder */}
            <button
              onClick={() => {
                const f = folderContextMenu.folder;
                setFolderContextMenu(null);
                onOpenEditFolder(f);
              }}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center gap-2 text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <FolderEdit className="w-3.5 h-3.5 text-[#5F6A60] shrink-0" />
              <span className="truncate">Налаштувати простір...</span>
            </button>

            {/* Archive / Restore Folder */}
            <button
              onClick={() => handleToggleArchiveAction(folderContextMenu.folder)}
              className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center justify-between text-[#1E2521] hover:text-[#1E2521] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {folderContextMenu.folder.isArchived ? (
                  <ArchiveRestore className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
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
                    ? 'bg-[#F1EDE3] text-[#E87A42]'
                    : 'bg-[#F4AF25]/15 text-[#F4AF25]'
                }`}
              >
                {folderContextMenu.folder.isArchived ? 'Відновити' : 'Архів'}
              </span>
            </button>

            {/* Clear / Delete for custom folders */}
            {!folderContextMenu.folder.isBuiltIn && (
              <div className="border-t border-[#E6DFD3] pt-1 space-y-0.5">
                <button
                  onClick={() => handleClearFolderAction(folderContextMenu.folder)}
                  className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F9F7F1] text-left text-xs font-semibold flex items-center gap-2 text-[#5F6A60] hover:text-[#1E2521] transition-colors"
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Очистити чати</span>
                </button>

                <button
                  onClick={() => handleDeleteFolderAction(folderContextMenu.folder)}
                  className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[#F7E3DC] text-left text-xs font-semibold flex items-center gap-2 text-[#B4442A] transition-colors"
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
          className="fixed z-50 w-80 sm:w-88 bg-[#FDFCF9]/98 backdrop-blur-md border border-[#DDD4C4] rounded-2xl shadow-2xl p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-200 text-[#1E2521]"
          style={{
            top: quickPreview.y,
            left: quickPreview.x,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-[#E6DFD3] pb-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar src={quickPreview.chat.avatar} name={quickPreview.chat.title} className="w-8 h-8     shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="font-extrabold text-xs text-[#1E2521] truncate">
                    {quickPreview.chat.title}
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.2 bg-[#FDFCF9] text-[#E87A42] font-bold rounded-md shrink-0 border border-[#E6DFD3]">
                    {quickPreview.folder.emoji} {quickPreview.folder.name}
                  </span>
                </div>
                <p className="text-[10px] text-[#5F6A60] truncate">
                  {quickPreview.chat.description || quickPreview.chat.topic || 'Остання активність у просторі'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setQuickPreview(null)}
              className="p-1 hover:bg-[#F9F7F1] rounded-lg text-[#5F6A60] hover:text-[#1E2521] transition-colors shrink-0"
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
                    <Avatar src={msg.senderAvatar || quickPreview.chat.avatar} name={msg.senderName} className="w-5 h-5   shrink-0 mt-0.5" />
                  )}
                  <div
                    className={`rounded-xl px-2.5 py-1.5 max-w-[85%] space-y-0.5 ${
                      isSelf
                        ? 'bg-[#F6E3D4] border border-[#EAD6C4] text-[#1E2521] rounded-tr-xs shadow-sm'
                        : 'bg-[#FDFCF9] border border-[#E6DFD3] text-[#1E2521] rounded-tl-xs shadow-sm'
                    }`}
                  >
                    {!isSelf && (
                      <span className="font-extrabold text-[10px] text-[#E87A42] block leading-none">
                        {msg.senderName}
                      </span>
                    )}
                    <p className="text-xs break-words line-clamp-3 leading-relaxed">
                      {msg.text || (msg.mediaUrl ? '📎 Вкладення' : msg.voiceDuration ? '🎤 Голосове' : 'Повідомлення')}
                    </p>
                    <span
                      className={`text-[9px] block text-right font-mono ${
                        isSelf ? 'text-[#8A9186]' : 'text-[#8A9186]'
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
          <div className="pt-2 border-t border-[#E6DFD3] flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-[#5F6A60] flex items-center gap-1">
              <Eye className="w-3 h-3 text-[#E87A42]" />
              <span>Швидкий перегляд</span>
            </span>

            <button
              onClick={() => {
                onSelectFolder(quickPreview.folder.id);
                onSelectChat(quickPreview.chat.id);
                setQuickPreview(null);
                soundFx.playTap();
              }}
              className="px-3 py-1.5 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
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
        />
      )}

      {/* 10. Folder Insights Modal (склад папки) */}
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
            className="w-full flex items-center justify-between text-xs font-bold text-[#7A8479] hover:text-[#1E2521] px-1.5 py-1 rounded-lg hover:bg-white/40 transition-colors select-none"
          >
            <div className="flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5 text-[#8C461A]" />
              <span>Архів просторів</span>
              <span className="px-1.5 py-0.2 bg-[#DFD6C5] text-[#5E6B62] rounded-full text-[10px] font-extrabold">
                {smartFolders.filter((f) => f.isArchived).length}
              </span>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#7A8479] transition-transform duration-200 ${
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
                          ? 'bg-white text-[#1E2521] font-bold shadow-xs border-[#C9BFA8] ring-1 ring-[#8C988E]'
                          : 'bg-white/45 text-[#7A8479] hover:bg-white/90 border-dashed border-[#D2C5B2]'
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
                        className={`w-4.5 h-4.5 rounded-md flex items-center justify-center text-xs shrink-0 bg-[#E8DFD1]/60 text-[#7A8479] hover:scale-110 transition-all ${
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
                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#DFD6C5]/70 text-[#7A8479] font-mono font-bold">
                        Архів
                      </span>
                      {folderUnread > 0 && (
                        <span className="px-1.5 py-0.2 bg-[#DFD6C5] text-[#5E6B62] text-[9px] font-bold rounded-full">
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
                        className="folder-settings opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#DFD6C5] rounded-md text-[#7A8479] hover:text-[#1E2521] transition-all cursor-pointer hover:scale-110 active:scale-95 ml-0.5"
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
      <div className="p-2 border-t border-[#E8E1D3] bg-[#F7F5EF] relative">
        {/* Persona quick switcher popup */}
        {isPersonaMenuOpen && onSwitchPersonaSphere && (
          <div className="absolute bottom-full left-2 right-2 mb-2 p-2 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] rounded-2xl shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100 text-[#1E2521]">
            <div className="px-2 py-1 text-[10px] font-extrabold text-[#5F6A60] uppercase tracking-wider">
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
                  className={`w-full px-2 py-1.5 rounded-[10px] text-left flex items-center justify-between text-[13px] font-medium transition-colors ${
                    isSelected
                      ? 'bg-[#F1EBDD] text-[#21261F] border border-[#E0D7C4]'
                      : 'hover:bg-[#F7F5EF] text-[#21261F] border border-transparent'
                  }`}
                >
                  <span>{meta.label}</span>
                  <span className="text-[11.5px] text-[#6E7568]">
                    {currentUser.personas?.[sphere]?.statusText || 'В мережі'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-stretch gap-1.5">
          {/* Main user clickable card */}
          <div
            onClick={() => {
              soundFx.playTap();
              onOpenUserProfile();
            }}
            className="flex-1 px-2 py-1.5 bg-transparent hover:bg-[#F1EBDD]/60 border border-[#E8E1D3] rounded-[10px] flex items-center justify-between cursor-pointer transition-colors min-w-0"
            title="Відкрити картку профілю"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar src={currentUser.avatar} name={currentUser.name} className="w-8 h-8 shrink-0" />

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[13px] text-[#21261F] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <span className="px-1 py-px text-[10px] rounded-[4px] uppercase tracking-[.06em] border border-[#E8E1D3] text-[#98A092] leading-[13px] shrink-0">
                    {activeSphere}
                  </span>
                </div>
                <p className="text-[11.5px] text-[#6E7568] truncate leading-tight">
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
            className="w-[36px] min-h-0 min-w-0 flex items-center justify-center bg-transparent hover:bg-[#F1EBDD]/60 border border-[#E8E1D3] rounded-[10px] text-[#6E7568] hover:text-[#21261F] transition-colors shrink-0"
            title="Швидка зміна сфери"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${isPersonaMenuOpen ? 'rotate-180' : ''}`} strokeWidth={1.75} />
          </button>
        </div>

        {/* Козир черги, зроблений видимим: тихий рядок, лише коли є що чекати. */}
        {queuedCount > 0 && (
          <button
            onClick={() => {
              soundFx.playTap();
              if (onOpenP2PNetworkModal) onOpenP2PNetworkModal();
              else showToast(`${queuedCount} ${queuedCount === 1 ? 'лист' : queuedCount < 5 ? 'листи' : 'листів'} чекають на зв'язок`);
            }}
            className="mt-1.5 w-full px-2 py-1.5 rounded-[10px] flex items-center gap-2 text-left text-[11.5px] text-[#6E7568] border border-transparent hover:bg-[#F1EBDD]/60 hover:border-[#E8E1D3] transition-colors"
            title="Листи чекають на зв'язок — натисніть, щоб побачити чергу"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#C98A2E] shrink-0" />
            <Inbox className="w-3.5 h-3.5 text-[#98A092] shrink-0" strokeWidth={1.75} />
            <span className="truncate">
              {queuedCount} {queuedCount === 1 ? 'лист' : queuedCount < 5 ? 'листи' : 'листів'} чекають
            </span>
          </button>
        )}
      </div>
      </div>
    </aside>
  );
};
