import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Send,
  X,
  Plus,
  Clock,
  Check,
  Layers,
  Reply,
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
  Video,
  Mic,
  Trash2,
} from 'lucide-react';
import { Message, ChatMember, MessageReplyInfo } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';
import { MEDIA_LIMIT_LABEL } from '../../services/messengerMedia';

interface MessageComposerProps {
  onSendMessage: (text: string, scheduledTime?: string) => void;
  onSendVoiceMessage: (
    duration: number,
    transcript: string,
    audioUrl?: string,
    waveform?: number[],
  ) => void;
  onOpenActions?: () => void;
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
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendAttachment = useMessengerStore((st) => st.sendAttachment);
  const sendGeoPoint = useMessengerStore((st) => st.sendGeoPoint);
  const voiceChunksRef = useRef<Blob[]>([]);
  /** Справжні піки мікрофона. Досі хвиля бралася з `Math.random()` —
   *  малюнок був однаково жвавий і для крику, і для тиші. */
  const voicePeaksRef = useRef<number[]>([]);
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceRafRef = useRef<number | null>(null);

  const startVoiceRecording = async () => {
    try {
      soundFx.playTap();
      setIsRecordingVoice(true);
      setRecordingSeconds(0);
      voiceChunksRef.current = [];
      voicePeaksRef.current = [];

      let stream: MediaStream | null = null;
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          voiceStreamRef.current = stream;
          if (typeof MediaRecorder !== 'undefined') {
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : MediaRecorder.isTypeSupported('audio/webm')
              ? 'audio/webm'
              : '';
            const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorderRef.current = mr;
            mr.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) {
                voiceChunksRef.current.push(e.data);
              }
            };
            mr.start(100);

            // RMS сигналу, зцентрованого на 128, ~20 разів на секунду.
            // Той самий розрахунок, що вже робить useVoiceRecorder для
            // пульсації сфери — тут ми його не викидаємо, а зберігаємо.
            try {
              const AudioCtx =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext })
                  .webkitAudioContext;
              if (AudioCtx) {
                const ctx = new AudioCtx();
                voiceAudioCtxRef.current = ctx;
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                ctx.createMediaStreamSource(stream).connect(analyser);
                const buf = new Uint8Array(analyser.fftSize);
                let lastTick = 0;
                const sample = () => {
                  const now = performance.now();
                  if (now - lastTick >= 50) {
                    lastTick = now;
                    analyser.getByteTimeDomainData(buf);
                    let sum = 0;
                    for (const v of buf) {
                      const d = (v - 128) / 128;
                      sum += d * d;
                    }
                    voicePeaksRef.current.push(Math.min(1, Math.sqrt(sum / buf.length) * 3));
                  }
                  voiceRafRef.current = requestAnimationFrame(sample);
                };
                voiceRafRef.current = requestAnimationFrame(sample);
              }
            } catch {
              // Немає WebAudio — хвилі не буде. Не вигадуємо її.
            }
          }
        } catch (e) {
          console.warn('[voice] microphone access:', e);
        }
      }

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setIsRecordingVoice(false);
    }
  };

  /** Зупиняє замір і віддає 32 стовпчики зі справжніх піків. Якщо мікрофон
   *  чи WebAudio недоступні — порожньо: рендерер малює нуль смужок. */
  const harvestVoicePeaks = (): number[] => {
    if (voiceRafRef.current != null) {
      cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
    }
    if (voiceAudioCtxRef.current) {
      try {
        void voiceAudioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      voiceAudioCtxRef.current = null;
    }
    const raw = voicePeaksRef.current;
    voicePeaksRef.current = [];
    if (raw.length === 0) return [];

    const BARS = 32;
    const out: number[] = [];
    for (let i = 0; i < BARS; i += 1) {
      const from = Math.floor((i * raw.length) / BARS);
      const to = Math.max(from + 1, Math.floor(((i + 1) * raw.length) / BARS));
      let peak = 0;
      for (let j = from; j < to && j < raw.length; j += 1) {
        if (raw[j] > peak) peak = raw[j];
      }
      out.push(peak);
    }
    // Нормуємо до найгучнішого стовпчика, щоб тиха, але справжня хвиля
    // читалась. Форма лишається виміряною — міняється лише масштаб.
    const loudest = Math.max(...out);
    return loudest > 0.02 ? out.map((v) => Math.max(0.04, v / loudest)) : out;
  };

  const cancelVoiceRecording = () => {
    soundFx.playTap();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    harvestVoicePeaks();
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
    voiceChunksRef.current = [];
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
  };

  const finishVoiceRecording = () => {
    soundFx.playSend();
    const duration = Math.max(1, recordingSeconds);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const waveform = harvestVoicePeaks();
    const deliverVoice = (url?: string) => {
      _onSendVoiceMessage(duration, 'Голосове повідомлення', url, waveform);
    };

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        const mr = mediaRecorderRef.current;
        mr.onstop = () => {
          if (voiceChunksRef.current.length > 0) {
            const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            deliverVoice(url);
          } else {
            deliverVoice();
          }
        };
        mr.stop();
      } catch {
        deliverVoice();
      }
    } else {
      deliverVoice();
    }

    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
  };

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
      // ЩО БУЛО: три вписані картки з вигаданими завданнями й пріоритетами
      // («Архітектурний огляд Phase 1», «urgent»), які так само їхали в
      // справжню бесіду одним дотиком. Колонки лишаємо — це каркас, який
      // людина заповнює; картки прибираємо — це зміст, якого ми не знаємо.
      kanbanData: {
        id: `k_${Date.now()}`,
        title: 'Дошка завдань',
        columns: [
          { id: 'c1', title: 'Черга', items: [] },
          { id: 'c2', title: 'В роботі', items: [] },
          { id: 'c3', title: 'Завершено', items: [] },
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
      // ЩО БУЛО, і це найгірше з усього набору: опитування приходило з
      // УЖЕ ВІДДАНИМ ГОЛОСОМ від імені відправника — `votes: 1`,
      // `voters: [currentUser.id]`, `winningOptionId: 'o1'`. Тобто один
      // дотик публікував у бесіду не лише вигадане питання («Затвердити та
      // викатити у продакшн»), а й **вигадану дію людини**: нібито вона вже
      // проголосувала за викочування в продакшн, і нібито це вже перемагає.
      //
      // Вигаданий зміст — погано. Вигаданий вчинок, приписаний людині, —
      // інший клас: його не відрізнити від справжнього ні їй, ні іншим.
      votingData: {
        id: `v_${Date.now()}`,
        question: '',
        options: [
          { id: 'o1', text: '', votes: 0, voters: [] },
          { id: 'o2', text: '', votes: 0, voters: [] },
        ],
        totalVotes: 0,
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
      // Ролі — це каркас матриці, він лишається. Рядки були вигаданим
      // розподілом відповідальності за роботи, яких ніхто не призначав.
      raciData: {
        id: `raci_${Date.now()}`,
        title: 'Матриця відповідальності',
        roles: ['Тімлід', 'Frontend', 'Backend', 'DevOps'],
        rows: [],
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
      // ЩО БУЛО: готовий «План розгортання Work OS v1.0» із чотирьох віх —
      // з відсотками виконання, датами й іменами ЖИВИХ людей у полі
      // виконавця: «Кирило», «Саня», «Марина». Це не приклад у документації:
      // `sendTimelineWidget` — пункт меню вкладень, тобто один дотик
      // **публікував у справжню бесіду** вигаданий план, у якому названі
      // люди нібито щось роблять на 85 і 70 відсотків.
      //
      // Той самий клас, що конспект нарад: вигадка, яка виходить назовні й
      // виглядає як запис. Порожній таймлайн — не збіднення, а єдина чесна
      // початкова форма: план складає людина, а не ми за неї.
      timelineData: {
        id: `tl_${Date.now()}`,
        title: 'Таймлайн',
        milestones: [],
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
      // ЩО БУЛО: вигаданий голосовий запис на 145 секунд, підписаний
      // ІМЕНЕМ САМОГО КОРИСТУВАЧА (`authorName: currentUser.name`), з
      // розшифровкою трьох реплік, яких він ніколи не казав: «Привіт
      // команді! Сьогодні коротко пройдуся…».
      //
      // Це вигадана МОВА, приписана живій людині, — і вона їхала в бесіду
      // одним дотиком. Порожній запис без тривалості чесний: людина сама
      // наговорить і сама підпише.
      asyncSnippetData: {
        id: `snip_${Date.now()}`,
        title: '',
        durationSeconds: 0,
        authorName: currentUser.name,
        summary: '',
        transcripts: [],
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
    <div className="px-2.5 sm:px-4 pt-1.5 pb-2 bg-[#0E1410] border-t border-[rgba(255,255,255,0.07)] shrink-0 select-none relative z-30 text-white">
      {/* Mention Autocomplete Dropdown */}
      {mentionQuery !== null && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-[#141C16]/[0.98] backdrop-blur-2xl border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl w-64 max-h-48 overflow-y-auto p-1.5 z-30 animate-in fade-in zoom-in-95 duration-100 text-[#F8FAF8]">
          <p className="text-[10px] font-bold text-[#8EA093] px-2 py-1 uppercase tracking-wider">
            Згадати учасника
          </p>
          {filteredMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelectMention(member)}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#18231C] rounded-xl text-left transition-colors"
            >
              <img src={member.avatar} alt={member.name} className="w-6 h-6 rounded-lg object-cover ring-1 ring-white/10" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-bold text-[#F8FAF8] truncate">{member.name}</p>
                <p className="text-[10px] text-[#8EA093] truncate">{member.handle}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 1. Multi-Quote Synthesis Banner */}
      {selectedMessagesForQuote.length > 0 && (
        <div className="mb-2 p-2.5 bg-[#141C16] border border-[rgba(255,255,255,0.08)] rounded-2xl space-y-2 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-[#F4AF25]" strokeWidth={1.75} />
              <span className="font-bold text-xs text-[#F4AF25]">
                Зведена цитата з {selectedMessagesForQuote.length} повідомлень
              </span>
            </div>
            <button
              onClick={onClearSelectedQuotes}
              className="p-1 text-[#8EA093] hover:text-white rounded-lg"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <input
            type="text"
            value={multiQuoteTitle}
            onChange={(e) => setMultiQuoteTitle(e.target.value)}
            placeholder="Заголовок зведеної цитати..."
            className="w-full px-2.5 py-1.5 bg-[#18231C] border border-[rgba(255,255,255,0.08)] rounded-xl text-xs font-semibold text-[#F8FAF8] placeholder-[#64748B] focus:outline-none focus:border-[#F4AF25]"
          />

          <div className="space-y-1 max-h-20 overflow-y-auto">
            {selectedMessagesForQuote.map((m) => (
              <div key={m.id} className="text-[11px] text-[#8EA093] bg-[#18231C] p-1.5 rounded-xl border border-[rgba(255,255,255,0.06)] truncate">
                <span className="font-bold text-[#F4AF25]">{m.senderName}: </span>
                <span>{m.text || m.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Replying-to Banner */}
      {replyingTo && (
        <div className="mb-2 p-2.5 bg-[#141C16] border border-[rgba(255,255,255,0.08)] border-l-4 border-l-[#F4AF25] rounded-2xl space-y-1.5 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Reply className="w-3.5 h-3.5 text-[#F4AF25] shrink-0" strokeWidth={1.75} />
              {replyingTo.quotes && replyingTo.quotes.length > 1 ? (
                <span className="font-bold text-[#F4AF25] text-[11px] truncate">
                  Відповідь на {replyingTo.quotes.length} повідомлень
                </span>
              ) : replyingTo.quoteSelectedText ? (
                <span className="font-bold text-[#F4AF25] text-[11px] truncate">
                  Цитата фрагмента від {replyingTo.senderName}
                </span>
              ) : (
                <span className="font-bold text-[#F4AF25] text-[11px] truncate">
                  Відповідь для {replyingTo.senderName}
                </span>
              )}
            </div>
            <button
              onClick={onCancelReply}
              className="p-1 text-[#8EA093] hover:text-white hover:bg-[#18231C] rounded-lg transition-colors shrink-0"
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
                  className="flex items-center justify-between gap-2 bg-[#18231C] px-2 py-1 rounded-xl border border-[rgba(255,255,255,0.06)] text-[11px]"
                >
                  <div className="min-w-0 flex items-center gap-1.5 truncate">
                    {q.senderAvatar && (
                      <img src={q.senderAvatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
                    )}
                    <span className="font-bold text-[#F4AF25] shrink-0">{q.senderName}:</span>
                    <span className="text-[#8EA093] truncate">{q.text}</span>
                  </div>
                  {onRemoveReplyQuote && (
                    <button
                      onClick={() => onRemoveReplyQuote(q.id)}
                      className="p-0.5 text-[#8EA093] hover:text-red-400 rounded-md shrink-0"
                      title="Прибрати цю цитату"
                    >
                      <X className="w-3 h-3" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : replyingTo.quoteSelectedText ? (
            <div className="bg-[#18231C] p-2 rounded-xl border border-[rgba(255,255,255,0.06)] text-xs">
              <p className="italic text-[#8EA093] leading-relaxed">
                «{replyingTo.quoteSelectedText}»
              </p>
            </div>
          ) : (
            <p className="text-[#8EA093] truncate text-[11px] pl-5">
              {replyingTo.text}
            </p>
          )}
        </div>
      )}

      {/* 3. Editing Message Banner */}
      {editingMessage && (
        <div className="mb-2 p-2.5 bg-[#141C16] border-l-4 border-[#F4AF25] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in border border-[rgba(255,255,255,0.08)]">
          <div className="min-w-0">
            <p className="font-bold text-[#F4AF25] text-[11px]">Редагування повідомлення</p>
            <p className="text-[#8EA093] truncate text-[11px]">{editingMessage.text}</p>
          </div>
          <button
            onClick={onCancelEdit}
            className="p-1 hover:bg-[#18231C] rounded-lg text-[#8EA093] hover:text-white"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* 4. Scheduled Time Badge */}
      {scheduledTime ? (
        <div className="mb-2 p-2 bg-[#141C16] border border-[rgba(255,255,255,0.08)] rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-[#F4AF25] font-semibold text-[11px]">
            <Clock className="w-3.5 h-3.5 text-[#F4AF25]" strokeWidth={1.75} />
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
                className="text-[10px] font-bold text-[#F4AF25] hover:underline px-1"
              >
                Всі відкладені
              </button>
            )}
            <button
              onClick={onClearScheduledTime}
              className="p-1 hover:bg-[#18231C] rounded-lg text-[#8EA093] hover:text-white"
              title="Скасувати таймер"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : scheduledCountInCurrentChat > 0 && onOpenScheduledList ? (
        <div className="mb-2 px-3 py-1.5 bg-[#141C16]/95 border border-[rgba(255,255,255,0.08)] rounded-xl flex items-center justify-between gap-2 text-[11px] backdrop-blur-md animate-in fade-in shadow-md">
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="flex items-center gap-1.5 text-[#F4AF25] hover:text-white font-semibold text-left transition-colors"
          >
            <Clock className="w-3.5 h-3.5 text-[#F4AF25]" strokeWidth={1.75} />
            <span>
              У цьому чаті заплановано <strong className="text-white">{scheduledCountInCurrentChat}</strong> повідомл.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="text-[10px] font-bold text-[#F4AF25] hover:underline"
          >
            Переглянути →
          </button>
        </div>
      ) : null}

      {/* Upload Progress */}
      {upload && (
        <div className="mb-2 px-3 py-2 bg-[#18231C] border border-[#F4AF25]/30 rounded-xl">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11.5px] font-semibold text-[#F8FAF8] truncate">
              {upload.total > 1 && (
                <span className="text-[#F4AF25] tabular-nums">
                  {upload.index} з {upload.total} ·{' '}
                </span>
              )}
              {upload.name}
            </span>
            <span className="text-[11px] font-bold text-[#F4AF25] tabular-nums shrink-0">
              {upload.percent}%
            </span>
          </div>
          <div className="h-1 bg-[#141C16] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#F4AF25] transition-[width] duration-150"
              style={{ width: `${upload.percent}%` }}
            />
          </div>
        </div>
      )}

      {geoBusy && (
        <div className="mb-2 px-3 py-2 bg-[#18231C] border border-[#F4AF25]/30 rounded-xl">
          <span className="text-[11.5px] text-[#F4AF25]">
            Питаю пристрій про місце…
          </span>
        </div>
      )}

      {(uploadError || geoError) && (
        <div className="mb-2 px-3 py-2 bg-red-950/80 border border-red-800/60 rounded-xl flex items-center justify-between gap-2 text-red-200">
          <span className="text-[11.5px]">{uploadError || geoError}</span>
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              setGeoError(null);
            }}
            className="text-red-200 hover:opacity-70 shrink-0"
            aria-label="Сховати помилку"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

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
          {/* Attachments Button (+) */}
          <div className="relative shrink-0">
            <button
              onClick={() => {
                soundFx.playTap();
                setShowAttachMenu((v: boolean) => !v);
              }}
              className={`w-[34px] h-[34px] min-w-0 min-h-0 mb-[5px] border border-[rgba(255,255,255,0.08)] rounded-full transition-colors flex items-center justify-center ${
                showAttachMenu ? 'bg-[#18231C] text-[#F4AF25]' : 'bg-[#141C16] text-[#8EA093] hover:bg-[#18231C] hover:text-white'
              }`}
              title="Додати вкладення"
              aria-label="Додати вкладення"
            >
              <Plus className={`w-[18px] h-[18px] transition-transform ${showAttachMenu ? 'rotate-45 text-[#F4AF25]' : ''}`} strokeWidth={2} />
            </button>

            {showAttachMenu && (
              <>
                <button
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setShowAttachMenu(false)}
                  aria-hidden
                />
                <div className="absolute bottom-12 left-0 bg-[#141C16]/[0.98] backdrop-blur-2xl border border-[rgba(255,255,255,0.1)] rounded-2xl p-1.5 shadow-2xl w-52 z-30 space-y-0.5 animate-in fade-in zoom-in-95 duration-100 select-none text-[#F8FAF8]">
                  <div className="px-2 py-1 flex items-baseline justify-between gap-2 border-b border-[rgba(255,255,255,0.07)]">
                    <span className="text-[11px] font-extrabold text-[#8EA093] uppercase tracking-wide">
                      Вкладення
                    </span>
                    <span className="text-[10px] font-semibold text-[#8EA093] normal-case">
                      {MEDIA_LIMIT_LABEL}
                    </span>
                  </div>
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
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs text-[#F8FAF8] hover:bg-[#18231C] transition-colors"
                    >
                      <Icon className="w-4 h-4 shrink-0 text-[#F4AF25]" strokeWidth={1.75} />
                      <span className="flex-1 font-semibold">{label}</span>
                    </button>
                  ))}

                  <div className="px-2 py-1 border-t border-[rgba(255,255,255,0.07)] mt-1 pt-1">
                    <span className="text-[10px] font-extrabold text-[#8EA093] uppercase tracking-wide">
                      Work OS Віджети
                    </span>
                  </div>

                  {[
                    { icon: Columns, label: 'Kanban Спринт', pick: sendKanbanWidget, color: 'text-amber-400' },
                    { icon: BarChart2, label: 'Голосування', pick: sendVotingWidget, color: 'text-emerald-400' },
                    { icon: Calendar, label: 'Timeline / Gantt', pick: sendTimelineWidget, color: 'text-[#F4AF25]' },
                    { icon: ShieldCheck, label: 'Матриця RACI', pick: sendRACIWidget, color: 'text-purple-400' },
                    { icon: Terminal, label: 'Code Runner', pick: sendCodeRunnerWidget, color: 'text-cyan-400' },
                    { icon: Video, label: 'Async Video сніпет', pick: sendAsyncSnippetWidget, color: 'text-rose-400' },
                    { icon: ImageIcon, label: 'SVG векторний макет', pick: sendSvgPreviewWidget, color: 'text-amber-400' },
                    { icon: Network, label: 'Mermaid Схема', pick: sendMermaidWidget, color: 'text-indigo-400' },
                    { icon: GitCommit, label: 'Git Diff код', pick: sendDiffWidget, color: 'text-emerald-400' },
                  ].map(({ icon: Icon, label, pick, color }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        pick();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs text-[#F8FAF8] hover:bg-[#18231C] transition-colors"
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${color}`} strokeWidth={1.75} />
                      <span className="flex-1 font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Center Input Box / Voice Recording Bar */}
          {isRecordingVoice ? (
            <div className="flex-1 min-w-0 bg-[#241308] border border-[#F4AF25] rounded-[12px] px-3.5 py-[7px] flex items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-xs font-bold text-[#F4AF25]">
                  {Math.floor(recordingSeconds / 60)
                    .toString()
                    .padStart(2, '0')}
                  :
                  {(recordingSeconds % 60).toString().padStart(2, '0')}
                </span>
                <span className="text-[11px] text-[#8EA093] hidden sm:inline">Запис голосу…</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  className="p-1.5 text-[#8EA093] hover:text-red-400 rounded-lg hover:bg-white/10 transition-colors"
                  title="Скасувати запис"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={finishVoiceRecording}
                  className="px-3 py-1 bg-[#F4AF25] text-[#0C110D] rounded-lg text-xs font-bold hover:bg-[#FFB340] flex items-center gap-1 transition-colors"
                  title="Надіслати голосове"
                >
                  <Send className="w-3.5 h-3.5" strokeWidth={2} />
                  <span>Надіслати</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0 bg-[#141C16] border border-[rgba(255,255,255,0.09)] focus-within:border-[#F4AF25]/50 rounded-[12px] pl-3.5 pr-2 py-[7px] flex items-end gap-1.5 transition-colors">
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
                className="flex-1 min-w-0 max-h-[140px] min-h-[28px] py-[5px] bg-transparent text-[13px] text-[#F8FAF8] placeholder-[#64748B] resize-none focus:outline-none select-text leading-[18px]"
              />
            </div>
          )}

          {/* Send / Mic Button */}
          {!isRecordingVoice && (
            canSend ? (
              <button
                onClick={handleSend}
                className="w-[34px] h-[34px] min-w-0 min-h-0 mb-[5px] rounded-full transition-colors shrink-0 flex items-center justify-center bg-[#F4AF25] hover:bg-[#FFB340] text-[#0C110D] font-bold shadow-md active:scale-95"
                title={editingMessage ? 'Зберегти зміни' : 'Надіслати повідомлення'}
              >
                {editingMessage ? (
                  <Check className="w-[18px] h-[18px]" strokeWidth={2.5} />
                ) : (
                  <Send className="w-[17px] h-[17px]" strokeWidth={2.5} />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                className="w-[34px] h-[34px] min-w-0 min-h-0 mb-[5px] rounded-full transition-colors shrink-0 flex items-center justify-center bg-[#141C16] border border-[rgba(255,255,255,0.09)] text-[#8EA093] hover:text-[#F4AF25] hover:border-[#F4AF25]/40"
                title="Записати голосове повідомлення"
              >
                <Mic className="w-[17px] h-[17px]" strokeWidth={1.75} />
              </button>
            )
          )}
        </div>
    </div>
  );
};
