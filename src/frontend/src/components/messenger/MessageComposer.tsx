import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Send,
  Smile,
  X,
  Plus,
  Clock,
  Check,
  Layers,
  AtSign,
  Reply,
  Sparkles,
  Type,
  Bold,
  Italic,
  Code,
  Image as ImageIcon,
  File as FileIcon,
  MapPin,
  Columns,
  BarChart2,
  ShieldCheck,
  Terminal,
  Network,
  GitCommit,
  Calendar,
  Video
} from 'lucide-react';
import { Message, ChatMember, MessageReplyInfo } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { chatApi } from '../../services/api';
import { useMessengerStore } from '../../stores/messengerStore';
import { MEDIA_LIMIT_LABEL } from '../../services/messengerMedia';

interface MessageComposerProps {
  onSendMessage: (text: string, scheduledTime?: string) => void;
  onSendVoiceMessage: (duration: number, transcript: string) => void;
  onOpenActions: () => void;
  onOpenScheduler: () => void;
  onOpenScheduledList?: () => void;
  scheduledCountInCurrentChat?: number;
  replyingTo: MessageReplyInfo | null;
  onCancelReply: () => void;
  onRemoveReplyQuote?: (quoteId: string) => void;
  editingMessage: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (messageId: string, newText: string) => void;
  selectedMessagesForQuote: Message[];
  onSynthesizeMultiQuote: (title: string, userCommentary: string) => void;
  onClearSelectedQuotes: () => void;
  scheduledTime?: string;
  onClearScheduledTime?: () => void;
  chatMembers?: ChatMember[];
  chatId?: string;
  initialDraft?: string;
  onDraftChange?: (chatId: string, draftText: string) => void;
}

const emojiList = ['✨', '🌱', '☕', '❤️', '👍', '🔥', '👏', '🙌', '💡', '📌', '🎯', '🚀', '🌿', '🤝', '😊', '👌', '🤩', '🫡', '🎉', '🏆'];

const stylePresets = [
  { id: 'concise', label: 'Лаконічно', desc: 'Прибрати зайве та виділити суть', prompt: 'Перепиши текст стисло, зберігши зміст.' },
  { id: 'warm', label: 'Тепло і дружньо', desc: 'Тепліший, дружній тон', prompt: 'Перепиши текст теплішим, дружнім тоном.' },
  { id: 'business', label: 'Діловий тон', desc: 'Стриманий робочий тон', prompt: 'Перепиши текст стриманим діловим тоном.' },
  { id: 'polite', label: 'Ввічливо і м’яко', desc: 'Делікатніше формулювання', prompt: 'Перепиши текст ввічливіше й делікатніше.' },
  { id: 'translate_en', label: 'Перекласти англійською', desc: 'Переклад тексту англійською', prompt: 'Переклади текст англійською.' },
  { id: 'fix_grammar', label: 'Виправити граматику', desc: 'Правопис і пунктуація', prompt: 'Виправ орфографію та пунктуацію, не змінюючи змісту й тону.' },
];

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSendMessage,
  onSendVoiceMessage: _onSendVoiceMessage,
  onOpenActions: _onOpenActions,
  onOpenScheduler: _onOpenScheduler,
  onOpenScheduledList,
  scheduledCountInCurrentChat = 0,
  replyingTo,
  onCancelReply,
  onRemoveReplyQuote,
  editingMessage,
  onCancelEdit,
  onSaveEdit,
  selectedMessagesForQuote,
  onSynthesizeMultiQuote,
  onClearSelectedQuotes,
  scheduledTime,
  onClearScheduledTime,
  chatMembers = [],
  chatId,
  initialDraft = '',
  onDraftChange,
}) => {
  const [text, setText] = useState(initialDraft);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showFormattingBar, setShowFormattingBar] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  // Смуга завантаження живе тут, бо саме тут людина натиснула «+». Відсоток
  // приходить з XHR — це справжні надіслані байти, а не анімація очікування.
  // index/total — чесна черга, коли файлів кілька.
  const [upload, setUpload] = useState<{
    name: string;
    percent: number;
    index: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendAttachment = useMessengerStore((st) => st.sendAttachment);
  const sendGeoPoint = useMessengerStore((st) => st.sendGeoPoint);

  /**
   * «Моє місце»: одна точка з браузера, з часом ВИМІРУ в тілі кадру.
   *
   * Тут не вигадується нічого: немає дозволу, немає координат, не встиг
   * пристрій — так і кажемо, замість останньої відомої або нуля на екваторі.
   */
  const shareMyPlace = () => {
    setShowAttachMenu(false);
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Цей браузер не вміє визначати місце — надсилати нічого');
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        void sendGeoPoint({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          // Час виміру бере сам пристрій — саме він поїде в кадрі.
          atMs: pos.timestamp || Date.now(),
          ...(Number.isFinite(pos.coords.accuracy)
            ? { accuracyM: Math.round(pos.coords.accuracy) }
            : {}),
        }).catch(() => setGeoError('Вузол не прийняв точку — вона нікуди не поїхала'));
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Дозвіл на місце не дано — точка не поїде'
            : err.code === err.TIMEOUT
            ? 'Пристрій не визначив місце за 15 секунд'
            : 'Координат немає: пристрій не бачить свого місця',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const sendKanbanWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_kanban_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:kanban',
      isSelf: true,
      kanbanData: {
        id: `k_${Date.now()}`,
        title: 'Командний Спринт & Завдання',
        columns: [
          {
            id: 'c1',
            title: 'Черга (To Do)',
            items: [{ id: 'i1', title: 'Архітектурний огляд Phase 1', priority: 'high' }],
          },
          {
            id: 'c2',
            title: 'В роботі (In Progress)',
            items: [{ id: 'i2', title: 'Реалізація Canvas Split-View', priority: 'urgent', assignee: 'Ви' }],
          },
          {
            id: 'c3',
            title: 'Завершено (Done)',
            items: [{ id: 'i3', title: 'Підготовка середовища', priority: 'med' }],
          },
        ],
      },
    });
  };

  const sendVotingWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_voting_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:voting',
      isSelf: true,
      votingData: {
        id: `v_${Date.now()}`,
        question: 'Затвердження релізу Work OS (v1.0)',
        options: [
          { id: 'o1', text: 'Затвердити та викатити у продакшн', votes: 1, voters: [currentUser.id] },
          { id: 'o2', text: 'Потрібно більше тестів', votes: 0, voters: [] },
          { id: 'o3', text: 'Доопрацювати UI деталі', votes: 0, voters: [] },
        ],
        totalVotes: 1,
        winningOptionId: 'o1',
        deadline: 'до кінця дня',
      },
    });
  };

  const sendRACIWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_raci_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:raci',
      isSelf: true,
      raciData: {
        id: `raci_${Date.now()}`,
        title: 'Матриця відповідальності релізу',
        roles: ['Тімлід', 'Frontend', 'Backend', 'DevOps'],
        rows: [
          { id: 'r1', task: 'Розгортання вузла Phantom OS', r: 'DevOps', a: 'Тімлід', c: 'Backend', i: 'Frontend' },
          { id: 'r2', task: 'Інтеграція Canvas & Віджетів', r: 'Frontend', a: 'Тімлід', c: 'Дизайн', i: 'Всі' },
          { id: 'r3', task: 'P2P Swarm & Cloudflare R2 міст', r: 'Backend', a: 'Тімлід', c: 'DevOps', i: 'Frontend' },
        ],
      },
    });
  };

  const sendCodeRunnerWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_coderunner_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:code-runner',
      isSelf: true,
      codeRunnerData: {
        id: `cr_${Date.now()}`,
        title: 'Тестовий запуск сніпету',
        language: 'javascript',
        code: `// Розрахунок метрик простору\nconst nodes = 8;\nconst throughputMbps = 940;\nconsole.log("P2P Mesh Throughput:", nodes * throughputMbps, "Mbps");`,
        status: 'idle',
      },
    });
  };

  const sendMermaidWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_mermaid_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'embed:mermaid',
      isSelf: true,
      mermaidData: {
        title: 'Архітектура P2P Work OS',
        code: `graph TD\nClient[Phantom Client] -->|E2EE Encrypted| Relay[Phantom Relay]\nRelay -->|P2P Mesh| Sibling[Peer Node]\nClient -->|Local Blobs| R2[Cloudflare R2 Bucket]`,
        caption: 'Топологія передачі шифроблобів та синхронізації',
      },
    });
  };

  const sendDiffWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_diff_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'embed:diff',
      isSelf: true,
      codeDiffData: {
        filename: 'src/core/router.ts',
        oldCode: `export function route(req) {\n  return handleClassicChat(req);\n}`,
        newCode: `export function route(req) {\n  // Work OS: hybrid thread to canvas & micro-widgets\n  return handleWorkOS(req);\n}`,
      },
    });
  };

  const sendTimelineWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_timeline_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:timeline',
      isSelf: true,
      timelineData: {
        id: `tl_${Date.now()}`,
        title: 'План розгортання Work OS v1.0',
        milestones: [
          { id: 'm1', title: 'Гібридні гілки (Threads → Canvas)', status: 'completed', progress: 100, dueDate: '26 сер', assignee: 'Кирило' },
          { id: 'm2', title: 'Мікро-віджети (Kanban, RACI, Timeline)', status: 'in_progress', progress: 85, dueDate: '27 сер', assignee: 'Саня' },
          { id: 'm3', title: 'Workspace Drive & P2P Swarm', status: 'in_progress', progress: 70, dueDate: '28 сер', assignee: 'Марина' },
          { id: 'm4', title: 'Локальний Webhook-хаб & CLI клієнт', status: 'pending', progress: 40, dueDate: '30 сер', assignee: 'Кирило' },
        ],
      },
    });
  };

  const sendAsyncSnippetWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_snippet_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'snippet:async',
      isSelf: true,
      asyncSnippetData: {
        id: `snip_${Date.now()}`,
        title: 'Огляд архітектури Canvas та автономних віджетів',
        durationSeconds: 145,
        authorName: currentUser.name,
        summary: 'Пояснення механіки переходу з лінійного чату у спліт-екран для документування фінальних рішень.',
        transcripts: [
          { timestamp: '0:00', timeSeconds: 0, text: 'Привіт команді! Сьогодні коротко пройдуся по гібридних гілках.' },
          { timestamp: '0:35', timeSeconds: 35, text: 'Будь-яка гілка тепер відкривається в Canvas спліт праворуч.' },
          { timestamp: '1:12', timeSeconds: 72, text: 'Всі картки та віджети зберігають свій стан у локальному CRDT.' },
        ],
      },
    });
  };

  const sendSvgPreviewWidget = () => {
    setShowAttachMenu(false);
    const currentUser = useMessengerStore.getState().currentUser;
    useMessengerStore.getState().addCustomMessage({
      id: `msg_svg_${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'embed:svg',
      isSelf: true,
      svgPreviewData: {
        title: 'Векторна схема вузла Phantom OS',
        svgContent: `<svg width="280" height="140" viewBox="0 0 280 140" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="280" height="140" rx="16" fill="#FAF7F0"/>
<rect x="20" y="30" width="70" height="80" rx="10" fill="#FDF5ED" stroke="#D96C35" stroke-width="2"/>
<text x="35" y="75" font-family="sans-serif" font-size="12" font-weight="bold" fill="#21261F">Клієнт</text>
<rect x="190" y="30" width="70" height="80" rx="10" fill="#FDF5ED" stroke="#D96C35" stroke-width="2"/>
<text x="208" y="75" font-family="sans-serif" font-size="12" font-weight="bold" fill="#21261F">Вузол</text>
<path d="M100 70H180" stroke="#D96C35" stroke-width="2" stroke-dasharray="4 4"/>
<circle cx="140" cy="70" r="14" fill="#D96C35"/>
<text x="135" y="74" font-family="sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF">P2P</text>
</svg>`,
      },
    });
  };

  /**
   * Кілька файлів — послідовні надсилання, по одному, з чесною чергою.
   *
   * Підпис їде з ПЕРШИМ вкладенням: людина набрала його ДО вибору файлів, і в
   * стрічці, яку читають згори вниз, пояснення мусить стояти перед тим, що
   * пояснює — інакше решта пакета проїде повз читача без слів.
   */
  const handlePickedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setShowAttachMenu(false);
    setUploadError(null);

    const note = text.trim();
    if (note) {
      setText('');
      if (chatId && onDraftChangeRef.current) onDraftChangeRef.current(chatId, '');
    }

    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      setUpload({ name: file.name, percent: 0, index: i + 1, total: files.length });
      try {
        await sendAttachment(
          file,
          (percent) => setUpload({ name: file.name, percent, index: i + 1, total: files.length }),
          i === 0 ? note : undefined,
        );
      } catch (err) {
        failed.push(err instanceof Error ? err.message : `«${file.name}» не надіслалось`);
      }
    }
    setUpload(null);
    if (failed.length) setUploadError(failed.join('; '));
  };
  const [styleBusyId, setStyleBusyId] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [multiQuoteTitle, setMultiQuoteTitle] = useState('Зведена цитата домовленостей');

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  // Sync draft when switching chats
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      // Switching to another chat: load this chat's initial draft
      prevChatIdRef.current = chatId;
      setText(initialDraft || '');
      setShowEmojiPicker(false);
      setShowStyleMenu(false);
      setShowFormattingBar(false);
      setShowAttachMenu(false);
      setMentionQuery(null);
    }
  }, [chatId, initialDraft]);

  // Композер росте під чернетку до ~6 рядків, далі — власний скрол. Без цього
  // з другого рядка людина не бачить, що пише: поле лишалось 28px завжди.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // Sync editing message
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.text || '');
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  // Track mentions in text and save draft per chat when typing
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setText(val);

    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, val);
    }

    // Look back from cursor to see if inside @mention
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\u0400-\u04FF]*)$/);

    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setMentionCursorPos(cursorPos);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSelectMention = (member: ChatMember) => {
    soundFx.playTap();
    if (!textareaRef.current) return;
    const cursorPos = mentionCursorPos;
    const textBefore = text.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    const textAfter = text.slice(cursorPos);

    const replacement = `@${member.name} `;
    const newText = text.slice(0, atIndex) + replacement + textAfter;
    setText(newText);
    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, newText);
    }
    setMentionQuery(null);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = atIndex + replacement.length;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 50);
  };

  const insertFormatting = (prefix: string, suffix: string = prefix) => {
    soundFx.playTap();
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = text.slice(start, end);

    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setText(newText);
    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, newText);
    }

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = start + prefix.length + selected.length;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 50);
  };

  const handleSend = () => {
    if (editingMessage) {
      if (text.trim()) {
        onSaveEdit(editingMessage.id, text.trim());
        setText('');
        if (chatId && onDraftChangeRef.current) {
          onDraftChangeRef.current(chatId, '');
        }
      }
      return;
    }

    if (selectedMessagesForQuote.length > 0) {
      onSynthesizeMultiQuote(multiQuoteTitle, text.trim());
      setText('');
      if (chatId && onDraftChangeRef.current) {
        onDraftChangeRef.current(chatId, '');
      }
      return;
    }

    if (!text.trim()) return;
    soundFx.playSend();
    onSendMessage(text.trim(), scheduledTime);
    setText('');
    if (chatId && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, '');
    }
    setMentionQuery(null);
    setShowFormattingBar(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const applyStyle = async (styleId: string) => {
    soundFx.playTap();
    const source = text.trim();
    const preset = stylePresets.find((s) => s.id === styleId);
    if (!source || !preset || styleBusyId) return;

    setStyleBusyId(styleId);
    setStyleError(null);
    try {
      const res = await chatApi.sendMessage({
        content: `${preset.prompt} У відповідь дай лише готовий текст, без коментарів.\n\n${source}`,
        input_method: 'text',
      });
      const newText = (res?.message?.content || '').trim();
      if (!newText) {
        setStyleError('Локальний агент не повернув тексту');
        return;
      }
      setText(newText);
      if (chatId && !editingMessage && onDraftChangeRef.current) {
        onDraftChangeRef.current(chatId, newText);
      }
      setShowStyleMenu(false);
    } catch {
      setStyleError('Локальний агент недоступний');
    } finally {
      setStyleBusyId(null);
    }
  };

  const canSend = !!text.trim() || selectedMessagesForQuote.length > 0 || !!editingMessage;

  const filteredMembers = mentionQuery !== null
    ? chatMembers.filter((m) =>
        m.name.toLowerCase().includes(mentionQuery) ||
        m.handle.toLowerCase().includes(mentionQuery)
      )
    : [];

  return (
    <div className="px-2.5 sm:px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.25rem)] bg-[#FDFCF9]/95 backdrop-blur-xl border-t border-[#E8E1D3] shrink-0 select-none relative z-30 text-[#21261F]">
      {/* Mention Autocomplete Dropdown */}
      {mentionQuery !== null && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-[#FDFCF9]/[0.97] backdrop-blur-2xl border border-[#E8E1D3] rounded-2xl shadow-[0_12px_32px_rgba(60,44,24,0.14)] w-64 max-h-48 overflow-y-auto p-1.5 z-30 animate-in fade-in zoom-in-95 duration-100 text-[#21261F]">
          <p className="text-[10px] font-bold text-[#6E7568] px-2 py-1 uppercase tracking-wider">
            Згадати учасника
          </p>
          {filteredMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelectMention(member)}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F1EBDD] rounded-xl text-left transition-colors"
            >
              <img src={member.avatar} alt={member.name} className="w-6 h-6 rounded-lg object-cover ring-1 ring-white/10" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-bold text-[#21261F] truncate">{member.name}</p>
                <p className="text-[10px] text-[#6E7568] truncate">{member.handle}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 1. Multi-Quote Synthesis Banner */}
      {selectedMessagesForQuote.length > 0 && (
        <div className="mb-2 p-2.5 bg-[#F7F5EF] border border-[#E8E1D3] rounded-2xl space-y-2 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-[#D96C35]" strokeWidth={1.75} />
              <span className="font-bold text-xs text-[#D96C35]">
                Зведена цитата з {selectedMessagesForQuote.length} повідомлень
              </span>
            </div>
            <button
              onClick={onClearSelectedQuotes}
              className="p-1 text-[#6E7568] hover:text-[#21261F] rounded-lg"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <input
            type="text"
            value={multiQuoteTitle}
            onChange={(e) => setMultiQuoteTitle(e.target.value)}
            placeholder="Заголовок зведеної цитати..."
            className="w-full px-2.5 py-1.5 bg-[#F3EEE3] border border-[#F1EBDD] rounded-xl text-xs font-semibold text-[#21261F] placeholder-[var(--msg-meta)] focus:outline-none focus:border-[#D96C35]"
          />

          <div className="space-y-1 max-h-20 overflow-y-auto">
            {selectedMessagesForQuote.map((m) => (
              <div key={m.id} className="text-[11px] text-[#6E7568] bg-[#F3EEE3] p-1.5 rounded-xl border border-[#E8E1D3] truncate">
                <span className="font-bold text-[#D96C35]">{m.senderName}: </span>
                <span>{m.text || m.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Replying-to Banner */}
      {replyingTo && (
        <div className="mb-2 p-2.5 bg-[#FDFCF9] border border-[#E8E1D3] border-l-4 border-l-[#D96C35] rounded-2xl space-y-1.5 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Reply className="w-3.5 h-3.5 text-[#D96C35] shrink-0" strokeWidth={1.75} />
              {replyingTo.quotes && replyingTo.quotes.length > 1 ? (
                <span className="font-bold text-[#D96C35] text-[11px] truncate">
                  Відповідь на {replyingTo.quotes.length} повідомлень
                </span>
              ) : replyingTo.quoteSelectedText ? (
                <span className="font-bold text-[#D96C35] text-[11px] truncate">
                  Цитата фрагмента від {replyingTo.senderName}
                </span>
              ) : (
                <span className="font-bold text-[#D96C35] text-[11px] truncate">
                  Відповідь для {replyingTo.senderName}
                </span>
              )}
            </div>
            <button
              onClick={onCancelReply}
              className="p-1 text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] rounded-lg transition-colors shrink-0"
              title="Скасувати відповідь"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {/* If Multi-message quotes */}
          {replyingTo.quotes && replyingTo.quotes.length > 0 ? (
            <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
              {replyingTo.quotes.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-2 bg-[#F3EEE3] px-2 py-1 rounded-xl border border-[#E8E1D3] text-[11px]"
                >
                  <div className="min-w-0 flex items-center gap-1.5 truncate">
                    {q.senderAvatar && (
                      <img src={q.senderAvatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
                    )}
                    <span className="font-bold text-[#D96C35] shrink-0">{q.senderName}:</span>
                    <span className="text-[#6E7568] truncate">{q.text}</span>
                  </div>
                  {onRemoveReplyQuote && (
                    <button
                      onClick={() => onRemoveReplyQuote(q.id)}
                      className="p-0.5 text-[color:var(--msg-meta)] hover:text-red-400 rounded-md shrink-0"
                      title="Прибрати цю цитату"
                    >
                      <X className="w-3 h-3" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : replyingTo.quoteSelectedText ? (
            <div className="bg-[#F3EEE3] p-2 rounded-xl border border-[#E8E1D3] text-xs">
              <p className="italic text-[#6E7568] leading-relaxed">
                «{replyingTo.quoteSelectedText}»
              </p>
            </div>
          ) : (
            <p className="text-[#6E7568] truncate text-[11px] pl-5">
              {replyingTo.text}
            </p>
          )}
        </div>
      )}

      {/* 3. Editing Message Banner */}
      {editingMessage && (
        <div className="mb-2 p-2.5 bg-[#F7F5EF] border-l-4 border-[#C98A2E] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in border border-[#E8E1D3]">
          <div className="min-w-0">
            <p className="font-bold text-[#C98A2E] text-[11px]">Редагування повідомлення</p>
            <p className="text-[#6E7568] truncate text-[11px]">{editingMessage.text}</p>
          </div>
          <button
            onClick={onCancelEdit}
            className="p-1 hover:bg-[#F7F5EF] rounded-lg text-[#6E7568] hover:text-[#21261F]"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* 4. Scheduled Time Badge */}
      {scheduledTime ? (
        <div className="mb-2 p-2 bg-[#F7F5EF] border border-[#E8E1D3] rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-[#C98A2E] font-semibold text-[11px]">
            <Clock className="w-3.5 h-3.5 text-[#C98A2E]" strokeWidth={1.75} />
            <span>Заплановано на: {scheduledTime}</span>
          </div>
          <div className="flex items-center gap-1">
            {onOpenScheduledList && (
              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  onOpenScheduledList();
                }}
                className="text-[10px] font-bold text-[#C98A2E] hover:underline px-1"
              >
                Всі відкладені
              </button>
            )}
            <button
              onClick={onClearScheduledTime}
              className="p-1 hover:bg-[#F7F5EF] rounded-lg text-[#6E7568] hover:text-[#21261F]"
              title="Скасувати таймер"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : scheduledCountInCurrentChat > 0 && onOpenScheduledList ? (
        <div className="mb-2 px-3 py-1.5 bg-[#FDFCF9]/95 border border-[#E8E1D3] rounded-xl flex items-center justify-between gap-2 text-[11px] backdrop-blur-md animate-in fade-in shadow-md">
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="flex items-center gap-1.5 text-[#D96C35] hover:text-[#21261F] font-semibold text-left transition-colors"
          >
            <Clock className="w-3.5 h-3.5 text-[#D96C35]" strokeWidth={1.75} />
            <span>
              У цьому чаті заплановано <strong className="text-[#21261F]">{scheduledCountInCurrentChat}</strong> повідомл.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="text-[10px] font-bold text-[#D96C35] hover:underline"
          >
            Переглянути →
          </button>
        </div>
      ) : null}

      {/* Смуга завантаження. Показуємо лише реальні відсотки з XHR і лише поки
          вони йдуть; жодного «майже готово» після того, як байти скінчились. */}
      {upload && (
        <div className="mb-2 px-3 py-2 bg-[#FDF4EC] border border-[#EBC7AE] rounded-xl">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11.5px] font-semibold text-[#21261F] truncate">
              {upload.total > 1 && (
                <span className="text-[#A9603A] tabular-nums">
                  {upload.index} з {upload.total} ·{' '}
                </span>
              )}
              {upload.name}
            </span>
            <span className="text-[11px] font-bold text-[#A9603A] tabular-nums shrink-0">
              {upload.percent}%
            </span>
          </div>
          <div className="h-1 bg-[#F1EBDD] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E87A42] transition-[width] duration-150"
              style={{ width: `${upload.percent}%` }}
            />
          </div>
        </div>
      )}

      {geoBusy && (
        <div className="mb-2 px-3 py-2 bg-[#FDF4EC] border border-[#EBC7AE] rounded-xl">
          <span className="text-[11.5px] text-[#A9603A]">
            Питаю пристрій про місце…
          </span>
        </div>
      )}

      {(uploadError || geoError) && (
        <div className="mb-2 px-3 py-2 bg-[#FBEBE6] border border-[#E9BFAE] rounded-xl flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-[#8C3B22]">{uploadError || geoError}</span>
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              setGeoError(null);
            }}
            className="text-[#8C3B22] hover:opacity-70 shrink-0"
            aria-label="Сховати помилку"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Приховані поля вибору. Для «Фото» звужуємо до зображень, для «Файл»
          не обмежуємо: людина сама знає, що надсилає. multiple — бо пакет
          знімків це одна дія, а не п'ять походів у меню. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handlePickedFile}
        data-testid="composer-photo-input"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePickedFile}
        data-testid="composer-file-input"
      />

      {/* 5. Main Clean Message Composer Bar */}
      <div className="flex items-end gap-2">
          {/* Attachments Button (+). Чесне меню вкладень: пункти є, але поки
              вимкнені з підписом «скоро» — жодних мертвих переходів у сторонні
              застосунки. */}
          <div className="relative shrink-0">
            <button
              onClick={() => {
                soundFx.playTap();
                setShowAttachMenu((v) => !v);
                setShowEmojiPicker(false);
                setShowStyleMenu(false);
                setShowFormattingBar(false);
              }}
              className={`w-[34px] h-[34px] min-w-0 min-h-0 mb-[5px] border border-[#E8E1D3] rounded-full transition-colors flex items-center justify-center ${
                showAttachMenu ? 'bg-[#F1EBDD] text-[#21261F]' : 'bg-transparent text-[#6E7568] hover:bg-[#F1EBDD] hover:text-[#21261F]'
              }`}
              title="Додати вкладення"
              aria-label="Додати вкладення"
            >
              <Plus className={`w-[18px] h-[18px] transition-transform ${showAttachMenu ? 'rotate-45' : ''}`} strokeWidth={1.75} />
            </button>

            {showAttachMenu && (
              <>
                <button
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setShowAttachMenu(false)}
                  aria-hidden
                />
                <div className="absolute bottom-12 left-0 bg-[#FDFCF9]/[0.97] backdrop-blur-2xl border border-[#E8E1D3] rounded-2xl p-1.5 shadow-[0_12px_32px_rgba(60,44,24,0.14)] w-52 z-30 space-y-0.5 animate-in fade-in zoom-in-95 duration-100 select-none text-[#21261F]">
                  <div className="px-2 py-1 flex items-baseline justify-between gap-2 border-b border-[#F1EBDD]">
                    <span className="text-[11px] font-extrabold text-[#6E7568] uppercase tracking-wide">
                      Вкладення
                    </span>
                    {/* Межу кажемо ДО вибору — щоб відмова не приходила після
                        того, як людина вже почекала на завантаження. */}
                    <span className="text-[10px] font-semibold text-[color:var(--msg-meta)] normal-case">
                      {MEDIA_LIMIT_LABEL}
                    </span>
                  </div>
                  {/* Фото, Файл і Моє місце працюють. Голосове чесно позначене
                      «скоро» — мертвий пункт гірший за відсутній. */}
                  {[
                    { icon: ImageIcon, label: 'Фото', pick: () => photoInputRef.current?.click() },
                    { icon: FileIcon, label: 'Файл', pick: () => fileInputRef.current?.click() },
                    { icon: MapPin, label: 'Моє місце', pick: shareMyPlace },
                  ].map(({ icon: Icon, label, pick }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        pick();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
                    >
                      <Icon className="w-4 h-4 shrink-0 text-[#E87A42]" strokeWidth={1.75} />
                      <span className="flex-1 font-semibold">{label}</span>
                    </button>
                  ))}

                  <div className="px-2 py-1 border-t border-[#F1EBDD] mt-1 pt-1">
                    <span className="text-[10px] font-extrabold text-[#6E7568] uppercase tracking-wide">
                      Work OS Віджети
                    </span>
                  </div>

                  {[
                    { icon: Columns, label: 'Kanban Спринт', pick: sendKanbanWidget, color: 'text-amber-500' },
                    { icon: BarChart2, label: 'Голосування', pick: sendVotingWidget, color: 'text-emerald-500' },
                    { icon: Calendar, label: 'Timeline / Gantt', pick: sendTimelineWidget, color: 'text-[#D96C35]' },
                    { icon: ShieldCheck, label: 'Матриця RACI', pick: sendRACIWidget, color: 'text-purple-500' },
                    { icon: Terminal, label: 'Code Runner', pick: sendCodeRunnerWidget, color: 'text-cyan-500' },
                    { icon: Video, label: 'Async Video сніпет', pick: sendAsyncSnippetWidget, color: 'text-rose-500' },
                    { icon: ImageIcon, label: 'SVG векторний макет', pick: sendSvgPreviewWidget, color: 'text-amber-600' },
                    { icon: Network, label: 'Mermaid Схема', pick: sendMermaidWidget, color: 'text-indigo-500' },
                    { icon: GitCommit, label: 'Git Diff код', pick: sendDiffWidget, color: 'text-emerald-500' },
                  ].map(({ icon: Icon, label, pick, color }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        pick();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${color}`} strokeWidth={1.75} />
                      <span className="flex-1 font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Center Input Box. Фокус показуємо темнішою межею, а не теракотовою
              рамкою на весь композер: підсвічувати треба курсор, не меблі. */}
          <div className="flex-1 min-w-0 bg-[#FDFCF9] border border-[#E8E1D3] focus-within:border-[#D9CFBB] rounded-[12px] pl-3.5 pr-2 py-[7px] flex items-end gap-1.5 transition-colors">
            {/* Text Input */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedMessagesForQuote.length > 0
                  ? 'Додайте коментар до цитати…'
                  : editingMessage
                  ? 'Редагувати повідомлення…'
                  : 'Написати повідомлення…'
              }
              className="flex-1 min-w-0 max-h-[140px] min-h-[28px] py-[5px] bg-transparent text-[13px] text-[#21261F] placeholder-[#6E7568] resize-none focus:outline-none select-text leading-[18px]"
            />

            {/* Праві іконки поля — одна група з власним проміжком, щоб не злипались */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Переписування чернетки локальним агентом */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setShowStyleMenu(!showStyleMenu);
                    setStyleError(null);
                    setShowEmojiPicker(false);
                    setShowFormattingBar(false);
                  }}
                  className={`w-[28px] h-[28px] min-w-0 min-h-0 rounded-[8px] flex items-center justify-center transition-colors ${
                    showStyleMenu ? 'text-[#21261F] bg-[#F1EBDD]' : 'text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD]'
                  }`}
                  title="Переписати чернетку локальним агентом"
                >
                  <Sparkles className={`w-[18px] h-[18px] ${styleBusyId ? 'animate-pulse' : ''}`} strokeWidth={1.75} />
                </button>

                {showStyleMenu && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/[0.97] backdrop-blur-2xl border border-[#E8E1D3] rounded-2xl p-2 shadow-[0_12px_32px_rgba(60,44,24,0.14)] w-64 z-30 space-y-1 animate-in fade-in select-none text-[#21261F]">
                    <div className="px-2 py-1 text-[11px] font-extrabold text-[#6E7568] uppercase tracking-wide border-b border-[#F1EBDD]">
                      Переписати локальним агентом
                    </div>
                    {stylePresets.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!text.trim() || !!styleBusyId}
                        onClick={() => applyStyle(s.id)}
                        className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-[#F1EBDD] text-xs flex flex-col transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <span className="font-bold text-[#21261F]">{s.label}</span>
                        <span className="text-[10px] text-[#6E7568]">
                          {styleBusyId === s.id ? 'Опрацьовую…' : s.desc}
                        </span>
                      </button>
                    ))}
                    {styleError && (
                      <div className="px-2.5 py-1.5 text-[10px] text-red-300 border-t border-[#F1EBDD]">
                        {styleError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inline Formatting Menu. На телефоні згорнуто: чотири значки
                  лишали полю вводу 116 px, а те саме розмітка дає набором
                  (**жирний**) — на відміну від переписування чи емодзі. */}
              <div className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setShowFormattingBar(!showFormattingBar);
                    setShowStyleMenu(false);
                    setShowEmojiPicker(false);
                  }}
                  className={`w-[28px] h-[28px] min-w-0 min-h-0 rounded-[8px] flex items-center justify-center transition-colors ${
                    showFormattingBar ? 'text-[#21261F] bg-[#F1EBDD]' : 'text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD]'
                  }`}
                  title="Форматування тексту (Markdown)"
                >
                  <Type className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </button>

                {showFormattingBar && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/[0.97] backdrop-blur-2xl border border-[#E8E1D3] rounded-2xl p-1.5 shadow-[0_12px_32px_rgba(60,44,24,0.14)] flex items-center gap-1 z-30 animate-in fade-in select-none text-[#21261F]">
                    <button
                      type="button"
                      onClick={() => insertFormatting('**')}
                      className="p-1.5 hover:bg-[#F1EBDD] rounded-lg text-xs font-bold"
                      title="Жирний (**текст**)"
                    >
                      <Bold className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormatting('*')}
                      className="p-1.5 hover:bg-[#F1EBDD] rounded-lg text-xs font-bold"
                      title="Курсив (*текст*)"
                    >
                      <Italic className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormatting('`')}
                      className="p-1.5 hover:bg-[#F1EBDD] rounded-lg text-xs font-bold"
                      title="Код (`код`)"
                    >
                      <Code className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline Emoji Picker Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setShowEmojiPicker(!showEmojiPicker);
                    setShowStyleMenu(false);
                    setShowFormattingBar(false);
                  }}
                  className={`w-[28px] h-[28px] min-w-0 min-h-0 rounded-[8px] flex items-center justify-center transition-colors ${
                    showEmojiPicker ? 'text-[#21261F] bg-[#F1EBDD]' : 'text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD]'
                  }`}
                  title="Емодзі"
                >
                  <Smile className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/[0.97] backdrop-blur-2xl border border-[#E8E1D3] rounded-2xl p-2.5 shadow-[0_12px_32px_rgba(60,44,24,0.14)] grid grid-cols-5 gap-1.5 w-56 z-30 animate-in fade-in">
                    {emojiList.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          soundFx.playTap();
                          const newText = text + e;
                          setText(newText);
                          if (chatId && !editingMessage && onDraftChangeRef.current) {
                            onDraftChangeRef.current(chatId, newText);
                          }
                          setShowEmojiPicker(false);
                        }}
                        className="p-1 text-base hover:scale-125 transition-transform"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Inline @ Mention Button */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  const newText = text + '@';
                  setText(newText);
                  setMentionQuery('');
                  setMentionCursorPos(newText.length);
                  textareaRef.current?.focus();
                }}
                className="hidden sm:flex w-[28px] h-[28px] min-w-0 min-h-0 rounded-[8px] items-center justify-center text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
                title="Згадати учасника (@)"
              >
                <AtSign className="w-[18px] h-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`w-[34px] h-[34px] min-w-0 min-h-0 mb-[5px] rounded-full transition-colors shrink-0 flex items-center justify-center ${
              canSend
                ? 'bg-[#D96C35] hover:bg-[#B85425] text-[#FDFCF9]'
                : 'bg-transparent text-[color:var(--msg-meta)] border border-[#E8E1D3] cursor-not-allowed'
            }`}
            title="Надіслати повідомлення"
          >
            {editingMessage ? <Check className="w-[18px] h-[18px]" strokeWidth={1.75} /> : <Send className="w-[17px] h-[17px]" strokeWidth={1.75} />}
          </button>
        </div>
    </div>
  );
};
