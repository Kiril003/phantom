import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, useLayoutEffect, forwardRef } from 'react';
import {
  MapPin,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Pin,
  Clock,
  Copy,
  Receipt,
  BarChart2,
  Volume2,
  VolumeX,
  Reply,
  CheckSquare,
  Square,
  Quote,
  Forward,
  MoreHorizontal,
  Edit2,
  Trash2,
  Download,
  FileText,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Languages,
  Bookmark,
  SmilePlus,
  ArrowDown,
  Info,
  CheckCircle2,
  Globe,
  Radio,
  Check,
  AlertCircle,
  MessageSquare
} from 'lucide-react';
import { Message, LocationData, TableData, TaskListData, Chat } from '../../types/messenger';
import { Avatar } from './Avatar';
import { soundFx } from '../../utils/messengerSound';
import { chatApi } from '../../services/api';
import { messengerApi } from '../../services/messengerApi';
import { useMessengerStore } from '../../stores/messengerStore';
import { DataTableViewer } from './DataTableViewer';
import { ChartEmbed } from './ChartEmbed';
import { TaskListEmbed } from './TaskListEmbed';
import { MultiQuoteEmbed } from './MultiQuoteEmbed';
import { FormattedMessageText } from './FormattedMessageText';
import { HighlightedText } from './HighlightedText';
import { SecureMediaBubble } from './SecureMediaBubble';
import { GeoPointBubble } from './GeoPointBubble';
import { ReactionPickerModal } from './ReactionPickerModal';
import { MessageDetailsModal } from './MessageDetailsModal';
import { DeleteMessageModal } from './DeleteMessageModal';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { CanvasSplitView } from './CanvasSplitView';
import { CanvasCardEmbed } from './widgets/CanvasCardEmbed';
import { KanbanWidgetEmbed } from './widgets/KanbanWidgetEmbed';
import { VotingWidgetEmbed } from './widgets/VotingWidgetEmbed';
import { RACIWidgetEmbed } from './widgets/RACIWidgetEmbed';
import { CodeRunnerWidgetEmbed } from './widgets/CodeRunnerWidgetEmbed';
import { MermaidEmbed } from './embeds/MermaidEmbed';
import { CodeDiffEmbed } from './embeds/CodeDiffEmbed';
import { WebhookEventEmbed } from './embeds/WebhookEventEmbed';
import { ActionItemChip } from './ActionItemChip';
import { Layers } from 'lucide-react';

interface ChatAreaProps {
  currentChat?: Chat;
  messages: Message[];
  currentUserId: string;
  onOpenLocation: (loc: LocationData) => void;
  onVotePoll: (messageId: string, optionId: string) => void;
  onPayBillShare: (messageId: string, participantId: string) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
  onReplyMessage: (msg: Message, quoteSelectedText?: string) => void;
  onEditMessage?: (msg: Message) => void;
  onDeleteMessage?: (msgId: string, forEveryone?: boolean) => void;
  onTogglePinMessage?: (msgId: string) => void;
  onForwardMessage?: (msg: Message) => void;
  onSelectMemberByName?: (name: string) => void;
  selectedMessageIds: string[];
  onToggleSelectMessage: (id: string) => void;
  isSelectionMode: boolean;
  onUpdateTableData?: (messageId: string, updatedTable: TableData) => void;
  onUpdateTaskListData?: (messageId: string, updatedTaskList: TaskListData) => void;
  onOpenImageLightbox?: (imgUrl: string, title?: string) => void;
  isSearching: boolean;
  onCloseSearch: () => void;
  isAiTyping?: boolean;
}

// Шапка не має власного доступу до стрічки: закріплене гортає ChatArea.
export interface ChatAreaHandle {
  scrollToPinned: () => void;
}

export const quickReactions = ['❤️', '🔥', '👍', '👏', '💡', '🎉'];

/**
 * Імʼя вкладення для меню й озвучення.
 *
 * Справжні вкладення живуть у msg.media, показові — у msg.fileData; читання
 * лише другого давало «Файл: undefined» на кожному живому файлі.
 */
const attachmentName = (msg: Message): string =>
  msg.media?.name || msg.fileData?.name || 'без імені';

export const translationLanguages = [
  { code: 'EN', name: 'English (EN)' },
  { code: 'UA', name: 'Українська (UA)' },
  { code: 'DE', name: 'Deutsch (DE)' },
  { code: 'PL', name: 'Polski (PL)' },
  { code: 'ES', name: 'Español (ES)' },
];

export const ChatArea = forwardRef<ChatAreaHandle, ChatAreaProps>(({
  currentChat,
  messages,
  currentUserId,
  onOpenLocation,
  onVotePoll,
  onPayBillShare,
  onAddReaction,
  onReplyMessage,
  onEditMessage,
  onDeleteMessage,
  onTogglePinMessage,
  onForwardMessage,
  onSelectMemberByName,
  selectedMessageIds,
  onToggleSelectMessage,
  isSelectionMode,
  onUpdateTableData,
  onUpdateTaskListData,
  onOpenImageLightbox,
  isSearching,
  onCloseSearch,
  isAiTyping = false,
}, ref) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<number>(0);
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Record<string, boolean>>({});
  const [expandedTranscripts, setExpandedTranscripts] = useState<Record<string, boolean>>({});
  
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [contextMenuMsg, setContextMenuMsg] = useState<Message | null>(null);

  // Довгий тап відкриває шторку дій, а вона кладе заслінку на весь екран.
  // Escape її не закривав — і телефон стояв мертвий, доки людина не здогадається
  // тицьнути повз.
  const closeContextMenu = useCallback(() => setContextMenuMsg(null), []);
  useEscapeClose(!!contextMenuMsg, closeContextMenu);

  // Modals
  const [isReactionModalOpen, setIsReactionModalOpen] = useState(false);
  const [targetReactionMsgId, setTargetReactionMsgId] = useState<string | null>(null);
  const [inspectingMessage, setInspectingMessage] = useState<Message | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);

  // Відповіді локального агента на повідомлення (переклад, підсумок, завдання)
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, { text: string; lang: string }>>({});
  const [summarizedMessages, setSummarizedMessages] = useState<Record<string, string>>({});
  const [actionItemMessages, setActionItemMessages] = useState<Record<string, string[]>>({});
  const [agentTask, setAgentTask] = useState<{ msgId: string; label: string } | null>(null);
  const [savedMessages, setSavedMessages] = useState<Record<string, boolean>>({});
  const [toastNotification, setToastNotification] = useState<string | null>(null);
  const [isCanvasSplitOpen, setIsCanvasSplitOpen] = useState(false);
  const [canvasWidthMode, setCanvasWidthMode] = useState<'half' | 'wide' | 'full'>('half');

  // Floating text selection snippet for quick partial quoting
  const [selectedTextSnippet, setSelectedTextSnippet] = useState<{
    text: string;
    msg: Message;
    x: number;
    y: number;
  } | null>(null);

  // Scroll to bottom tracking
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  /** Скільки чужих листів прийшло, поки людина читала історію вище. */
  const [newIncoming, setNewIncoming] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Людина зараз біля низу — тоді нове тягне стрічку за собою. */
  const atBottomRef = useRef(true);
  /** Чи вже приземлились у низ цієї розмови (перше відкриття). */
  const landedRef = useRef(false);
  /** Доки триває стрибок до листа — тримання низу мовчить. */
  const jumpUntilRef = useRef(0);
  const landedChatRef = useRef<string | undefined>(undefined);
  const seenCountRef = useRef(0);

  // In-chat search state
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);

  // Pinned messages navigation
  const pinnedMessages = (messages || []).filter((m) => m && m.isPinned);
  const [currentPinnedIndex, setCurrentPinnedIndex] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Mobile Touch Gestures & TTS State
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [swipingMsgId, setSwipingMsgId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const isTouchSwipingRef = useRef<boolean>(false);
  const longPressTimerRef = useRef<any>(null);
  const lastTapRef = useRef<Record<string, number>>({});

  const toggleExpandMessage = (msgId: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    soundFx.playTap();
    setExpandedMsgIds((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const showToast = (text: string) => {
    setToastNotification(text);
    setTimeout(() => setToastNotification(null), 2500);
  };

  // Картка «шлях листа» — клік по статусу власного повідомлення відкриває, де
  // лист лежить зараз і що з ним далі. Раніше галочка була мертвим <span>.
  const [pathCardMsgId, setPathCardMsgId] = useState<string | null>(null);
  const [queueInfo, setQueueInfo] = useState<{ queued: number } | null>(null);
  const [flushing, setFlushing] = useState(false);

  // Картка теж кладе заслінку (z-30) — виходити з неї треба тим самим Escape.
  const closePathCard = useCallback(() => setPathCardMsgId(null), []);
  useEscapeClose(!!pathCardMsgId, closePathCard);

  // Що саме тримає лист: байти вкладення чи сам кадр із ключем. Байти могли
  // доїхати першими — тоді казати «вкладення чекає» було б новою неточністю
  // замість старої.
  const stuckAttachment = (msg?: Message): 'queued' | 'parked' | null => {
    const st = msg?.attachmentState;
    if (!msg?.media || !st || st === 'sent' || st === 'stored') return null;
    return st === 'parked' ? 'parked' : 'queued';
  };

  const statusLabel = (status?: Message['status'], msg?: Message): string => {
    // Вкладення застрягло — кажемо саме про нього. «У черзі» звучало б так,
    // ніби чекає текст, а насправді в людини немає файла.
    const stuck = status === 'queued' ? stuckAttachment(msg) : null;
    if (stuck) {
      return stuck === 'parked'
        ? 'Вкладення в дорозі через хмару'
        : 'Вкладення очікує передачі';
    }
    switch (status) {
      case 'sending': return 'Надсилається';
      case 'queued': return 'У черзі — чекає на співрозмовника';
      case 'sent': return 'Надіслано на вузол';
      case 'failed': return 'Не вдалося надіслати';
      default: return '';
    }
  };

  // Короткий підпис при бульбашці. Стоїть біля значка ЗАВЖДИ, без наведення:
  // на дотиковому екрані hover не існує, а «твоє фото не поїхало» не має права
  // важити вісім пікселів. Для доставленого підпису немає — це тиша за
  // замовчуванням, а не приховане попередження.
  const statusNote = (status?: Message['status'], msg?: Message): string => {
    const stuck = status === 'queued' ? stuckAttachment(msg) : null;
    if (stuck) return stuck === 'parked' ? 'у дорозі через хмару' : 'чекає передачі';
    switch (status) {
      case 'sending': return 'надсилаю';
      case 'queued': return 'у черзі';
      case 'failed': return 'не пішло';
      default: return '';
    }
  };

  const statusDot = (status?: Message['status']): string => {
    switch (status) {
      case 'queued': return '#C98A2E';
      case 'failed': return '#C25A3A';
      case 'sent': return '#7E8B72';
      default: return 'var(--msg-meta-self)';
    }
  };

  const openPathCard = (msg: Message) => {
    soundFx.playTap();
    if (pathCardMsgId === msg.id) {
      setPathCardMsgId(null);
      return;
    }
    setPathCardMsgId(msg.id);
    setQueueInfo(null);
    if (msg.status === 'queued') {
      messengerApi.queueStatus().then(setQueueInfo).catch(() => setQueueInfo(null));
    }
  };

  // «Спробувати зараз» — проштовхуємо чергу вузла й перечитуємо стрічку, щоб
  // галочка застряглого листа сама змінилась із «у черзі» на «надіслано».
  const handleFlushQueue = async () => {
    setFlushing(true);
    try {
      const res = await messengerApi.flushQueue();
      showToast(res.delivered > 0 ? `Доставлено: ${res.delivered}` : 'Черга поки не рушила');
      const st = await messengerApi.queueStatus().catch(() => null);
      setQueueInfo(st);
      if (currentChat) await useMessengerStore.getState().loadMessagesForChat(currentChat.id);
    } catch {
      showToast('Не вдалося звернутися до черги вузла');
    } finally {
      setFlushing(false);
    }
  };

  // Text-To-Speech (TTS) Reader
  const handleSpeakMessage = (msg: Message) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Синтез мовлення не підтримується цим браузером');
      return;
    }

    if (speakingMsgId === msg.id) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      showToast('Озвучування зупинено');
      return;
    }

    window.speechSynthesis.cancel();
    const textToSpeak = msg.text || (msg.type === 'file' ? `Файл: ${attachmentName(msg)}` : msg.type === 'poll' ? `Опитування: ${msg.pollData?.question}` : 'Повідомлення');
    if (!textToSpeak) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const hasLatinWords = /[a-zA-Z]{5,}/.test(textToSpeak);
    utterance.lang = hasLatinWords ? 'en-US' : 'uk-UA';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);

    setSpeakingMsgId(msg.id);
    window.speechSynthesis.speak(utterance);
    showToast('Озвучую повідомлення…');
  };

  // Mobile Touch Event Handlers
  const handleTouchStart = (msg: Message, e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    isTouchSwipingRef.current = false;

    // Check for double tap (within 300ms)
    const now = Date.now();
    const lastTap = lastTapRef.current[msg.id] || 0;
    if (now - lastTap < 300) {
      clearTimeout(longPressTimerRef.current);
      lastTapRef.current[msg.id] = 0;
      soundFx.playTap();
      onAddReaction(msg.id, '❤️');
      showToast('Реакцію додано подвійним дотиком');
      return;
    }
    lastTapRef.current[msg.id] = now;

    // Start Long-Press Timer for Context Action Sheet
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      if (!isTouchSwipingRef.current) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(20); } catch { /* ignore */ }
        }
        soundFx.playTap();
        setContextMenuMsg(msg);
      }
    }, 420);
  };

  const handleTouchMove = (msg: Message, e: React.TouchEvent) => {
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartXRef.current;
    const diffY = touch.clientY - touchStartYRef.current;

    // If vertical scroll is larger than horizontal, cancel swipe and long press
    if (Math.abs(diffY) > 12 && !isTouchSwipingRef.current) {
      clearTimeout(longPressTimerRef.current);
      return;
    }

    // Horizontal swipe gesture for quick reply
    if (Math.abs(diffX) > 16) {
      clearTimeout(longPressTimerRef.current);
      isTouchSwipingRef.current = true;
      const isSelf = msg.senderId === currentUserId || msg.isSelf;
      // Clamp swipe offset
      const clampedOffset = isSelf
        ? Math.min(0, Math.max(-75, diffX))
        : Math.max(0, Math.min(75, diffX));
      setSwipingMsgId(msg.id);
      setSwipeOffset(clampedOffset);
    }
  };

  const handleTouchEnd = (msg: Message) => {
    clearTimeout(longPressTimerRef.current);
    if (swipingMsgId === msg.id) {
      if (Math.abs(swipeOffset) >= 44) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate([15, 30, 15]); } catch { /* ignore */ }
        }
        soundFx.playTap();
        onReplyMessage(msg);
        showToast('Відповісти на повідомлення');
      }
      setSwipingMsgId(null);
      setSwipeOffset(0);
    }
    isTouchSwipingRef.current = false;
  };

  // Один запит до локального агента PHANTOM. На порожню відповідь чи помилку
  // повертає null: показувати щось замість відповіді моделі не можна.
  const askLocalAgent = async (msgId: string, label: string, prompt: string): Promise<string | null> => {
    if (agentTask) return null;
    setAgentTask({ msgId, label });
    try {
      const res = await chatApi.sendMessage({ content: prompt, input_method: 'text' });
      const reply = (res?.message?.content || '').trim();
      if (!reply) {
        showToast('Локальний агент не повернув відповіді');
        return null;
      }
      return reply;
    } catch {
      showToast('Локальний агент недоступний');
      return null;
    } finally {
      setAgentTask(null);
    }
  };

  const handleToggleTranslate = async (msg: Message, targetLang: string = 'EN') => {
    soundFx.playTap();
    if (translatedMessages[msg.id] && translatedMessages[msg.id].lang === targetLang) {
      setTranslatedMessages((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }

    const originalText = (msg.text || '').trim();
    if (!originalText) return;

    const langName =
      translationLanguages.find((l) => l.code === targetLang)?.name || targetLang;
    const translation = await askLocalAgent(
      msg.id,
      `Перекладаю (${targetLang})…`,
      `Переклади це повідомлення на ${langName}. У відповідь дай лише переклад, без коментарів.\n\n${originalText}`
    );
    if (!translation) return;

    setTranslatedMessages((prev) => ({
      ...prev,
      [msg.id]: { text: translation, lang: targetLang },
    }));
  };

  const handleToggleSummary = async (msg: Message) => {
    soundFx.playTap();
    if (summarizedMessages[msg.id]) {
      setSummarizedMessages((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }

    const originalText = (msg.text || '').trim();
    if (!originalText) return;

    const summary = await askLocalAgent(
      msg.id,
      'Формую підсумок…',
      `Стисни це повідомлення до одного речення українською. У відповідь дай лише підсумок.\n\n${originalText}`
    );
    if (!summary) return;

    setSummarizedMessages((prev) => ({
      ...prev,
      [msg.id]: summary,
    }));
  };

  const handleMessageMouseUp = (msg: Message, _e?: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedStr = selection ? selection.toString().trim() : '';
    if (selectedStr.length > 1) {
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (rect) {
        setSelectedTextSnippet({
          text: selectedStr,
          msg,
          x: rect.left + rect.width / 2,
          y: Math.max(15, rect.top - 10),
        });
      }
    } else {
      setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) {
          setSelectedTextSnippet(null);
        }
      }, 100);
    }
  };

  const handleGenerateActionItems = async (msg: Message) => {
    soundFx.playChime();
    if (actionItemMessages[msg.id]) {
      setActionItemMessages((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }

    const originalText = (msg.text || '').trim();
    if (!originalText) return;

    const reply = await askLocalAgent(
      msg.id,
      'Шукаю завдання…',
      `Випиши завдання, які випливають із цього повідомлення, по одному в рядок, без нумерації. Якщо завдань немає — відповідай словом НЕМАЄ.\n\n${originalText}`
    );
    if (!reply) return;

    const items = reply
      .split('\n')
      .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter(Boolean);

    if (items.length === 0 || /^немає$/i.test(reply.trim())) {
      showToast('Завдань у повідомленні не знайдено');
      return;
    }

    setActionItemMessages((prev) => ({
      ...prev,
      [msg.id]: items,
    }));
  };

  const handleToggleBookmark = (msg: Message) => {
    soundFx.playSend();
    const isNowSaved = !savedMessages[msg.id];
    setSavedMessages((prev) => ({ ...prev, [msg.id]: isNowSaved }));
    showToast(isNowSaved ? 'Додано в «Збережене»' : 'Вилучено зі «Збереженого»');
  };

  /**
   * Стрічка — це низ, а не початок історії.
   *
   * Відкриття розмови садить нас у низ БЕЗ анімації: людина мусить бачити
   * останнє, а не подорож туди. Своє надіслане і чуже, що прийшло біля низу,
   * підтягують стрічку плавно. А якщо людина читає вище — не смикаємо її, а
   * рахуємо нове і кажемо про це кнопкою.
   */
  const pinBottom = (behavior: ScrollBehavior) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowScrollBottom(false);
    setNewIncoming(0);
  };

  // Scroll detection
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    // Перші кадри стрибка ще біля низу: якби ми тут повернули atBottom, тримач
    // низу вбив би сам стрибок.
    if (performance.now() < jumpUntilRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 150;
    atBottomRef.current = !isScrolledUp;
    setShowScrollBottom(isScrolledUp);
    if (!isScrolledUp) setNewIncoming(0);
  };

  const scrollToBottom = () => {
    soundFx.playTap();
    pinBottom('smooth');
  };

  // Стрічка приїжджає з вузла асинхронно, тож приземлення чекає на перші листи.
  // Скидання лічильників живе ТУТ, а не в окремому useEffect: той спрацював би
  // після цього ефекту, і перший кадр нової розмови встиг би порахувати чужу
  // історію як «нові повідомлення».
  useLayoutEffect(() => {
    if (!messagesContainerRef.current) return;
    const list = messages || [];
    const count = list.length;

    if (landedChatRef.current !== currentChat?.id) {
      landedChatRef.current = currentChat?.id;
      landedRef.current = false;
      seenCountRef.current = 0;
      atBottomRef.current = true;
      setNewIncoming(0);
      setShowScrollBottom(false);
    }

    if (!landedRef.current) {
      if (count === 0) return;
      landedRef.current = true;
      seenCountRef.current = count;
      pinBottom('auto');
      return;
    }

    if (count <= seenCountRef.current) {
      seenCountRef.current = count;
      return;
    }

    const added = list.slice(seenCountRef.current);
    seenCountRef.current = count;
    const mine = added.some((m) => m && (m.isSelf || m.senderId === currentUserId));
    if (mine || atBottomRef.current) {
      pinBottom('smooth');
    } else {
      setNewIncoming((n) => n + added.length);
    }
  }, [messages, currentChat?.id, currentUserId]);

  // Вміст доростає ВЖЕ ПІСЛЯ приземлення: фото дешифрується, бейдж «очікує
  // передачі» приходить відповіддю вузла, шрифт домальовується. Кожен такий
  // приріст лишав людину на кілька пікселів вище низу. Ловимо саму висоту —
  // це дешевше і чесніше, ніж вгадувати всі джерела приросту.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const el = messagesContainerRef.current;
      if (performance.now() < jumpUntilRef.current) return;
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`message-${msgId}`);
    if (el) {
      // Стрибок до листа означає, що ми більше НЕ внизу. Підсвітка додає
      // бульбашці рамку — висота стрічки росте, спалахує тримач низу і смикає
      // scrollTop назад у кінець, вбиваючи плавний перехід на першому ж кадрі.
      // Тож на час перельоту тримання низу мовчить.
      jumpUntilRef.current = performance.now() + 1200;
      atBottomRef.current = false;
      setShowScrollBottom(true);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(msgId);
      setTimeout(() => setHighlightedMessageId(null), 2500);
    }
  };

  // Закладка в шапці веде до ПЕРШОГО закріпленого і повертає банер на нього ж:
  // інакше банер лишався б на своєму місці гортання і показував інше повідомлення.
  useImperativeHandle(ref, () => ({
    scrollToPinned: () => {
      const first = pinnedMessages[0];
      if (!first) return;
      setCurrentPinnedIndex(0);
      scrollToMessage(first.id);
    },
  }));

  // Search in chat
  const searchMatchingIds = (isSearching && chatSearchQuery.trim())
    ? messages
        .filter((m) => {
          const q = chatSearchQuery.toLowerCase();
          return (
            (m.text && m.text.toLowerCase().includes(q)) ||
            (m.senderName && m.senderName.toLowerCase().includes(q)) ||
            (m.voiceData?.transcript && m.voiceData.transcript.toLowerCase().includes(q)) ||
            (m.locationData?.name && m.locationData.name.toLowerCase().includes(q)) ||
            (m.locationData?.address && m.locationData.address.toLowerCase().includes(q)) ||
            (m.pollData?.question && m.pollData.question.toLowerCase().includes(q)) ||
            (m.pollData?.options && m.pollData.options.some((opt) => opt.text.toLowerCase().includes(q))) ||
            (m.splitBillData?.title && m.splitBillData.title.toLowerCase().includes(q)) ||
            (m.splitBillData?.participants && m.splitBillData.participants.some((p) => p.name.toLowerCase().includes(q))) ||
            (m.tableData && m.tableData.title.toLowerCase().includes(q)) ||
            (m.chartData && m.chartData.title.toLowerCase().includes(q)) ||
            (m.taskListData && m.taskListData.title.toLowerCase().includes(q)) ||
            (m.fileData && m.fileData.name.toLowerCase().includes(q)) ||
            (m.codeData?.title && m.codeData.title.toLowerCase().includes(q)) ||
            (m.codeData?.code && m.codeData.code.toLowerCase().includes(q)) ||
            (m.imageData?.caption && m.imageData.caption.toLowerCase().includes(q)) ||
            (translatedMessages[m.id] && translatedMessages[m.id].text.toLowerCase().includes(q)) ||
            (summarizedMessages[m.id] && summarizedMessages[m.id].toLowerCase().includes(q))
          );
        })
        .map((m) => m.id)
    : [];

  // Auto-jump to first search match when typing
  useEffect(() => {
    if (isSearching && chatSearchQuery.trim() && searchMatchingIds.length > 0) {
      setSearchMatchIndex(0);
      scrollToMessage(searchMatchingIds[0]);
    }
  }, [chatSearchQuery, isSearching]);

  const handleNextSearchMatch = () => {
    if (searchMatchingIds.length === 0) return;
    const nextIdx = (searchMatchIndex + 1) % searchMatchingIds.length;
    setSearchMatchIndex(nextIdx);
    scrollToMessage(searchMatchingIds[nextIdx]);
  };

  const handlePrevSearchMatch = () => {
    if (searchMatchingIds.length === 0) return;
    const prevIdx = (searchMatchIndex - 1 + searchMatchingIds.length) % searchMatchingIds.length;
    setSearchMatchIndex(prevIdx);
    scrollToMessage(searchMatchingIds[prevIdx]);
  };

  const stopVoice = () => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = '';
      voiceAudioRef.current = null;
    }
    setPlayingVoiceId(null);
    setVoiceProgress(0);
  };

  useEffect(() => stopVoice, []);

  const toggleVoice = (msg: Message) => {
    const url = msg.voiceData?.audioUrl;
    if (!url) return;
    soundFx.playTap();

    if (playingVoiceId === msg.id) {
      stopVoice();
      return;
    }
    stopVoice();

    const audio = new Audio(url);
    audio.playbackRate = voiceSpeed;
    audio.ontimeupdate = () => {
      if (audio.duration) setVoiceProgress((audio.currentTime / audio.duration) * 100);
    };
    audio.onended = stopVoice;
    audio.onerror = () => {
      showToast('Не вдалося відтворити аудіо');
      stopVoice();
    };
    voiceAudioRef.current = audio;
    setPlayingVoiceId(msg.id);
    setVoiceProgress(0);
    audio.play().catch(() => {
      showToast('Не вдалося відтворити аудіо');
      stopVoice();
    });
  };

  const seekVoice = (msgId: string, percent: number) => {
    const audio = voiceAudioRef.current;
    if (!audio || playingVoiceId !== msgId || !audio.duration) return;
    soundFx.playTap();
    audio.currentTime = (percent / 100) * audio.duration;
    setVoiceProgress(percent);
  };

  const cycleVoiceSpeed = () => {
    soundFx.playTap();
    setVoiceSpeed((prev) => {
      const next = prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1;
      if (voiceAudioRef.current) voiceAudioRef.current.playbackRate = next;
      return next;
    });
  };

  const toggleTranscript = (msgId: string) => {
    soundFx.playTap();
    setExpandedTranscripts((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const copyCode = (code: string, id: string) => {
    soundFx.playTap();
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    showToast('Код скопійовано в буфер');
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const copyMessageText = (text: string) => {
    soundFx.playTap();
    navigator.clipboard.writeText(text);
    showToast('Текст скопійовано');
  };

  const handleOpenReactionPicker = (msgId: string) => {
    soundFx.playTap();
    setTargetReactionMsgId(msgId);
    setIsReactionModalOpen(true);
  };

  const handleSelectReactionEmoji = (emoji: string) => {
    if (targetReactionMsgId) {
      onAddReaction(targetReactionMsgId, emoji);
    }
  };

  // Роздільник дня. Раніше тут вгадували: якщо в рядку часу є «10:», «11:» або
  // «12:» — то «Сьогодні, 20 серпня», інакше «19 серпня 2026». Тепер рахуємо з
  // дати відправки, а коли її немає — не малюємо дату взагалі.
  const getDateLabel = (msg: Message): string => {
    if (!msg.sentAt) return '';
    const raw = msg.sentAt.endsWith('Z') ? msg.sentAt : `${msg.sentAt}Z`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(d, today)) return 'Сьогодні';
    if (sameDay(d, yesterday)) return 'Вчора';
    return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Розмова сам-на-сам: підписувати кожну бульбашку іменем нема сенсу —
  // співрозмовник один і він уже в шапці бесіди.
  const isDirectConversation =
    currentChat?.type === 'dm' ||
    currentChat?.type === 'direct' ||
    !!currentChat?.peerNodeId;

  let lastDateLabel = '';

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCF9] relative overflow-hidden select-none">
      {/* 1. Pinned Messages Banner */}
      {pinnedMessages.length > 0 && (() => {
        const pinnedMsg = pinnedMessages[currentPinnedIndex] || pinnedMessages[0];
        if (!pinnedMsg) return null;
        return (
          <div className="px-4 py-2 bg-[#FDFCF9] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0 z-10 text-[#21261F]">
            <div
              onClick={() => scrollToMessage(pinnedMsg.id)}
              className="flex items-center gap-2.5 min-w-0 cursor-pointer group flex-1"
            >
              <Pin className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#21261F]">
                  <span>Закріплене ({Math.min(currentPinnedIndex + 1, pinnedMessages.length)} з {pinnedMessages.length})</span>
                  <span className="text-[11.5px] text-[#6E7568] font-normal">
                    від {pinnedMsg.senderName}
                  </span>
                </div>
                <p className="text-[12.5px] text-[#6E7568] truncate">
                  {pinnedMsg.text || pinnedMsg.tableData?.title || pinnedMsg.type}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {pinnedMessages.length > 1 && (
                <>
                  <button
                    onClick={() =>
                      setCurrentPinnedIndex(
                        (prev) => (prev - 1 + pinnedMessages.length) % pinnedMessages.length
                      )
                    }
                    className="p-1 hover:bg-[#F9F7F1] rounded-lg text-[#5F6A60] hover:text-[#1E2521] transition-colors"
                    title="Попереднє закріплене"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={() =>
                      setCurrentPinnedIndex((prev) => (prev + 1) % pinnedMessages.length)
                    }
                    className="p-1 hover:bg-[#F9F7F1] rounded-lg text-[#5F6A60] hover:text-[#1E2521] transition-colors"
                    title="Наступне закріплене"
                  >
                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </button>
                </>
              )}

              <button
                onClick={() => onTogglePinMessage?.(pinnedMsg.id)}
                className="p-1 text-[#5F6A60] hover:text-[#E87A42] hover:bg-[#F9F7F1] rounded-lg transition-colors"
                title="Відкріпити"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        );
      })()}

      {/* 2. In-Chat Search Bar Strip */}
      {isSearching && (
        <div className="px-4 py-2 bg-[#F3ECE0] border-b border-[#DFD6C5] flex items-center justify-between gap-3 shrink-0 z-10">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#8C988E]" strokeWidth={1.75} />
            <input
              type="text"
              autoFocus
              value={chatSearchQuery}
              onChange={(e) => {
                setChatSearchQuery(e.target.value);
                setSearchMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) {
                    handlePrevSearchMatch();
                  } else {
                    handleNextSearchMatch();
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setChatSearchQuery('');
                  onCloseSearch();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  handleNextSearchMatch();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  handlePrevSearchMatch();
                }
              }}
              placeholder="Пошук у поточній бесіді (Enter - далі, Esc - закрити)..."
              className="w-full px-3 py-1 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42] focus:ring-1 focus:ring-[#E87A42]/30 shadow-2xs"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-[#8A9186] shrink-0">
            {chatSearchQuery && (
              <span>
                {searchMatchingIds.length > 0
                  ? `${searchMatchIndex + 1} з ${searchMatchingIds.length}`
                  : 'Не знайдено'}
              </span>
            )}
            {searchMatchingIds.length > 0 && (
              <>
                <button
                  onClick={handlePrevSearchMatch}
                  className="p-1 hover:bg-[#E5DCCF] rounded-lg"
                  title="Попередній збіг"
                >
                  <ChevronUp className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <button
                  onClick={handleNextSearchMatch}
                  className="p-1 hover:bg-[#E5DCCF] rounded-lg"
                  title="Наступний збіг"
                >
                  <ChevronDown className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </>
            )}
            <button
              onClick={() => {
                setChatSearchQuery('');
                onCloseSearch();
              }}
              className="p-1 hover:bg-[#E5DCCF] rounded-lg text-gray-500"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Messages Feed & Work OS Canvas Split Container */}
      <div className="relative flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Floating Quick Action: Canvas Split Toggle */}
        <div className="absolute top-3 right-4 z-20">
          <button
            onClick={() => {
              soundFx.playTap();
              setIsCanvasSplitOpen(!isCanvasSplitOpen);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-md transition-all border ${
              isCanvasSplitOpen
                ? 'bg-amber-500 text-black border-amber-400 font-bold'
                : 'bg-[#FDFCF9]/90 hover:bg-[#F3EEE3] text-[#21261F] border-[#E8E1D3] backdrop-blur-md'
            }`}
            title="Перемкнути спліт-екран Canvas (Markdown/Рішення)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{isCanvasSplitOpen ? 'Сховати Canvas' : 'Живий Canvas'}</span>
          </button>
        </div>

        {/* Main Messages Stream */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            data-testid="messages-scroller"
            className="flex-1 overflow-y-auto px-3 sm:px-6"
          >
            <div ref={contentRef} className="msg-column py-3 sm:py-4">
        {/* Порожня розмова — не пустка: та сама картка, що й у порожньому пошуку. */}
        {(messages || []).length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-6 py-12">
            <div className="w-11 h-11 rounded-full bg-[#F3EEE3] border border-[#E8E1D3] flex items-center justify-center text-[#8A5A33]">
              <MessageSquare className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <p className="text-[15px] font-semibold text-[#21261F]">Тут ще тихо</p>
            <p className="text-[12.5px] text-[#6E7568] max-w-[300px] leading-relaxed">
              Листи запечатані між вузлами. Напишіть перше — воно піде прямо співрозмовнику.
            </p>
          </div>
        )}
        {(messages || []).map((msg, index) => {
          if (!msg) return null;
          const isSelf = msg.senderId === currentUserId || msg.isSelf;
          const isVoicePlaying = playingVoiceId === msg.id;
          const hasVoiceAudio = !!msg.voiceData?.audioUrl;
          const isTranscriptOpen = !!expandedTranscripts[msg.id];
          const isSelected = (selectedMessageIds || []).includes(msg.id);
          const isHighlighted = highlightedMessageId === msg.id;
          const isSearchMatch = isSearching && (searchMatchingIds || []).includes(msg.id);
          const isActiveSearchMatch = isSearching && (searchMatchingIds || [])[searchMatchIndex] === msg.id;
          const dateLabel = getDateLabel(msg);
          const showDateDivider = dateLabel !== '' && dateLabel !== lastDateLabel;
          if (dateLabel) lastDateLabel = dateLabel;

          // Надгробок. Тіла немає ні тут, ні на диску — тож немає ні дій над
          // ним, ні галочок стану: везти вже нічого. Скромно й сіро навмисно:
          // рядок мусить бути видимим, але не претендувати на увагу.
          if (msg.isDeleted) {
            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center justify-center pt-[32px] pb-0">
                    <span className="px-2.5 py-1 bg-[#F3EEE3] text-[#6E7568] text-[11.5px] rounded-[8px]">
                      {dateLabel}
                    </span>
                  </div>
                )}
                <div
                  id={`message-${msg.id}`}
                  data-testid="message-tombstone"
                  className={`flex ${isSelf ? 'justify-end' : 'justify-start'} mt-[14px]`}
                >
                  <span className="px-3 py-1.5 rounded-2xl border border-dashed border-[#DFD6C5] bg-[#F3EEE3]/50 text-[12px] italic text-[#8A9186]">
                    Повідомлення видалено
                  </span>
                </div>
              </React.Fragment>
            );
          }

          // Message sequence grouping for harmonious organic contours
          const prevMsg = index > 0 ? messages[index - 1] : undefined;
          const nextMsg = index < (messages?.length || 0) - 1 ? messages[index + 1] : undefined;
          const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId || prevMsg.senderName !== msg.senderName;
          const isLastInGroup = !nextMsg || nextMsg.senderId !== msg.senderId || nextMsg.senderName !== msg.senderName;
          const isSingle = isFirstInGroup && isLastInGroup;
          const isNewSenderTurn = isFirstInGroup && index > 0;

          // Compute refined bubble corner radius classes based on conversational sequence
          let bubbleContourClass = '';
          if (isSelf) {
            if (isSingle) {
              bubbleContourClass = 'bubble-contour-self-single';
            } else if (isFirstInGroup) {
              bubbleContourClass = 'bubble-contour-self-first';
            } else if (isLastInGroup) {
              bubbleContourClass = 'bubble-contour-self-last';
            } else {
              bubbleContourClass = 'bubble-contour-self-middle';
            }
          } else {
            if (isSingle) {
              bubbleContourClass = 'bubble-contour-other-single';
            } else if (isFirstInGroup) {
              bubbleContourClass = 'bubble-contour-other-first';
            } else if (isLastInGroup) {
              bubbleContourClass = 'bubble-contour-other-last';
            } else {
              bubbleContourClass = 'bubble-contour-other-middle';
            }
          }

          // Content density analysis for dynamic fluid-fit sizing
          let messageDensity: 'emoji-single' | 'emoji-multi' | 'short' | 'medium' | 'long' | 'card' | 'media' | 'standard' = 'standard';
          let emojiCount = 0;

          if (
            msg.type === 'table' ||
            msg.type === 'chart' ||
            msg.type === 'task-list' ||
            msg.type === 'poll' ||
            msg.type === 'split-bill' ||
            msg.type === 'multi-quote'
          ) {
            messageDensity = 'card';
          } else if (msg.type === 'image' || msg.type === 'file' || msg.type === 'voice' || msg.type === 'location') {
            messageDensity = 'media';
          } else if (msg.text && !msg.replyTo && !msg.forwardFrom) {
            const trimmed = (msg.text || '').trim();
            // Check if string contains exclusively emojis
            const emojiRegex = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\uFE0F|\u200D|\s)+$/u;
            if (emojiRegex.test(trimmed)) {
              const emojiMatches = trimmed.match(/\p{Extended_Pictographic}/gu);
              emojiCount = emojiMatches ? emojiMatches.length : 0;
              if (emojiCount === 1) {
                messageDensity = 'emoji-single';
              } else if (emojiCount >= 2 && emojiCount <= 5) {
                messageDensity = 'emoji-multi';
              }
            }
            if (messageDensity === 'standard') {
              if (trimmed.length <= 22 && !trimmed.includes('\n')) {
                messageDensity = 'short';
              } else if (trimmed.length <= 110 && !trimmed.includes('\n\n')) {
                messageDensity = 'medium';
              } else {
                messageDensity = 'long';
              }
            }
          }

          let densityClass = 'msg-density-medium';
          if (messageDensity === 'emoji-single') densityClass = 'msg-density-emoji-single';
          else if (messageDensity === 'emoji-multi') densityClass = 'msg-density-emoji-multi';
          else if (messageDensity === 'short') densityClass = 'msg-density-short';
          else if (messageDensity === 'medium') densityClass = 'msg-density-medium';
          else if (messageDensity === 'long') densityClass = 'msg-density-long';
          else if (messageDensity === 'card') densityClass = 'msg-density-card';
          else if (messageDensity === 'media') densityClass = 'msg-density-media';

          // Word / character count for reading time indicator
          const textWordCount = msg.text ? msg.text.trim().split(/\s+/).length : 0;
          const showReadingTime = textWordCount >= 45;
          const estimatedReadMinutes = Math.max(1, Math.round(textWordCount / 120));

          return (
            <React.Fragment key={msg.id}>
              {/* Date Header Divider */}
              {showDateDivider && (
                <div className="flex items-center justify-center pt-[32px] pb-0">
                  <span className="px-2.5 py-1 bg-[#F3EEE3] text-[#6E7568] text-[11.5px] rounded-[8px]">
                    {dateLabel}
                  </span>
                </div>
              )}

              {/* Три сходинки ритму: 2px усередині групи, 14px на зміні мовця,
                  32px до роздільника дня — черга реплік читається периферійно. */}
              <div
                id={`message-${msg.id}`}
                onMouseEnter={() => setHoveredMessageId(msg.id)}
                onMouseLeave={() => setHoveredMessageId(null)}
                className={`flex items-end gap-2 ${isSelf ? 'justify-end' : 'justify-start'} ${isNewSenderTurn || showDateDivider ? 'mt-[14px]' : 'mt-[2px]'} group relative ${
                  isActiveSearchMatch
                    ? 'ring-1 ring-[#D96C35] bg-[#F3EEE3]/80 rounded-xl p-0.5'
                    : isHighlighted
                    ? 'ring-1 ring-[#D96C35] bg-[#F3EEE3]/60 rounded-xl p-0.5'
                    : isSearchMatch
                    ? 'bg-[#F3EEE3]/60 rounded-xl p-0.5'
                    : ''
                }`}
              >
                {/* Selection Checkbox */}
                {(isSelectionMode || isSelected) && (
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      onToggleSelectMessage(msg.id);
                    }}
                    className={`self-center p-1 rounded-lg transition-colors ${
                      isSelected ? 'text-[#E87A42]' : 'text-[#7A8479] hover:text-[#1E2521]'
                    }`}
                    title="Вибрати повідомлення"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4 fill-current" strokeWidth={1.75} /> : <Square className="w-4 h-4" strokeWidth={1.75} />}
                  </button>
                )}

                {/* Message Bubble & Reactions Column */}
                <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'} min-w-0 max-w-[92%] sm:max-w-[82%] md:max-w-[72%] relative group/msg`}>
                  {/* Аватар живе в одному рядку з бульбашкою, а не з усією колонкою:
                      інакше рядок реакцій тягнув би його нижче за край бульбашки. */}
                  <div className="flex items-end gap-2 max-w-full min-w-0">
                  {!isSelf && (
                    <div className="w-8 h-8 shrink-0 mb-0.5">
                      {isLastInGroup ? (
                        <div
                          onClick={() => onSelectMemberByName?.(msg.senderName)}
                          className="cursor-pointer hover:scale-105 transition-transform shrink-0"
                          title={`Переглянути профіль: ${msg.senderName}`}
                        >
                          <Avatar src={msg.senderAvatar} name={msg.senderName} className="w-8 h-8" />
                        </div>
                      ) : (
                        <div className="w-8 h-8" />
                      )}
                    </div>
                  )}

                  {/* Message Bubble Container */}
                  <div
                    onMouseUp={(e) => handleMessageMouseUp(msg, e)}
                    onTouchStart={(e) => handleTouchStart(msg, e)}
                    onTouchMove={(e) => handleTouchMove(msg, e)}
                    onTouchEnd={() => handleTouchEnd(msg)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      soundFx.playTap();
                      setContextMenuMsg(msg);
                    }}
                    style={{
                      transform:
                        swipingMsgId === msg.id ? `translateX(${swipeOffset}px)` : undefined,
                      transition: swipingMsgId === msg.id ? 'none' : 'transform 0.18s ease',
                    }}
                    className={`msg-bubble-fluid relative select-text cursor-pointer sm:cursor-default ${bubbleContourClass} ${densityClass} ${
                      messageDensity === 'emoji-single'
                        ? ''
                        : isSelf
                        ? 'msg-bubble-self'
                        : 'msg-bubble-other'
                    } ${isSelected ? 'ring-2 ring-[#E87A42] msg-bubble-selected z-10' : ''} ${
                      isActiveSearchMatch ? 'ring-2 ring-[#E87A42]' : ''
                    }`}
                  >
                    {/* Swipe to Reply Visual Indicator */}
                    {swipingMsgId === msg.id && Math.abs(swipeOffset) > 15 && (
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 ${
                          isSelf ? 'left-2' : 'right-2'
                        } w-6 h-6 rounded-full bg-[#E87A42] text-[#F7F5EE] flex items-center justify-center shadow-md pointer-events-none font-bold`}
                        style={{
                          transform: `translateY(-50%) scale(${Math.min(1.1, Math.abs(swipeOffset) / 35)})`,
                          opacity: Math.min(1, Math.abs(swipeOffset) / 25),
                        }}
                      >
                        <Reply className="w-3 h-3" strokeWidth={1.75} />
                      </div>
                    )}
                    {/* Top Pinned Tag Pill */}
                    {msg.isPinned && (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-[#6E7568] mb-1 w-fit">
                        <Pin className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>Закріплено</span>
                      </div>
                    )}

                    {/* Ім'я відправника — лише в групах. Роль («Учасник») у стрічці
                        нікого не цікавить, тому бейджа немає ніде. */}
                    {!isSelf && isFirstInGroup && !isDirectConversation && (
                      <div className="mb-0.5">
                        <p
                          onClick={() => onSelectMemberByName?.(msg.senderName)}
                          className="font-semibold text-[13px] text-[#D96C35] leading-tight cursor-pointer hover:underline w-fit"
                        >
                          <HighlightedText
                            text={msg.senderName}
                            query={isSearching ? chatSearchQuery : undefined}
                            activeMatch={isActiveSearchMatch}
                          />
                        </p>
                      </div>
                    )}
                  {/* Replying-to / Quoted Preview Header */}
                  {msg.replyTo && (
                    <div
                      onClick={() => {
                        soundFx.playTap();
                        if (msg.replyTo!.id) scrollToMessage(msg.replyTo!.id);
                      }}
                      className="mb-1.5 py-1 pl-2.5 pr-2 rounded-r-lg border-l-2 border-[#D96C35]/45 bg-[#F3EEE3]/70 text-[#21261F] cursor-pointer transition-colors hover:bg-[#F3EEE3]"
                    >
                      {msg.replyTo.quotes && msg.replyTo.quotes.length > 1 ? (
                        /* Multi-message quotes preview */
                        <div>
                          <p className="font-semibold text-[12px] text-[#6E7568] flex items-center gap-1.5">
                            <Quote className="w-3.5 h-3.5" strokeWidth={1.75} />
                            <span>Цитати ({msg.replyTo.quotes.length})</span>
                          </p>
                          <div className="mt-0.5">
                            {msg.replyTo.quotes.map((q) => (
                              <div key={q.id} className="text-[12px] truncate flex items-center gap-1 text-[#6E7568]">
                                <span className="font-semibold shrink-0">{q.senderName}:</span>
                                <span className="truncate">{q.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : msg.replyTo.quoteSelectedText ? (
                        /* Partial fragment quote */
                        <div>
                          <p className="font-semibold text-[12px] text-[#6E7568] flex items-center gap-1.5">
                            <Quote className="w-3.5 h-3.5" strokeWidth={1.75} />
                            <span>Цитата: {msg.replyTo.senderName}</span>
                          </p>
                          <p className="text-[12px] leading-snug text-[#6E7568] truncate">
                            «{msg.replyTo.quoteSelectedText}»
                          </p>
                        </div>
                      ) : (
                        /* Standard single message reply */
                        <div>
                          <p className="font-semibold text-[12px] text-[#6E7568]">
                            <HighlightedText
                              text={msg.replyTo.senderName}
                              query={isSearching ? chatSearchQuery : undefined}
                            />
                          </p>
                          <p className="truncate text-[12px] text-[#6E7568]">
                            <HighlightedText
                              text={msg.replyTo.text}
                              query={isSearching ? chatSearchQuery : undefined}
                            />
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Forwarded Header Attribution */}
                  {msg.forwardFrom && (
                    <div className="mb-1 text-[12px] text-[#6E7568] flex items-center gap-1.5">
                      <Forward className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                      <span>
                        Переслано з «
                        <HighlightedText
                          text={msg.forwardFrom.chatTitle}
                          query={isSearching ? chatSearchQuery : undefined}
                        />
                        » (
                        <HighlightedText
                          text={msg.forwardFrom.senderName}
                          query={isSearching ? chatSearchQuery : undefined}
                        />
                        )
                      </span>
                    </div>
                  )}

                  {/* 🧠 PHANTOM Mind Panel (Living Thought Pipeline: сприймаю → пригадую → міркую → дію → пишу) */}
                  {msg.thinking && (
                    <div className="mb-2 p-2.5 bg-[#FDFCF9] border border-[#E6DFD3] rounded-xl shadow-inner text-xs space-y-1.5 animate-in fade-in">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-wider text-[#E87A42] font-bold">
                          {msg.thinking.active && <span className="w-1.5 h-1.5 rounded-full bg-[#E87A42] animate-ping" />}
                          <span>{msg.thinking.label}</span>
                        </div>
                        {msg.thinking.durationMs && (
                          <span className="text-[9.5px] text-[#5F6A60] font-mono">{msg.thinking.durationMs}ms</span>
                        )}
                      </div>

                      {/* Stages Pipeline */}
                      <div className="flex items-center gap-1 text-[9.5px] font-mono font-bold">
                        {[
                          { key: 'perceive', label: 'сприймаю' },
                          { key: 'recall', label: 'пригадую' },
                          { key: 'reason', label: 'міркую' },
                          { key: 'act', label: 'дію' },
                          { key: 'write', label: 'пишу' },
                        ].map((st, i) => {
                          const order = ['perceive', 'recall', 'reason', 'act', 'write', 'done'];
                          const currentIdx = order.indexOf(msg.thinking!.stage);
                          const stIdx = order.indexOf(st.key);
                          const isPassed = currentIdx > stIdx;
                          const isCurrent = msg.thinking!.stage === st.key;

                          return (
                            <React.Fragment key={st.key}>
                              {i > 0 && <span className="text-[#7A8479] font-mono">→</span>}
                              <span
                                className={`px-1.5 py-0.5 rounded transition-all ${
                                  isCurrent
                                    ? 'bg-[#E87A42] text-[#F7F5EE] font-black shadow-xs'
                                    : isPassed
                                    ? 'text-[#E87A42] bg-[#F9F7F1]'
                                    : 'text-[#5A6D60] bg-[#FDFCF9]'
                                }`}
                              >
                                {st.label}
                              </span>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 1. TEXT MESSAGE (Formatted with Markdown, Spoilers, Mentions, Search Highlighting, or Organic Emoji Cluster) */}
                  {/* У вкладення текст — це підпис, і його місце ПІД превʼю;
                      малює його SecureMediaBubble, тож тут ми мовчимо. */}
                  {msg.text && !msg.media && (
                    messageDensity === 'emoji-single' ? (
                      <div className="text-[44px] sm:text-[50px] leading-none select-text py-0.5 filter drop-shadow-xs text-center">
                        {msg.text.trim()}
                      </div>
                    ) : messageDensity === 'emoji-multi' ? (
                      <div className="text-[26px] sm:text-[30px] leading-tight select-text py-0.5 tracking-wider">
                        {msg.text.trim()}
                      </div>
                    ) : messageDensity === 'long' && msg.text && (msg.text.length > 1500 || (msg.text.split('\n')?.length || 0) >= 20) ? (
                      (() => {
                        const isExpanded = !!expandedMsgIds[msg.id];
                        return (
                          <div className="relative">
                            <div
                              className={`msg-density-long-content ${
                                isExpanded ? 'msg-density-long-expanded pb-1' : 'msg-density-long-collapsed cursor-pointer'
                              }`}
                              onClick={(e) => {
                                if (!isExpanded) {
                                  toggleExpandMessage(msg.id, e);
                                }
                              }}
                            >
                              <FormattedMessageText
                                text={msg.text}
                                onMentionClick={(handle) => onSelectMemberByName?.(handle)}
                                searchQuery={isSearching ? chatSearchQuery : undefined}
                                isActiveMatch={isActiveSearchMatch}
                              />

                              {/* Gradient Fade and Read-More Toggle Button (when collapsed) */}
                              {!isExpanded && (
                                <div
                                  className={`absolute bottom-0 left-0 right-0 h-16 flex items-end justify-center pb-0.5 cursor-pointer rounded-b-2xl transition-opacity duration-200 ${
                                    isSelf ? 'msg-read-more-fade-self' : 'msg-read-more-fade-other'
                                  }`}
                                  onClick={(e) => toggleExpandMessage(msg.id, e)}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => toggleExpandMessage(msg.id, e)}
                                    className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-[10px] border border-[#E8E1D3] bg-[#FDFCF9] text-[#6E7568] hover:text-[#21261F] transition-colors"
                                  >
                                    <span>Читати далі</span>
                                    <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Collapse Toggle Button (when expanded) */}
                            {isExpanded && (
                              <div className="mt-1.5 flex justify-end">
                                <button
                                  type="button"
                                  onClick={(e) => toggleExpandMessage(msg.id, e)}
                                  className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-[10px] border border-[#E8E1D3] bg-[#FDFCF9] text-[#6E7568] hover:text-[#21261F] transition-colors"
                                >
                                  <span>Згорнути</span>
                                  <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div>
                        <FormattedMessageText
                          text={msg.text}
                          onMentionClick={(handle) => onSelectMemberByName?.(handle)}
                          searchQuery={isSearching ? chatSearchQuery : undefined}
                          isActiveMatch={isActiveSearchMatch}
                        />
                      </div>
                    )
                  )}

                  {/* Очікування відповіді локального агента */}
                  {agentTask?.msgId === msg.id && (
                    <div className={`mt-2 p-2 rounded-2xl text-[11px] border flex items-center gap-1.5 ${
                      isSelf
                        ? 'bg-[#FDF4EC] border-[#EBC7AE] text-[#8C6B4F]'
                        : 'bg-[#F2EFE8] border-[#DFD6C5] text-[#7A8479]'
                    }`}>
                      <Sparkles className="w-3 h-3 animate-pulse text-[#E87A42]" strokeWidth={1.75} />
                      <span>{agentTask.label}</span>
                    </div>
                  )}

                  {/* Переклад від локального агента */}
                  {translatedMessages[msg.id] && (
                    <div className={`mt-2 p-2.5 rounded-2xl text-xs border animate-in fade-in zoom-in-95 duration-150 ${
                      isSelf
                        ? 'bg-[#FDF4EC] border-[#EBC7AE] text-[#1E2521]'
                        : 'bg-[#F2EFE8] border-[#DFD6C5] text-[#7A8479]'
                    }`}>
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-current/15 mb-1 text-[10px] font-mono font-bold opacity-80">
                        <span className="flex items-center gap-1">
                          <Languages className="w-3 h-3 text-[#E87A42]" strokeWidth={1.75} />
                          <span>Переклад агента ({translatedMessages[msg.id].lang})</span>
                        </span>
                        <button
                          onClick={() => handleToggleTranslate(msg)}
                          className="hover:opacity-100 opacity-60 text-[10px]"
                        >
                          Приховати
                        </button>
                      </div>
                      <p className="leading-relaxed">
                        <HighlightedText
                          text={translatedMessages[msg.id].text}
                          query={isSearching ? chatSearchQuery : undefined}
                        />
                      </p>
                    </div>
                  )}

                  {/* Підсумок від локального агента */}
                  {summarizedMessages[msg.id] && (
                    <div className={`mt-2 p-2 rounded-2xl text-xs border flex items-start gap-1.5 animate-in fade-in duration-150 ${
                      isSelf
                        ? 'bg-[#F9DCC7] border-[#E87A42]/40 text-[#8C461A]'
                        : 'bg-[#FCE7D8] border-[#E87A42]/40 text-[#8C461A]'
                    }`}>
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#E87A42]" strokeWidth={1.75} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium leading-snug">
                          <HighlightedText
                            text={summarizedMessages[msg.id]}
                            query={isSearching ? chatSearchQuery : undefined}
                          />
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Завдання, які агент вичитав із повідомлення */}
                  {actionItemMessages[msg.id] && (
                    <div className={`mt-2 p-2.5 rounded-2xl text-xs border space-y-1.5 animate-in fade-in duration-150 ${
                      isSelf ? 'bg-[#FDF4EC] border-[#EBC7AE] text-[#1E2521]' : 'bg-[#EAF3E9] border-[#C3DCC1] text-[#7A8479]'
                    }`}>
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider pb-1 border-b border-current/20">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-[#528A4B]" strokeWidth={1.75} />
                          <span>Завдання з повідомлення</span>
                        </span>
                      </div>
                      {actionItemMessages[msg.id].map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#528A4B] mt-1.5 shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI 1-Click Action Item Detection */}
                  {msg.text && (
                    <ActionItemChip
                      text={msg.text}
                      senderName={msg.senderName}
                      onCreateTask={(taskTitle) => {
                        showToast(`Завдання додано: ${taskTitle}`);
                      }}
                    />
                  )}

                  {/* 2. TABLE MESSAGE */}
                  {msg.type === 'table' && msg.tableData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden">
                      <DataTableViewer
                        data={msg.tableData}
                        isSelf={isSelf}
                        onUpdateTableData={(updated) => onUpdateTableData?.(msg.id, updated)}
                      />
                    </div>
                  )}

                  {/* 3. CHART MESSAGE */}
                  {msg.type === 'chart' && msg.chartData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden">
                      <ChartEmbed data={msg.chartData} />
                    </div>
                  )}

                  {/* 4. TASK LIST MESSAGE */}
                  {msg.type === 'task-list' && msg.taskListData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden">
                      <TaskListEmbed
                        data={msg.taskListData}
                        isSelf={isSelf}
                        onUpdateTaskList={(updated) => onUpdateTaskListData?.(msg.id, updated)}
                      />
                    </div>
                  )}

                  {/* 5. MULTI-QUOTE SYNTHESIS MESSAGE */}
                  {msg.type === 'multi-quote' && msg.multiQuoteData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden">
                      <MultiQuoteEmbed data={msg.multiQuoteData} isSelf={isSelf} />
                    </div>
                  )}

                  {/* 6. VOICE MESSAGE WITH SEEKABLE WAVEFORM */}
                  {msg.type === 'voice' && msg.voiceData && (
                    <div className="space-y-2 pt-1 w-full max-w-full min-w-0 sm:min-w-[240px]">
                      <div className="flex items-center gap-3">
                        {hasVoiceAudio && (
                          <button
                            onClick={() => toggleVoice(msg)}
                            className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all ${
                              isSelf
                                ? 'bg-[#E87A42] text-white hover:bg-[#D46B35]'
                                : 'bg-[#FCE7D8] text-[#E87A42] hover:bg-[#F9CCA8]'
                            }`}
                          >
                            {isVoicePlaying ? (
                              <Pause className="w-4 h-4" strokeWidth={1.75} />
                            ) : (
                              <Play className="w-4 h-4 ml-0.5" strokeWidth={1.75} />
                            )}
                          </button>
                        )}

                        {/* Interactive Sound Waveform (Click to Seek) */}
                        <div
                          className={`flex-1 flex items-center gap-0.8 h-8 px-1 relative ${hasVoiceAudio ? 'cursor-pointer group/wave' : ''}`}
                          title={hasVoiceAudio ? 'Клікніть щоб перейти до моменту аудіо' : undefined}
                        >
                          {(msg.voiceData?.waveform || []).map((height, i) => {
                            const waveLen = msg.voiceData?.waveform?.length || 1;
                            const segmentPercent = ((i + 1) / waveLen) * 100;
                            const isPast = hasVoiceAudio && segmentPercent <= voiceProgress;
                            return (
                              <div
                                key={i}
                                onClick={hasVoiceAudio ? () => seekVoice(msg.id, segmentPercent) : undefined}
                                className={`flex-1 rounded-full transition-all ${hasVoiceAudio ? 'hover:scale-y-125' : 'opacity-50'} ${
                                  isSelf
                                    ? isPast ? 'bg-[#E87A42]' : 'bg-[#E6C6AE]'
                                    : isPast ? 'bg-[#E87A42]' : 'bg-[#DCD2C1]'
                                }`}
                                style={{ height: `${Math.max(height * 0.35, 4)}px` }}
                              />
                            );
                          })}
                        </div>

                        {/* Speed toggle */}
                        {hasVoiceAudio && (
                          <button
                            onClick={cycleVoiceSpeed}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono transition-colors ${
                              isSelf
                                ? 'bg-[#F6DCC9] hover:bg-[#F0CDB4] text-[#8C6B4F]'
                                : 'bg-[#F2EDE4] hover:bg-[#E8DFC8] text-[#8A9186]'
                            }`}
                          >
                            {voiceSpeed}x
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10px] opacity-70">
                        <span>
                          {hasVoiceAudio
                            ? `${msg.voiceData.duration} сек`
                            : `${msg.voiceData.duration} сек · аудіо немає на цьому вузлі`}
                        </span>
                        {msg.voiceData.transcript && (
                          <button
                            onClick={() => toggleTranscript(msg.id)}
                            className="hover:underline flex items-center gap-0.5 text-[#E87A42] font-semibold"
                          >
                            <span>{isTranscriptOpen ? 'Сховати розшифровку' : 'Читати текст'}</span>
                            {isTranscriptOpen ? <ChevronUp className="w-3 h-3" strokeWidth={1.75} /> : <ChevronDown className="w-3 h-3" strokeWidth={1.75} />}
                          </button>
                        )}
                      </div>

                      {isTranscriptOpen && msg.voiceData.transcript && (
                        <div className={`p-2.5 rounded-2xl text-xs border ${
                          isSelf ? 'bg-[#FDF4EC] border-[#EBC7AE] text-[#5F6A60]' : 'bg-[#FDFCF9] border-[#DFD6C5] text-[#7A8479]'
                        }`}>
                          <p className="italic">
                            «
                            <HighlightedText
                              text={msg.voiceData.transcript}
                              query={isSearching ? chatSearchQuery : undefined}
                              activeMatch={isActiveSearchMatch}
                            />
                            »
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 7. POLL MESSAGE */}
                  {msg.type === 'poll' && msg.pollData && (
                    <div className="space-y-2.5 pt-1 w-full max-w-full min-w-0 sm:min-w-[240px]">
                      <div className="flex items-center gap-2 pb-1 border-black/10 border-b">
                        <BarChart2 className="w-4 h-4 text-[#528A4B]" strokeWidth={1.75} />
                        <h4 className="font-bold text-xs sm:text-sm">
                          <HighlightedText
                            text={msg.pollData.question}
                            query={isSearching ? chatSearchQuery : undefined}
                            activeMatch={isActiveSearchMatch}
                          />
                        </h4>
                      </div>

                      <div className="space-y-1.5">
                        {msg.pollData.options.map((option) => {
                          const total = msg.pollData!.totalVotes || 0;
                          const percent = total > 0 ? Math.round((option.votes / total) * 100) : 0;
                          const hasVoted = option.voters.includes(currentUserId) || msg.pollData?.userVotedOptionId === option.id;

                          return (
                            <div
                              key={option.id}
                              onClick={() => {
                                soundFx.playSend();
                                onVotePoll(msg.id, option.id);
                              }}
                              className={`p-2.5 rounded-2xl border cursor-pointer relative overflow-hidden transition-all ${
                                hasVoted
                                  ? 'bg-[#FCE7D8] border-[#E87A42]'
                                  : isSelf
                                  ? 'bg-[#FDF4EC] border-[#EBC7AE] hover:bg-[#F9EADD]'
                                  : 'bg-[#FDFCF9] border-[#DFD6C5] hover:bg-[#F2EDE4]'
                              }`}
                            >
                              <div
                                className={`absolute top-0 bottom-0 left-0 opacity-25 rounded-2xl transition-all duration-300 ${
                                  isSelf ? 'bg-[#E87A42]' : 'bg-[#528A4B]'
                                }`}
                                style={{ width: `${percent}%` }}
                              />

                              <div className="relative flex items-center justify-between gap-2 z-10 text-xs">
                                <span className="font-medium truncate">
                                  <HighlightedText
                                    text={option.text}
                                    query={isSearching ? chatSearchQuery : undefined}
                                  />
                                </span>
                                <span className="font-mono font-bold shrink-0">{percent}% ({option.votes})</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="text-[10px] opacity-70 text-right font-mono">
                        Всього голосів: {msg.pollData.totalVotes}
                      </div>
                    </div>
                  )}

                  {/* 8. SPLIT BILL MESSAGE */}
                  {msg.type === 'split-bill' && msg.splitBillData && (
                    <div className="space-y-2.5 pt-1 w-full max-w-full min-w-0 sm:min-w-[240px]">
                      <div className="flex items-center justify-between pb-1 border-black/10 border-b">
                        <div className="flex items-center gap-1.5">
                          <Receipt className="w-4 h-4 text-[#E87A42]" strokeWidth={1.75} />
                          <h4 className="font-bold text-xs sm:text-sm">
                            <HighlightedText
                              text={msg.splitBillData.title}
                              query={isSearching ? chatSearchQuery : undefined}
                              activeMatch={isActiveSearchMatch}
                            />
                          </h4>
                        </div>
                        <span className="font-bold text-xs text-[#E87A42]">
                          {msg.splitBillData.totalAmount} {msg.splitBillData.currency}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {msg.splitBillData.participants.map((part) => (
                          <div
                            key={part.id}
                            onClick={() => {
                              soundFx.playSend();
                              onPayBillShare(msg.id, part.id);
                            }}
                            className={`p-2 rounded-2xl flex items-center justify-between gap-2 cursor-pointer transition-all border ${
                              part.paid
                                ? 'bg-[#EAF3E9] border-[#C3DCC1]'
                                : isSelf
                                ? 'bg-[#FDF4EC] border-[#EBC7AE] hover:bg-[#F9EADD]'
                                : 'bg-white border-[#DFD6C5] hover:bg-[#FDFCF9]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar src={part.avatar} name={part.name} className="w-6 h-6" />
                              <span className="text-xs truncate">
                                <HighlightedText
                                  text={part.name}
                                  query={isSearching ? chatSearchQuery : undefined}
                                />
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-xs font-bold">{part.share} {msg.splitBillData!.currency}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                part.paid ? 'bg-[#EAF3E9] text-[#3E7B44] border border-[#C3DCC1]' : 'bg-[#FCE7D8] text-[#A84813] border border-[#F0D5C2]'
                              }`}>
                                {part.paid ? 'Оплачено' : 'Очікує'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 9. LOCATION MESSAGE */}
                  {msg.type === 'location' && msg.locationData && (
                    <div
                      onClick={() => {
                        soundFx.playTap();
                        onOpenLocation(msg.locationData!);
                      }}
                      className={`p-3 rounded-2xl cursor-pointer transition-all border mt-1 ${
                        isSelf ? 'bg-[#FDF4EC] border-[#EBC7AE] hover:bg-[#F9EADD]' : 'bg-[#FDFCF9] border-[#DFD6C5] hover:bg-[#F2EDE4]'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="p-2 bg-[#FCE7D8] text-[#E87A42] rounded-xl shrink-0">
                          <MapPin className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-xs sm:text-sm truncate">
                            <HighlightedText
                              text={msg.locationData.name}
                              query={isSearching ? chatSearchQuery : undefined}
                              activeMatch={isActiveSearchMatch}
                            />
                          </h4>
                          <p className="text-[11px] opacity-80 truncate">
                            <HighlightedText
                              text={msg.locationData.address}
                              query={isSearching ? chatSearchQuery : undefined}
                            />
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-[#E87A42] font-semibold">
                            <span>{msg.locationData.walkingTime}</span>
                            <span>· Відкрити досьє</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 9b. ТОЧКА «Я ТУТ» — вимір із пристрою, не картка місця */}
                  {msg.type === 'geo:point' && msg.geoPoint && (
                    <GeoPointBubble
                      point={msg.geoPoint}
                      viaMailbox={msg.transport === 'mailbox'}
                      isSelf={isSelf}
                    />
                  )}

                  {/* 10. CODE MESSAGE */}
                  {msg.type === 'code' && msg.codeData && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] opacity-80 font-mono">
                        <span>
                          <HighlightedText
                            text={msg.codeData.title || msg.codeData.language}
                            query={isSearching ? chatSearchQuery : undefined}
                          />
                        </span>
                        <button
                          onClick={() => copyCode(msg.codeData!.code, msg.id)}
                          className="hover:underline flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" strokeWidth={1.75} />
                          <span>{copiedCodeId === msg.id ? 'Скопійовано!' : 'Копіювати'}</span>
                        </button>
                      </div>
                      <pre className="p-3 bg-[#F1EDE3] text-[#2C4A34] border border-[#E6DFD3] font-mono text-xs rounded-2xl overflow-x-auto select-text">
                        <code>{msg.codeData.code}</code>
                      </pre>
                    </div>
                  )}

                  {/* 10. WORK OS: LIVE CANVAS EMBED */}
                  {(msg.type === 'widget:canvas' || msg.canvasData) && msg.canvasData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <CanvasCardEmbed
                        data={msg.canvasData}
                        isSelf={isSelf}
                        onOpenSplit={(_doc) => {
                          setIsCanvasSplitOpen(true);
                        }}
                        onUpdate={(updated) => {
                          useMessengerStore.getState().updateMessage(msg.id, { canvasData: updated });
                        }}
                      />
                    </div>
                  )}

                  {/* 10a. WORK OS: KANBAN WIDGET */}
                  {msg.type === 'widget:kanban' && msg.kanbanData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <KanbanWidgetEmbed
                        data={msg.kanbanData}
                        isSelf={isSelf}
                        onUpdate={(updated) => {
                          useMessengerStore.getState().updateMessage(msg.id, { kanbanData: updated });
                        }}
                      />
                    </div>
                  )}

                  {/* 10b. WORK OS: VOTING WIDGET */}
                  {msg.type === 'widget:voting' && msg.votingData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <VotingWidgetEmbed
                        data={msg.votingData}
                        isSelf={isSelf}
                        currentUserId={currentUserId}
                        onUpdate={(updated) => {
                          useMessengerStore.getState().updateMessage(msg.id, { votingData: updated });
                        }}
                      />
                    </div>
                  )}

                  {/* 10c. WORK OS: RACI MATRIX WIDGET */}
                  {msg.type === 'widget:raci' && msg.raciData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <RACIWidgetEmbed
                        data={msg.raciData}
                        isSelf={isSelf}
                        onUpdate={(updated) => {
                          useMessengerStore.getState().updateMessage(msg.id, { raciData: updated });
                        }}
                      />
                    </div>
                  )}

                  {/* 10d. WORK OS: CODE RUNNER WIDGET */}
                  {msg.type === 'widget:code-runner' && msg.codeRunnerData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <CodeRunnerWidgetEmbed
                        data={msg.codeRunnerData}
                        isSelf={isSelf}
                        onUpdate={(updated) => {
                          useMessengerStore.getState().updateMessage(msg.id, { codeRunnerData: updated });
                        }}
                      />
                    </div>
                  )}

                  {/* 10e. WORK OS: MERMAID DIAGRAM EMBED */}
                  {msg.type === 'embed:mermaid' && msg.mermaidData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <MermaidEmbed data={msg.mermaidData} />
                    </div>
                  )}

                  {/* 10f. WORK OS: CODE DIFF EMBED */}
                  {msg.type === 'embed:diff' && msg.codeDiffData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <CodeDiffEmbed data={msg.codeDiffData} />
                    </div>
                  )}

                  {/* 10g. WORK OS: WEBHOOK EVENT EMBED */}
                  {msg.type === 'webhook:event' && msg.webhookEventData && (
                    <div className="w-full max-w-full min-w-0 overflow-hidden pt-1">
                      <WebhookEventEmbed data={msg.webhookEventData} />
                    </div>
                  )}

                  {/* 11a. ВКЛАДЕННЯ З НАСКРІЗНИМ КЛЮЧЕМ — фото і файли від людей.
                       Демонстраційні картки нижче лишаються для показової стрічки:
                       у них є готовий url і немає чого розшифровувати. */}
                  {msg.media && (msg.type === 'image' || msg.type === 'file') && (
                    <SecureMediaBubble
                      msg={msg}
                      isSelf={Boolean(isSelf)}
                      onOpenLightbox={onOpenImageLightbox}
                    />
                  )}

                  {/* 11. FILE MESSAGE */}
                  {msg.type === 'file' && msg.fileData && (
                    <div className={`p-3 rounded-2xl flex items-center justify-between gap-3 border mt-1 ${
                      isSelf ? 'bg-[#FDF4EC] border-[#EBC7AE]' : 'bg-[#FDFCF9] border-[#DFD6C5]'
                    }`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 bg-[#FCE7D8] text-[#E87A42] rounded-xl shrink-0">
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-xs truncate">
                            <HighlightedText
                              text={msg.fileData.name}
                              query={isSearching ? chatSearchQuery : undefined}
                              activeMatch={isActiveSearchMatch}
                            />
                          </p>
                          <p className="text-[10px] opacity-70">{msg.fileData.size} · {msg.fileData.extension.toUpperCase()}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          soundFx.playTap();
                          showToast(`Завантаження: ${msg.fileData!.name}`);
                        }}
                        className={`p-2 rounded-xl transition-colors shrink-0 ${
                          isSelf ? 'bg-[#F6DCC9] hover:bg-[#F0CDB4] text-[#1E2521]' : 'bg-[#F2EDE4] hover:bg-[#E8DFC8] text-[#1E2521]'
                        }`}
                        title="Завантажити файл"
                      >
                        <Download className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}

                  {/* 12. IMAGE MESSAGE */}
                  {msg.type === 'image' && msg.imageData && (
                    <div className="space-y-1 pt-1">
                      <img
                        src={msg.imageData.url}
                        alt="chat image"
                        onClick={() => {
                          soundFx.playTap();
                          onOpenImageLightbox?.(msg.imageData!.url, msg.imageData?.caption);
                        }}
                        className="rounded-2xl max-h-64 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                      />
                      {msg.imageData.caption && (
                        <p className="text-xs opacity-90">
                          <HighlightedText
                            text={msg.imageData.caption}
                            query={isSearching ? chatSearchQuery : undefined}
                          />
                        </p>
                      )}
                    </div>
                  )}

                  {/* Message Indicators & Metadata Bar (Reading Time, Saved, Edited, Timestamp & Delivery Checks) */}
                  <div className={`msg-meta-row flex items-center justify-end gap-1.5 mt-0.5 text-[11.5px] select-none ${
                    messageDensity === 'emoji-single'
                      ? 'bg-[#F3EEE3] text-[#6E7568] border border-[#E8E1D3] px-1.5 py-0.5 rounded-lg w-fit mx-auto'
                      : isSelf
                      ? 'text-[color:var(--msg-meta-self)]'
                      : 'text-[color:var(--msg-meta)]'
                  }`}>
                    {/* Reading time metric for longer messages */}
                    {showReadingTime && (
                      <span className="flex items-center gap-1 opacity-80" title="Приблизний час прочитання">
                        <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>~{estimatedReadMinutes} хв</span>
                      </span>
                    )}

                    {/* Bookmarked / Saved indicator */}
                    {savedMessages[msg.id] && (
                      <span className="flex items-center gap-1 opacity-90" title="Збережено в Збереженому">
                        <Bookmark className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>Збережено</span>
                      </span>
                    )}

                    {/* Edited badge indicator */}
                    {msg.isEdited && (
                      <span className="opacity-85" title="Повідомлення було змінено">
                        ред.
                      </span>
                    )}

                    {/* Транспорт показуємо лише під ЧУЖИМ листом. Під власним
                        єдине джерело правди — статусна галочка (клік → «шлях
                        листа»); інакше глобус «доставлено» сперечався б із нею. */}
                    {!isSelf && (msg.transport === 'p2p' ? (
                      <span
                        className="flex items-center gap-1 opacity-85"
                        title="Доставлено напряму через WebRTC P2P DataChannel (транспорт DTLS)"
                      >
                        <Radio className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>P2P</span>
                      </span>
                    ) : msg.transport === 'server' ? (
                      <span
                        className="opacity-70"
                        title="Доставлено через вузол (WebSocket)"
                      >
                        <Globe className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </span>
                    ) : null)}

                    {/* Час — завжди останній у правому нижньому куті бульбашки */}
                    <span className="tabular-nums whitespace-nowrap">
                      {msg.timestamp}
                    </span>

                    {/* Галочка — вхід у «шлях листа». Клік відкриває картку зі
                        станом і, для черги/помилки, дією. Без статусу — нічого. */}
                    {isSelf && msg.status && (
                      <span className="relative flex items-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); openPathCard(msg); }}
                          className="flex items-center rounded p-0.5 -mr-0.5 hover:bg-[#F1EBDD] transition-colors"
                          title="Шлях листа"
                          aria-label="Шлях листа"
                        >
                          {/* Галочка — тільки коли вузол-адресат узяв кадр.
                              Поки лист у черзі, це годинник; поки байти
                              вкладення не в людини — амберова крапка. */}
                          {msg.status === 'sending' && <Clock className="w-3.5 h-3.5 text-[color:var(--msg-meta-self)]" strokeWidth={1.75} />}
                          {msg.status === 'queued' && (stuckAttachment(msg) ? (
                            <span className="w-2 h-2 rounded-full bg-[#C9A227]" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-[#C98A2E]" strokeWidth={1.75} />
                          ))}
                          {msg.status === 'sent' && <Check className="w-3.5 h-3.5 text-[color:var(--msg-meta-self)]" strokeWidth={1.75} />}
                          {msg.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-[#C25A3A]" strokeWidth={1.75} />}
                          {/* Слово поруч зі значком — щоб правду було видно
                              без наведення, пальцем і на сонці. */}
                          {statusNote(msg.status, msg) && (
                            <span
                              data-msg-status-note
                              className={`ml-1 text-[11px] font-medium ${
                                msg.status === 'failed' ? 'text-[#C25A3A]' : 'text-[#8A6D2E]'
                              }`}
                            >
                              {statusNote(msg.status, msg)}
                            </span>
                          )}
                        </button>

                        {pathCardMsgId === msg.id && (
                          <>
                            <button
                              className="fixed inset-0 z-30 cursor-default"
                              onClick={() => setPathCardMsgId(null)}
                              aria-hidden
                            />
                            <div
                              data-path-card
                              className="absolute bottom-full right-0 mb-1.5 w-60 bg-[#FDFCF9] border border-[#E8E1D3] rounded-[12px] shadow-[0_4px_16px_rgba(60,44,24,0.12)] z-40 p-3 text-left cursor-default animate-in fade-in zoom-in-95 duration-100"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-extrabold uppercase tracking-wide text-[#6E7568]">Шлях листа</span>
                                <button
                                  onClick={() => setPathCardMsgId(null)}
                                  className="p-0.5 text-[color:var(--msg-meta)] hover:text-[#21261F] rounded"
                                  aria-label="Закрити"
                                >
                                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusDot(msg.status) }} />
                                <span className="text-[12.5px] font-semibold text-[#21261F]">{statusLabel(msg.status, msg)}</span>
                              </div>

                              {msg.status === 'sending' && (
                                <p className="text-[11.5px] text-[#6E7568] pl-4 mt-1 leading-relaxed">
                                  Вузол ще не підтвердив запис листа.
                                </p>
                              )}

                              {msg.status === 'sent' && (
                                <p className="text-[11.5px] text-[#6E7568] pl-4 mt-1">
                                  {msg.transport === 'p2p'
                                    ? 'Напряму, P2P'
                                    : msg.transport === 'relay'
                                    ? 'Через релей'
                                    : 'Через вузол'}
                                </p>
                              )}

                              {/* Чесна межа: що саме бачать дороги, а що — свій
                                  вузол. Без цього «шлях листа» показує лише
                                  дорогу і мовчить про те, хто на ній читає. */}
                              <p className="text-[11px] text-[#8A9186] leading-relaxed mt-2 pt-2 border-t border-[#F0EADD]">
                                Лист запечатано між вузлами — ретранслятор і скринька
                                везуть тільки шифротекст. Ваш власний вузол довірений:
                                він тримає ключі, як телефон тримає ваші чати.
                              </p>

                              {msg.status === 'queued' && (
                                <div className="mt-2 space-y-2">
                                  <p className="text-[11.5px] text-[#6E7568] leading-relaxed">
                                    {stuckAttachment(msg) === 'parked'
                                      ? 'Байти вкладення вже в хмарі — співрозмовник забере їх сам, щойно прокинеться. Але поки що їх у нього немає.'
                                      : stuckAttachment(msg)
                                        ? 'Вкладення лежить на вашому вузлі. Повеземо, щойно вузол співрозмовника обізветься.'
                                        : "Повідомлення чекає на вашому вузлі. Надішлемо, щойно співрозмовник з'явиться в мережі."}
                                    {queueInfo && queueInfo.queued > 1
                                      ? ` Разом у черзі: ${queueInfo.queued}.`
                                      : ''}
                                  </p>
                                  <button
                                    onClick={handleFlushQueue}
                                    disabled={flushing}
                                    className="w-full py-1.5 rounded-[10px] bg-[#D96C35] hover:bg-[#B85425] text-[#FDFCF9] text-[12px] font-bold transition-colors disabled:opacity-50"
                                  >
                                    {flushing ? 'Пробуємо…' : 'Спробувати зараз'}
                                  </button>
                                </div>
                              )}

                              {msg.status === 'failed' && (
                                <div className="mt-2">
                                  <p className="text-[11.5px] text-[#6E7568] leading-relaxed mb-2">
                                    Вузол не прийняв лист. Можна повторити спробу.
                                  </p>
                                  <button
                                    onClick={() => useMessengerStore.getState().retrySend(msg.id)}
                                    className="w-full py-1.5 rounded-[10px] bg-[#D96C35] hover:bg-[#B85425] text-[#FDFCF9] text-[12px] font-bold transition-colors"
                                  >
                                    Повторити
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Compact & Clean Message Hover Bar (Desktop). Тримаємо його
                      ПОВНІСТЮ над бульбашкою (bottom-full), інакше нижній край
                      панелі накривав перший рядок тексту. */}
                  {hoveredMessageId === msg.id && (
                    <div className={`absolute bottom-full mb-1 ${
                      isSelf ? 'right-1' : 'left-1'
                    } bg-[#FDFCF9] border border-[#E8E1D3] text-[#21261F] rounded-[10px] px-1 py-0.5 flex items-center gap-0.5 shadow-[0_1px_2px_rgba(60,44,24,0.05)] z-20 animate-in fade-in duration-100`}>
                      {/* Top 3 Quick Emojis */}
                      {['❤️', '👍', '🔥'].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            soundFx.playTap();
                            onAddReaction(msg.id, emoji);
                          }}
                          className="hover:scale-125 transition-transform text-xs p-1"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}

                      {/* More Emojis */}
                      <button
                        onClick={() => handleOpenReactionPicker(msg.id)}
                        className="p-1 hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#E87A42] rounded-full transition-colors"
                        title="Інші реакції"
                      >
                        <SmilePlus className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>

                      <div className="w-px h-3 bg-[#E6DFD3] mx-0.5" />

                      {/* Reply button */}
                      <button
                        onClick={() => {
                          soundFx.playTap();
                          onReplyMessage(msg);
                        }}
                        className="p-1 hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#E87A42] rounded-full transition-colors"
                        title="Відповісти"
                      >
                        <Reply className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>

                      {/* More Menu / Actions Sheet */}
                      <button
                        onClick={() => {
                          soundFx.playTap();
                          setContextMenuMsg(msg);
                        }}
                        className="p-1 hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#E87A42] rounded-full transition-colors"
                        title="Всі дії та AI інструменти"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                  </div>
                  </div>

                  {/* Реакції — рядок пігулок під бульбашкою; у чужих зсунутий
                      на ширину аватара, щоб стояти рівно під бульбашкою. */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className={`flex flex-wrap items-center gap-1 mt-1 -mb-0.5 z-10 select-none ${
                      isSelf ? 'justify-end pr-0.5' : 'justify-start pl-10'
                    }`}>
                      {msg.reactions.map((r, idx) => {
                        const isUserReacted = r.users.includes(currentUserId);
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              soundFx.playSend();
                              onAddReaction(msg.id, r.emoji);
                            }}
                            className={`group/reaction relative px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition-all duration-150 active:scale-95 shadow-sm ${
                              isUserReacted
                                ? 'bg-[#F1EDE3] border-[#E87A42] text-[#E87A42] font-bold ring-1 ring-[#E87A42]/30'
                                : 'bg-[#FDFCF9] border-[#E6DFD3] text-[#1E2521] hover:bg-[#F9F7F1] hover:text-[#1E2521]'
                            }`}
                            title={`Реагували: ${r.users.join(', ')}`}
                          >
                            <span className="text-[12px] leading-none transition-transform group-hover/reaction:scale-115">
                              {r.emoji}
                            </span>
                            <span className="text-[9.5px] font-semibold opacity-90">{r.count}</span>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => handleOpenReactionPicker(msg.id)}
                        className="px-1.5 py-0.5 rounded-full text-xs border border-dashed border-[#E6DFD3] text-[#5F6A60] hover:text-[#E87A42] hover:border-[#E87A42] bg-[#FDFCF9]/70 hover:bg-[#F9F7F1] transition-all flex items-center justify-center shadow-xs"
                        title="Додати реакцію"
                      >
                        <SmilePlus className="w-2.5 h-2.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* Live Typing / Thinking Indicator */}
        {isAiTyping && (
          <div className="mt-[10px] flex items-center gap-2 text-[12.5px] text-[#6E7568] bg-white px-3 py-2 rounded-[12px] w-fit border border-[#E8E1D3]">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-[var(--msg-meta)] rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-[var(--msg-meta)] rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-[var(--msg-meta)] rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
            <span>Локальний агент формує відповідь…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Кнопка «вниз» живе поза скролером, але в межах стрічки — інакше вона
          їхала б разом із повідомленнями. Композер — сусідній блок під ChatArea,
          тож нижній край стрічки і є його верхньою межею. */}
      {showScrollBottom && (
        newIncoming > 0 ? (
          <button
            onClick={scrollToBottom}
            data-testid="scroll-new-messages"
            className="absolute bottom-5 right-5 h-[34px] pl-2.5 pr-3 bg-[#D96C35] text-[#FDFCF9] hover:bg-[#B85425] rounded-full shadow-[0_1px_3px_rgba(60,44,24,0.18)] z-20 transition-colors flex items-center gap-1.5 text-[12.5px] font-semibold"
            title="Вниз до нових повідомлень"
          >
            <ArrowDown className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span>нові повідомлення</span>
            <span className="tabular-nums bg-[#FDFCF9]/25 rounded-full px-1.5 text-[11.5px]">
              {newIncoming}
            </span>
          </button>
        ) : (
          <button
            onClick={scrollToBottom}
            data-testid="scroll-bottom"
            className="absolute bottom-5 right-5 w-[34px] h-[34px] bg-white text-[#6E7568] border border-[#E8E1D3] hover:bg-[#F3EEE3] rounded-full shadow-[0_1px_2px_rgba(60,44,24,0.05)] z-20 transition-colors flex items-center justify-center"
            title="Вниз до нових повідомлень"
          >
            <ArrowDown className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )
      )}
        </div>

        {/* Canvas Split Side Panel */}
        {isCanvasSplitOpen && (
          <div
            className={`h-full shrink-0 border-l border-[#E5DEC9] dark:border-white/10 z-20 transition-all duration-300 ${
              canvasWidthMode === 'full'
                ? 'w-full absolute inset-0 z-30'
                : canvasWidthMode === 'wide'
                ? 'w-[65%] min-w-[520px]'
                : 'w-[480px] xl:w-1/2 min-w-[400px]'
            }`}
          >
            <CanvasSplitView
              chatTitle={currentChat?.title || 'Бесіда'}
              chatId={currentChat?.id}
              messages={messages}
              widthMode={canvasWidthMode}
              onToggleWidthMode={setCanvasWidthMode}
              onClose={() => setIsCanvasSplitOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Toast Notification Banner */}
      {toastNotification && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-[#F3EEE3] border border-[#E8E1D3] text-[#21261F] px-3 py-1.5 rounded-lg text-[12.5px] shadow-[0_1px_2px_rgba(60,44,24,0.05)] z-30 animate-in fade-in duration-150 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-[#6E7568] shrink-0" strokeWidth={1.75} />
          <span>{toastNotification}</span>
        </div>
      )}

      {/* Floating Quoting Tooltip for Selected Message Text */}
      {selectedTextSnippet && (
        <div
          style={{
            position: 'fixed',
            left: `${selectedTextSnippet.x}px`,
            top: `${selectedTextSnippet.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
          className="z-50 bg-[#FDFCF9] text-[#21261F] px-3 py-1.5 rounded-[10px] border border-[#E8E1D3] shadow-[0_1px_2px_rgba(60,44,24,0.05)] flex items-center gap-2 text-[12.5px] animate-in fade-in duration-150 cursor-pointer hover:bg-[#F3EEE3] transition-colors select-none"
          onClick={(e) => {
            e.stopPropagation();
            soundFx.playTap();
            onReplyMessage(selectedTextSnippet.msg, selectedTextSnippet.text);
            window.getSelection()?.removeAllRanges();
            setSelectedTextSnippet(null);
            showToast('Цитату фрагмента додано до відповіді');
          }}
        >
          <Quote className="w-3.5 h-3.5 text-[#6E7568] shrink-0" strokeWidth={1.75} />
          <span>Цитувати виділене</span>
          <span className="text-[11.5px] text-[#6E7568] truncate max-w-[120px]">
            «{selectedTextSnippet.text}»
          </span>
        </div>
      )}

      {/* 4. Modals */}
      {/* Mobile Context Action Sheet / Long-Press Menu */}
      {contextMenuMsg && (
        <div
          className="fixed inset-0 phantom-scrim z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setContextMenuMsg(null)}
        >
          <div
            className="bg-[#FDFCF9] border border-[#DDD4C4] text-[#1E2521] rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Sheet Drag Handle */}
            <div className="w-12 h-1.5 bg-[#E6DFD3] rounded-full mx-auto sm:hidden" />

            {/* Message Preview Header */}
            <div className="flex items-center gap-3 pb-3 border-b border-[#E6DFD3]">
              <Avatar
                src={contextMenuMsg.senderAvatar}
                name={contextMenuMsg.senderName}
                className="w-10 h-10 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-xs text-[#1E2521] truncate">
                    {contextMenuMsg.senderName}
                  </h4>
                  <span className="text-[10px] text-[#5F6A60] font-mono shrink-0">
                    {contextMenuMsg.timestamp}
                  </span>
                </div>
                <p className="text-[11px] text-[#5F6A60] line-clamp-2 mt-0.5">
                  {contextMenuMsg.text
                    || (contextMenuMsg.media || contextMenuMsg.fileData
                      ? `${contextMenuMsg.type === 'image' ? 'Фото' : 'Файл'}: ${attachmentName(contextMenuMsg)}`
                      : `Картка: ${contextMenuMsg.type}`)}
                </p>
              </div>
              <button
                onClick={() => setContextMenuMsg(null)}
                className="p-1.5 hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] rounded-xl transition-colors shrink-0"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* Quick Reactions Bar */}
            <div className="bg-[#F7F5EE] border border-[#E6DFD3] rounded-2xl p-2.5 flex items-center justify-around shadow-sm">
              {['❤️', '👍', '🔥', '😂', '🎉', '🙏', '🚀'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    soundFx.playTap();
                    onAddReaction(contextMenuMsg.id, emoji);
                    setContextMenuMsg(null);
                    showToast(`${emoji} Реакцію надіслано`);
                  }}
                  className="p-1 text-xl hover:scale-125 transition-transform active:scale-95"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => {
                  soundFx.playTap();
                  handleOpenReactionPicker(contextMenuMsg.id);
                  setContextMenuMsg(null);
                }}
                className="p-1.5 hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#E87A42] rounded-xl text-xs font-bold flex items-center gap-1"
                title="Більше емодзі"
              >
                <SmilePlus className="w-4 h-4 text-[#E87A42]" strokeWidth={1.75} />
              </button>
            </div>

            {/* Action Buttons Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs font-medium text-[#1E2521]">
              {/* TTS Voice Readout */}
              <button
                onClick={() => {
                  handleSpeakMessage(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                {speakingMsgId === contextMenuMsg.id ? (
                  <VolumeX className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                ) : (
                  <Volume2 className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                )}
                <span className="truncate">
                  {speakingMsgId === contextMenuMsg.id ? 'Зупинити озвучування' : 'Прослухати (TTS)'}
                </span>
              </button>

              {/* Reply */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  onReplyMessage(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <Reply className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Відповісти</span>
              </button>

              {/* Quote */}
              {contextMenuMsg.text && (
                <button
                  onClick={() => {
                    soundFx.playTap();
                    const msgText = contextMenuMsg.text || '';
                    const snippet = msgText.length > 90 ? msgText.slice(0, 90) + '…' : msgText;
                    onReplyMessage(contextMenuMsg, snippet);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <Quote className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Цитувати</span>
                </button>
              )}

              {/* AI Translation */}
              {contextMenuMsg.text && (
                <button
                  onClick={() => {
                    handleToggleTranslate(contextMenuMsg);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <Languages className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Перекласти (EN)</span>
                </button>
              )}

              {/* AI Key Takeaway */}
              {contextMenuMsg.text && (
                <button
                  onClick={() => {
                    handleToggleSummary(contextMenuMsg);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <Sparkles className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Підсумок агента</span>
                </button>
              )}

              {/* AI Action Tasks */}
              {contextMenuMsg.text && (
                <button
                  onClick={() => {
                    handleGenerateActionItems(contextMenuMsg);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Завдання з повідомлення</span>
                </button>
              )}

              {/* Pin / Unpin */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  onTogglePinMessage?.(contextMenuMsg.id);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <Pin className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                <span className="truncate">{contextMenuMsg.isPinned ? 'Відкріпити' : 'Закріпити'}</span>
              </button>

              {/* Bookmark */}
              <button
                onClick={() => {
                  handleToggleBookmark(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <Bookmark className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                <span className="truncate">{savedMessages[contextMenuMsg.id] ? 'Видалити з Обраного' : 'В Обране'}</span>
              </button>

              {/* Copy Text */}
              {contextMenuMsg.text && (
                <button
                  onClick={() => {
                    copyMessageText(contextMenuMsg.text!);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <Copy className="w-4 h-4 text-[#5F6A60] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Копіювати</span>
                </button>
              )}

              {/* Forward */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  onForwardMessage?.(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <Forward className="w-4 h-4 text-[#5F6A60] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Переслати</span>
              </button>

              {/* Multi-Select */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  onToggleSelectMessage(contextMenuMsg.id);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <CheckSquare className="w-4 h-4 text-[#5F6A60] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Вибрати</span>
              </button>

              {/* Message Details */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  setInspectingMessage(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
              >
                <Info className="w-4 h-4 text-[#5F6A60] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Інфо / P2P</span>
              </button>

              {/* Edit (if self) */}
              {(contextMenuMsg.senderId === currentUserId || contextMenuMsg.isSelf) && contextMenuMsg.text && (
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onEditMessage?.(contextMenuMsg);
                    setContextMenuMsg(null);
                  }}
                  className="p-2.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] border border-[#E6DFD3] hover:border-[#DDD4C4] rounded-xl flex items-center gap-2 transition-all text-left shadow-sm hover:text-[#1E2521]"
                >
                  <Edit2 className="w-4 h-4 text-[#E87A42] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Редагувати</span>
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  setDeletingMessage(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="p-2.5 bg-red-950/40 hover:bg-red-950/70 border border-red-900/60 text-red-400 rounded-xl flex items-center gap-2 transition-all text-left shadow-sm col-span-2"
              >
                <Trash2 className="w-4 h-4 text-red-400 shrink-0" strokeWidth={1.75} />
                <span className="font-bold">Видалити повідомлення</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ReactionPickerModal
        isOpen={isReactionModalOpen}
        onClose={() => {
          setIsReactionModalOpen(false);
          setTargetReactionMsgId(null);
        }}
        onSelectEmoji={handleSelectReactionEmoji}
      />

      <MessageDetailsModal
        isOpen={!!inspectingMessage}
        message={inspectingMessage}
        chatTitle={currentChat?.title}
        members={currentChat?.members}
        onClose={() => setInspectingMessage(null)}
      />

      <DeleteMessageModal
        isOpen={!!deletingMessage}
        isSelfMessage={deletingMessage?.senderId === currentUserId || !!deletingMessage?.isSelf}
        messageTextPreview={deletingMessage?.text || deletingMessage?.type}
        onClose={() => setDeletingMessage(null)}
        onConfirmDelete={(deleteForEveryone) => {
          if (deletingMessage) {
            onDeleteMessage?.(deletingMessage.id, deleteForEveryone);
            showToast('Повідомлення видалено');
          }
        }}
      />
    </div>
  );
});

ChatArea.displayName = 'ChatArea';
