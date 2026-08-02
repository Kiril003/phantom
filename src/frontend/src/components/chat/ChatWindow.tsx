import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Mic,
  Plus,
  Sparkles,
  Menu,
  Compass,
  Settings,
  Shield,
} from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { type AttachSelection } from './AttachDrawer';
import { ChatSidebar } from './ChatSidebar';
import { ChatInputRail } from './ChatInputRail';
import { useChatStore } from '../../stores/chatStore';
import { useChatStream } from '../../hooks/useChatStream';
import { useSystemStore } from '../../stores/systemStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useSettingsStore } from '../../stores/settingsStore';
import { voiceApi } from '../../services/voiceApi';
import {
  voiceAlwaysOnDuck,
  voiceAlwaysOnUnduck,
} from '../../hooks/useVoiceAlwaysOn';
import type { ChatMessage } from '@shared/types';
import { wsClient } from '../../services/websocket';
import { useTranslation } from '../../i18n/useTranslation';

interface ChatWindowProps {
  minimalChrome?: boolean;
  showVoice?: boolean;
  onVoiceToggle?: (active: boolean) => void;
  placeholder?: string;
  className?: string;
  /** Слот присутності в заголовку: стан PHANTOM і живі показники. */
  presence?: ReactNode;
}

function streamingMessageShape(
  id: string,
  content: string,
  provider: string | null,
): ChatMessage {
  return {
    id,
    session_id: '',
    user_id: 'assistant',
    role: 'assistant',
    content,
    response_form: 'text',
    metadata: {
      state_at_time: 'DIALOGUE' as ChatMessage['metadata']['state_at_time'],
      context_snapshot_id: '',
      ai_provider: (provider ??
        'gemini') as ChatMessage['metadata']['ai_provider'],
      latency_ms: 0,
      tokens_used: 0,
      tone: '',
      input_method: 'text',
    },
    attachments: [],
    created_at: new Date().toISOString(),
  };
}

export function ChatWindow({
  minimalChrome = false,
  showVoice = true,
  onVoiceToggle,
  placeholder,
  className = '',
  presence,
}: ChatWindowProps) {
  useChatStream();

  const { t } = useTranslation();

  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const isTyping = useChatStore((s) => s.isTyping);
  const sending = useChatStore((s) => s.sending);
  // Phase 13b — live partial transcript from the always-on mic.
  // Rendered as a "ghost" user bubble so the user sees their words
  // appear in real time while still speaking.
  const userPreview = useChatStore((s) => s.userPreview);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const error = useChatStore((s) => s.error);

  const { sendMessage, startNewSession, loadSessions, openSession, deleteSession, updateSession } = useChatStore(
    (s) => ({
      sendMessage: s.sendMessage,
      startNewSession: s.startNewSession,
      loadSessions: s.loadSessions,
      openSession: s.openSession,
      deleteSession: s.deleteSession,
      updateSession: s.updateSession,
    })
  );
  const systemState = useSystemStore((s) => s.state);

  // Phase 27-e — sessions sidebar default-closed regardless of chrome.
  // Was `!minimalChrome` so the panel opened by default and ate 260px
  // of width on the live 1024×600 device, masking every density cut
  // inside the chat surface. The menu toggle in the header (and the
  // sticky one in the input rail) is the operator's way to open it.
  const [sessionsOpen, setSessionsOpen] = useState(false);


  const [input, setInput] = useState('');
  const [activeThoughts, setActiveThoughts] = useState<Array<{ text: string; kind: string; id: string }>>([]);

  // Subscribe to monologue stream
  useEffect(() => {
    const off = wsClient.on('inner_monologue.stream', (msg) => {
      const data = msg.data as any;
      let text = '';
      if (data.monologue?.what_i_plan) text = data.monologue.what_i_plan;
      else if (data.monologue?.note) text = data.monologue.note;
      else if (data.monologue?.decision) text = data.monologue.decision;
      else if (data.monologue?.summary) text = data.monologue.summary;

      if (text) {
        setActiveThoughts((prev) => {
          const id = Math.random().toString(36).substring(2);
          const next = [...prev, { text, kind: data.kind, id }].slice(-3); // Keep last 3 thoughts
          return next;
        });
      }
    });
    return off;
  }, []);

  // Clear thoughts when generation completes
  useEffect(() => {
    if (!isTyping && !sending && !streaming) {
      setActiveThoughts([]);
    }
  }, [isTyping, sending, streaming]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  // Day-5 input-pill redesign D5-DSGN3: track focus + textarea ref so
  // we can drive autosize + a focus-within ambient glow on the rail.
  const [inputFocused, setInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Day-4 W-3: AttachDrawer open-state + pending attachment chips.
  // The chips are local UI state; Day-5 wires them through to the
  // backend send_message payload as typed attachments.
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    AttachSelection[]
  >([]);
  const lastUserInputMethodRef = useRef<'text' | 'voice' | 'encoder'>('text');
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  // Day-4 W-3: ModelCard echo reads from the live context snapshot so
  // the user sees which provider+engine the next turn will route through.
  const systemContext = useSystemStore((s) => s.context);
  const activeProvider = systemContext?.system?.ai_provider ?? null;
  const activeStt = systemContext?.system?.stt_engine ?? null;

  const recorder = useVoiceRecorder();
  const pendingVoiceActivation = useUIStore((s) => s.pendingVoiceActivation);
  const setPendingVoiceActivation = useUIStore((s) => s.setPendingVoiceActivation);
  const voiceActive = recorder.state === 'recording' || recorder.state === 'requesting';
  const ttsEnabled = useSettingsStore((s) => Boolean(s.values.voice_tts_enabled ?? true));
  const ttsVoice = useSettingsStore((s) => String(s.values.voice_tts_voice ?? ''));
  const ttsSpeed = useSettingsStore((s) =>
    typeof s.values.voice_tts_speed === 'number' ? (s.values.voice_tts_speed as number) : 1.0
  );

  // Route the mic amplitude into the system store so the Orb component
  // (and anything else) can pulse in sync without threading props.
  const setVoiceAmplitude = useSystemStore((s) => s.setVoiceAmplitude);
  useEffect(() => {
    setVoiceAmplitude?.(recorder.amplitude);
  }, [recorder.amplitude, setVoiceAmplitude]);

  useEffect(() => {
    if (!minimalChrome) loadSessions();
  }, [minimalChrome, loadSessions]);

  useEffect(() => {
    if (stickyBottomRef.current && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, streaming, isTyping]);

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const observer = new ResizeObserver(() => {
      if (stickyBottomRef.current && endRef.current) {
        endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [messages, streaming, isTyping]);

  // Day-5 — textarea autosize. Reset to single-line height first
  // (otherwise scrollHeight stays inflated after a delete) then
  // expand to content up to the 120px max from the inline style.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
  }, [input]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 60;
    stickyBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    stickyBottomRef.current = true;
    lastUserInputMethodRef.current = 'text';
    sendMessage(text, 'text', systemState);
  }, [input, sending, sendMessage, systemState]);

  const handleQuickPrompt = useCallback(
    (text: string) => {
      if (sending) return;
      stickyBottomRef.current = true;
      lastUserInputMethodRef.current = 'encoder';
      sendMessage(text, 'encoder', systemState);
    },
    [sending, sendMessage, systemState]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleWidgetAction = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      const timerBtn = target.closest('[data-timer-action]');
      if (timerBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = timerBtn.getAttribute('data-timer-action');
        const timerId = timerBtn.getAttribute('data-timer-id');
        if (action === 'cancel') sendMessage(`Скасуй таймер ${timerId}`, 'encoder');
        else if (action === 'pause-toggle') sendMessage(`Призупини або віднови таймер ${timerId}`, 'encoder');
        else if (action === 'add-1m') sendMessage(`Додай 1 хвилину до таймера ${timerId}`, 'encoder');
        return;
      }

      const alarmBtn = target.closest('[data-alarm-action]');
      if (alarmBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = alarmBtn.getAttribute('data-alarm-action');
        const alarmId = alarmBtn.getAttribute('data-alarm-id');
        if (action === 'cancel') sendMessage(`Видали будильник ${alarmId}`, 'encoder');
        else if (action === 'edit') sendMessage(`Зміни будильник ${alarmId}`, 'encoder');
        else if (action === 'save') sendMessage(`Збережи будильник ${alarmId}`, 'encoder');
        return;
      }

      const calendarBtn = target.closest('[data-calendar-action]');
      if (calendarBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = calendarBtn.getAttribute('data-calendar-action');
        if (action === 'add') sendMessage(`Створи нову подію в календарі`, 'encoder');
        return;
      }
      
      const filesBtn = target.closest('[data-files-action]');
      if (filesBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = filesBtn.getAttribute('data-files-action');
        const path = filesBtn.getAttribute('data-path');
        if (action === 'open') sendMessage(`Відкрий файл ${path}`, 'encoder');
        return;
      }
    },
    [sendMessage]
  );

  const toggleVoice = useCallback(async () => {
    // Idle → start recording.
    if (recorder.state === 'idle' || recorder.state === 'error') {
      setVoiceError(null);
      // Signal intent synchronously so UI toggles / listeners react before
      // getUserMedia resolves (and so a jsdom-style env without mediaDevices
      // still observes the toggle).
      onVoiceToggle?.(true);
      try {
        await recorder.start();
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Mic unavailable');
        onVoiceToggle?.(false);
      }
      return;
    }
    // Recording → stop, transcribe, send.
    if (recorder.state === 'recording' || recorder.state === 'requesting') {
      onVoiceToggle?.(false);
      setTranscribing(true);
      const blob = await recorder.stop();
      try {
        if (!blob) {
          setVoiceError('Empty recording — try again.');
          return;
        }
        const result = await voiceApi.transcribe(blob, 'clip.webm');
        if (!result.text.trim()) {
          setVoiceError('No speech detected.');
          return;
        }
        stickyBottomRef.current = true;
        lastUserInputMethodRef.current = 'voice';
        sendMessage(result.text, 'voice', systemState);
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Transcription failed');
      } finally {
        setTranscribing(false);
      }
    }
  }, [recorder, onVoiceToggle, sendMessage, systemState]);

  // Phase 9.5 — consume pendingVoiceActivation set by FloatingToolbar Voice
  // button. Clear the flag BEFORE awaiting toggleVoice so a re-render in
  // between cannot re-fire. Only triggers when idle so we never stop an
  // already-running recording by accident.
  useEffect(() => {
    if (!pendingVoiceActivation) return;
    setPendingVoiceActivation(false);
    if (recorder.state === 'idle' || recorder.state === 'error') {
      void toggleVoice();
    }
  }, [pendingVoiceActivation, setPendingVoiceActivation, recorder.state, toggleVoice]);

  // Play TTS for any newly-arrived assistant reply when the previous user
  // turn came from voice input. Keeps playback scoped to voice sessions —
  // we don't want the assistant talking over the operator's text chats.
  // Phase 12.2: also duck the always-on mic across playback. Without
  // this the backend Silero VAD picks up the assistant's own audio and
  // self-feedbacks (it transcribes PHANTOM speaking, treats it as a new
  // user turn, replies again).
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ttsEnabled) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (!last.content.trim()) return;
    if (last.id === lastSpokenMessageIdRef.current) return;

    // Gate: assistant must be replying to a voice user turn. Tap-to-talk
    // updates `lastUserInputMethodRef` synchronously; always-on flows
    // arrive via VoiceAlwaysOnGate (different component) so we also
    // walk back through messages to consult the prior user turn's
    // input_method metadata.
    let priorUserVoice = lastUserInputMethodRef.current === 'voice';
    if (!priorUserVoice) {
      for (let i = messages.length - 2; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'user') {
          priorUserVoice = m.metadata?.input_method === 'voice';
          break;
        }
      }
    }
    if (!priorUserVoice) return;
    lastSpokenMessageIdRef.current = last.id;

    let cancelled = false;
    let ducked = false;
    let audioEl: HTMLAudioElement | null = null;
    let objectUrl: string | null = null;
    const releaseDuck = () => {
      if (!ducked) return;
      ducked = false;
      voiceAlwaysOnUnduck();
    };
    const onEnded = () => releaseDuck();
    const onError = () => releaseDuck();
    (async () => {
      try {
        const { blob } = await voiceApi.synthesize(last.content, {
          voice: ttsVoice || undefined,
          speed: ttsSpeed,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        audioEl = new Audio(objectUrl);
        audioEl.addEventListener('ended', onEnded);
        audioEl.addEventListener('error', onError);
        // Mute backend before audio.play() — the goal is that no PCM
        // captured during the playback window reaches the orchestrator.
        voiceAlwaysOnDuck();
        ducked = true;
        await audioEl.play();
      } catch (err) {
        releaseDuck();
        // Non-fatal — TTS failures shouldn't block the chat flow.
        // eslint-disable-next-line no-console
        console.warn('[voice] TTS playback failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (audioEl) {
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('error', onError);
        audioEl.pause();
        audioEl.src = '';
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      releaseDuck();
    };
  }, [messages, ttsEnabled, ttsVoice, ttsSpeed]);

  const streamingMessage = useMemo(() => {
    if (!streaming) return null;
    return streamingMessageShape(streaming.id, streaming.content, activeProvider);
  }, [streaming, activeProvider]);

  // Defensive render-time sort. The chatStore preserves insertion order when
  // the HTTP reply lands *after* the WS broadcast of the same turn, but a
  // brief sidebar session switch or a dropped WS reconnect can still scramble
  // the array. Sort by created_at ASC with a user-before-assistant tiebreaker
  // so a user turn and its reply sharing a 1-second wall clock rendering
  // don't swap positions.
  const orderedMessages = useMemo(() => {
    const rolePriority = (r: string): number =>
      r === 'system' ? 0 : r === 'user' ? 1 : 2;
    return [...messages].sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return rolePriority(a.role) - rolePriority(b.role);
    });
  }, [messages]);

  const hasMessages = orderedMessages.length > 0 || !!streamingMessage;

  // ── Transcript virtualization ──────────────────────────────────────────────
  // Only the committed messages are windowed. The streaming bubble, the voice
  // ghost, and the typing indicator stay as plain siblings pinned below the
  // spacer — they're always at the tail and on-screen, so windowing them would
  // add re-measure churn as the streamed text grows for no memory win. Row
  // heights vary wildly (markdown, code, 3D scenes), so measureElement drives
  // the dynamic sizing rather than a fixed estimate.
  const virtualizer = useVirtualizer({
    count: orderedMessages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => orderedMessages[index]?.id ?? index,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Windowing needs a measurable viewport. Default true so a real browser
  // windows from the first paint (no all-rows mount, no flash); an effect flips
  // it off only where the scroll container reports zero height — jsdom/SSR or a
  // panel mounted while hidden — and there the full transcript renders instead
  // of an empty spacer. It's re-checked on every resize so a panel that becomes
  // visible starts windowing.
  const [canWindow, setCanWindow] = useState(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setCanWindow(el.clientHeight > 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Enter-animation gate. A windowed row unmounts/remounts as it scrolls, so a
  // naive `initial` would replay the enter animation every time an old message
  // scrolls back into view. We animate a message exactly once — the first time
  // it's seen — and render every later (re)mount at rest. The seen-set is
  // reseeded synchronously when the session changes (and on first render), so
  // loading a session shows its history at rest (matching the old
  // AnimatePresence `initial={false}`) instead of a burst of 50 animations;
  // only messages that arrive *within* the open session animate in. Reseeding
  // during render — guarded by the session ref — is the derived-from-props
  // pattern and is StrictMode-safe (both render passes compute the same set).
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenSessionRef = useRef<string | null | undefined>(undefined);
  if (seenSessionRef.current !== currentSessionId) {
    seenSessionRef.current = currentSessionId;
    seenIdsRef.current = new Set(messages.map((m) => m.id));
  }
  useEffect(() => {
    for (const m of messages) seenIdsRef.current.add(m.id);
  }, [messages]);

  return (
    <div
      className={`flex h-full w-full min-h-0 ${className}`}
      style={{ background: 'transparent' }}
    >
      <AnimatePresence>
        {sessionsOpen && (
        <ChatSidebar
          sessionsOpen={sessionsOpen}
          setSessionsOpen={setSessionsOpen}
          sessions={sessions}
          currentSessionId={currentSessionId}
          startNewSession={startNewSession}
          openSession={openSession}
          deleteSession={deleteSession}
          updateSession={updateSession}
        />
      )}
      </AnimatePresence>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {/* Phase 10 — Chat Header with Menu toggle and New Session action.
            Addresses operator request for '3-х ліній' button and quick
            session management. Header sits inside the glass shell. */}
        <header
          className="px-4 flex items-center justify-between shrink-0"
          style={{
            // Phase 27-e — 52→48; menu/NEW buttons stay at their
            // touch-target sizes (32×32 visible / 28 minHeight) and
            // sit in a slightly tighter strip.
            height: 48,
            background: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid var(--glass-border)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!sessionsOpen && (
              <button
                type="button"
                onClick={() => setSessionsOpen(true)}
                className="flex items-center justify-center transition-all active:scale-95 shrink-0"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink-secondary)',
                }}
                title={t('chat.sessions.open')}
                aria-label={t('chat.sessions.open')}
              >
                <Menu size={18} />
              </button>
            )}
            <span
              className="truncate"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink-primary)',
                letterSpacing: '-0.01em',
                maxWidth: 240,
              }}
              title={
                sessions.find((s) => s.id === currentSessionId)?.summary ||
                t('chat.header.untitled')
              }
            >
              {sessions.find((s) => s.id === currentSessionId)?.summary ||
                t('chat.header.untitled')}
            </span>
          </div>

          {/* Присутність жила окремою 44-піксельною смугою над карткою і
              дублювала провайдера з верхнього рядка. На 600 px це задорого
              за два слова, тож вона переїхала в цей заголовок. */}
          {presence && (
            <div className="flex items-center min-w-0 mx-3" data-testid="presence-strip">
              {presence}
            </div>
          )}

          <button
            type="button"
            onClick={() => startNewSession()}
            className="flex items-center gap-1.5 px-3 rounded-xl transition-all active:scale-95 hover:bg-accent/10 shrink-0"
            style={{
              border:
                '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              color: 'var(--accent)',
              minHeight: 44,
            }}
            aria-label={t('chat.sessions.new')}
          >
            <Plus size={14} strokeWidth={2} />
            <span className="micro-label" style={{ fontWeight: 700 }}>
              {t('chat.sessions.newShort')}
            </span>
          </button>
        </header>

        <div
          ref={listRef}
          onScroll={handleScroll}
          onClick={handleWidgetAction}
          // No vertical padding: the virtualized list must start at the scroll
          // container's top (offset 0) so the windowing math needs no
          // scrollMargin. Top breathing room is baked into the first row; the
          // bottom pad sits below the spacer where it can't shift offsets.
          className="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-3 min-h-0"
        >
          {/* Phase 27-d — empty state was a 3-stack hero (44px halo
              icon + display-lg title + serif italic blurb) eating
              ~120px on a 600px display. The italic blurb is marketing
              copy; the input placeholder ("Message PHANTOM…") already
              communicates affordance. Now: 32px halo + title only,
              ~60px footprint. */}
          {!hasMessages && !isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="self-center my-auto flex flex-col items-center gap-3 text-center"
              style={{ maxWidth: 520 }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 11,
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
                  color: 'var(--accent)',
                  boxShadow: '0 0 14px var(--accent-glow)',
                }}
              >
                  <Sparkles size={16} strokeWidth={1.75} />
              </div>
              <p
                className="text-gradient"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-base)',
                  fontWeight: 600,
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {currentSessionId ? t('chat.empty.loaded') : t('chat.empty.new')}
              </p>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--ink-muted)',
                  lineHeight: 1.45,
                  maxWidth: 420,
                }}
              >
                {t('chat.empty.body')}
              </div>
              <div
                className="flex flex-wrap justify-center gap-2"
                style={{ marginTop: 2 }}
                aria-label={t('chat.quick.aria')}
              >
                {[
                  {
                    id: 'plan',
                    icon: <Compass size={14} strokeWidth={1.75} />,
                    label: t('chat.quick.plan.label'),
                    prompt: t('chat.quick.plan.prompt'),
                  },
                  {
                    id: 'risks',
                    icon: <Shield size={14} strokeWidth={1.75} />,
                    label: t('chat.quick.risks.label'),
                    prompt: t('chat.quick.risks.prompt'),
                  },
                  {
                    id: 'settings',
                    icon: <Settings size={14} strokeWidth={1.75} />,
                    label: t('chat.quick.settings.label'),
                    prompt: t('chat.quick.settings.prompt'),
                  },
                ].map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleQuickPrompt(action.prompt)}
                    disabled={sending}
                    className="inline-flex items-center gap-2 active:scale-95 transition-all"
                    style={{
                      minHeight: 44,
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: 'var(--glass-subtle)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--ink-secondary)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 600,
                      boxShadow: 'inset 0 1px 0 var(--glass-highlight)',
                      opacity: sending ? 0.55 : 1,
                    }}
                    title={action.prompt}
                  >
                    <span style={{ color: 'var(--accent)' }}>{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {orderedMessages.length > 0 &&
            (canWindow ? (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                  flexShrink: 0,
                }}
              >
                {virtualItems.map((vi) => {
                  const msg = orderedMessages[vi.index];
                  if (!msg) return null;
                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      className="flex flex-col"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vi.start}px)`,
                        // Inter-row gap (the container's gap-3 can't reach the
                        // absolutely-positioned rows) + top breathing room on
                        // the first row, both measured so offsets stay exact.
                        paddingTop: vi.index === 0 ? 12 : 0,
                        paddingBottom: 12,
                      }}
                    >
                      <MessageBubble
                        message={msg}
                        animateIn={!seenIdsRef.current.has(msg.id)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              // No measurable viewport (jsdom/SSR/hidden panel): render the whole
              // transcript un-windowed so it's never blank where layout is
              // unavailable. Same row wrapper + spacing as the windowed path.
              orderedMessages.map((msg, i) => (
                <div
                  key={msg.id}
                  className="flex flex-col"
                  style={{ paddingTop: i === 0 ? 12 : 0, paddingBottom: 12 }}
                >
                  <MessageBubble
                    message={msg}
                    animateIn={!seenIdsRef.current.has(msg.id)}
                  />
                </div>
              ))
            ))}

          {streamingMessage && (
            <MessageBubble
              key={streamingMessage.id}
              message={streamingMessage}
              streaming
              compact
            />
          )}

          {userPreview && !sending && (
            // Phase 13b — live ghost bubble for the user's still-in-progress
            // utterance. Subtle (italic, dimmed cyan, animated dot) to make
            // clear it is not yet committed. Disappears on `sending` so the
            // committed user message renders without a duplicate.
            <motion.div
              className="self-end max-w-[80%] rounded-2xl px-4 py-2 italic border"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              aria-label={t('chat.transcribing')}
              style={{
                color: 'var(--accent-cyan-soft, rgba(72, 220, 252, 0.7))',
                background: 'rgba(72, 220, 252, 0.06)',
                borderColor: 'rgba(72, 220, 252, 0.18)',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--fs-sm)',
                letterSpacing: 'var(--tracking-normal)',
              }}
            >
              {userPreview}
              <motion.span
                aria-hidden
                className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: 'rgba(72, 220, 252, 0.7)' }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            </motion.div>
          )}

          {isTyping && !streaming && (
            <motion.div
              className="self-start glass-panel flex items-center gap-2 px-4 py-2 rounded-full"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              aria-label={t('chat.thinking.aria')}
              style={{
                color: 'var(--ink-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wide)',
              }}
            >
              <Sparkles size={12} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
              <span>{t('chat.thinking')}</span>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                  style={{ color: 'var(--accent)' }}
                >
                  ·
                </motion.span>
              ))}
            </motion.div>
          )}

          <div ref={endRef} />
        </div>

        {error && (
          <ChatErrorBanner message={error} />
        )}

        {voiceError && (
          <div
            className="mx-6 mb-2 px-3 py-2 rounded-xl flex items-center gap-2"
            style={{
              background: 'color-mix(in srgb, var(--signal-warn) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--signal-warn) 40%, transparent)',
              color: 'var(--signal-warn)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            <Mic size={12} strokeWidth={1.75} />
            <span className="flex-1">{voiceError}</span>
          </div>
        )}

        {transcribing && (
          <div
            className="mx-6 mb-2 px-3 py-2 rounded-xl flex items-center gap-2"
            style={{
              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-xs)',
            }}
            aria-live="polite"
          >
            <Sparkles size={12} strokeWidth={1.75} />
            <span className="flex-1">Transcribing…</span>
          </div>
        )}

        {/* Input bar — glass card rounded-full. Day-4 W-3 wraps it
            in a relative container so the AttachDrawer can absolute-
            position above the input rail. ModelCard echo + pending-
            attachment chips render above the rail too.
            Phase 27-e — outer pb-3→pb-2; ModelCard now lazy. */}
        <ChatInputRail
          input={input}
          setInput={setInput}
          inputFocused={inputFocused}
          setInputFocused={setInputFocused}
          attachOpen={attachOpen}
          setAttachOpen={setAttachOpen}
          pendingAttachments={pendingAttachments}
          setPendingAttachments={setPendingAttachments}
          textareaRef={textareaRef}
          handleKeyDown={handleKeyDown}
          handleSend={handleSend}
          sending={sending}
          placeholder={placeholder}
          setSessionsOpen={setSessionsOpen}
          showVoice={showVoice}
          voiceActive={voiceActive}
          toggleVoice={toggleVoice}
          minimalChrome={minimalChrome}
          activeThoughts={activeThoughts}
          activeProvider={activeProvider}
          activeStt={activeStt}
        />
      </div>
    </div>
  );
}

/**
 * Тут висіло посилання «Open Settings» — англійське, та ще й у продукті,
 * де власник нічого не налаштовує. Тепер банер пропонує єдину дію, яка
 * справді допомагає: повторити надсилання.
 */
function ChatErrorBanner({ message }: { message: string }) {
  const retryLastSend = useChatStore((s) => s.retryLastSend);
  const canRetry = useChatStore((s) => s.lastFailedSend != null);
  return (
    <div
      className="mx-6 mb-3 px-3 py-2 rounded-xl flex items-center gap-2"
      style={{
        background: 'color-mix(in srgb, var(--signal-alert) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--signal-alert) 40%, transparent)',
        color: 'var(--signal-alert)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <Sparkles size={12} strokeWidth={1.75} />
      <span className="flex-1">{message}</span>
      {canRetry && (
        <button
          type="button"
          onClick={() => void retryLastSend()}
          className="underline underline-offset-2 active:scale-95"
          style={{
            color: 'var(--signal-alert)',
            minHeight: 44,
            padding: '10px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Повторити
        </button>
      )}
    </div>
  );
}
