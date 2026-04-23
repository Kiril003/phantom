import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Send,
  Mic,
  MicOff,
  Plus,
  Trash2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useChatStream } from '../../hooks/useChatStream';
import { useSystemStore } from '../../stores/systemStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useSettingsStore } from '../../stores/settingsStore';
import { voiceApi } from '../../services/voiceApi';
import type { ChatMessage } from '@shared/types';

interface ChatWindowProps {
  minimalChrome?: boolean;
  showVoice?: boolean;
  onVoiceToggle?: (active: boolean) => void;
  placeholder?: string;
  className?: string;
}

function streamingMessageShape(id: string, content: string): ChatMessage {
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
      ai_provider: 'gemini',
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
  placeholder = 'Message PHANTOM…',
  className = '',
}: ChatWindowProps) {
  useChatStream();

  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const isTyping = useChatStore((s) => s.isTyping);
  const sending = useChatStore((s) => s.sending);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const error = useChatStore((s) => s.error);

  const { sendMessage, startNewSession, loadSessions, openSession, deleteSession } = useChatStore(
    (s) => ({
      sendMessage: s.sendMessage,
      startNewSession: s.startNewSession,
      loadSessions: s.loadSessions,
      openSession: s.openSession,
      deleteSession: s.deleteSession,
    })
  );
  const systemState = useSystemStore((s) => s.state);

  const [input, setInput] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const lastUserInputMethodRef = useRef<'text' | 'voice' | 'encoder'>('text');
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
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
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ttsEnabled) return;
    if (lastUserInputMethodRef.current !== 'voice') return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (!last.content.trim()) return;
    if (last.id === lastSpokenMessageIdRef.current) return;
    lastSpokenMessageIdRef.current = last.id;

    let cancelled = false;
    let audioEl: HTMLAudioElement | null = null;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const { blob } = await voiceApi.synthesize(last.content, {
          voice: ttsVoice || undefined,
          speed: ttsSpeed,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        audioEl = new Audio(objectUrl);
        await audioEl.play();
      } catch (err) {
        // Non-fatal — TTS failures shouldn't block the chat flow.
        // eslint-disable-next-line no-console
        console.warn('[voice] TTS playback failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messages, ttsEnabled, ttsVoice, ttsSpeed]);

  const streamingMessage = useMemo(() => {
    if (!streaming) return null;
    return streamingMessageShape(streaming.id, streaming.content);
  }, [streaming]);

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

  return (
    <div
      className={`flex h-full w-full min-h-0 ${className}`}
      style={{ background: 'transparent' }}
    >
      {!minimalChrome && (
        <aside
          className="w-[220px] h-full flex flex-col shrink-0 glass-panel"
          style={{
            borderTop: 'none',
            borderBottom: 'none',
            borderLeft: 'none',
          }}
        >
          <header
            className="px-4 flex items-center gap-2 shrink-0"
            style={{
              height: 44,
              borderBottom: '1px solid var(--glass-border)',
            }}
          >
            <span
              className="flex-1 uppercase"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-micro)',
                color: 'var(--ink-secondary)',
                letterSpacing: 'var(--tracking-widest)',
                fontWeight: 500,
              }}
            >
              Sessions
            </span>
            <button
              type="button"
              onClick={startNewSession}
              className="flex items-center justify-center transition-all active:scale-95"
              style={{
                minWidth: 44,
                minHeight: 44,
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                color: 'var(--accent)',
                boxShadow: '0 0 12px var(--accent-glow)',
              }}
              aria-label="New session"
              title="New session"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto py-2 px-2">
            {sessions.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-12 gap-2 text-center"
                style={{ color: 'var(--ink-muted)' }}
              >
                <MessageCircle size={20} strokeWidth={1.5} />
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-xs)',
                  }}
                >
                  No sessions yet
                </span>
                <span
                  className="italic"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--ink-faint)',
                  }}
                >
                  PHANTOM is listening.
                </span>
              </div>
            )}
            {sessions.map((sess) => {
              const active = sess.id === currentSessionId;
              const preview = sess.summary ?? `Session · ${sess.id.slice(0, 6)}`;
              const startedAt = new Date(sess.started_at);
              const dateLabel = startedAt.toLocaleDateString('uk-UA', {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div
                  key={sess.id}
                  className="mb-1 flex items-center gap-2 cursor-pointer transition-all"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 12,
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                      : 'transparent',
                    border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent'}`,
                    minHeight: 44,
                  }}
                  onClick={() => openSession(sess.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openSession(sess.id);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="truncate"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-xs)',
                        color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                        fontWeight: active ? 500 : 400,
                      }}
                    >
                      {preview}
                    </div>
                    <div
                      className="flex items-center gap-1.5"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-micro)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      <span>{dateLabel}</span>
                      <span>·</span>
                      <span>{sess.message_count} msg</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center justify-center transition-colors active:scale-95"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      width: 26,
                      height: 26,
                      color: 'var(--ink-muted)',
                      opacity: active ? 1 : 0.6,
                      background: 'transparent',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(sess.id);
                    }}
                    aria-label="Delete session"
                  >
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4 min-h-0"
        >
          {!hasMessages && !isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="self-center my-auto flex flex-col items-center gap-3 text-center"
              style={{ maxWidth: 400 }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
                  color: 'var(--accent)',
                  boxShadow: '0 0 18px var(--accent-glow)',
                }}
              >
                <Sparkles size={20} strokeWidth={1.75} />
              </div>
              <p
                className="text-gradient"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-lg)',
                  fontWeight: 600,
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {currentSessionId ? 'Session loaded' : 'New conversation'}
              </p>
              <p
                className="italic"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--ink-secondary)',
                  lineHeight: 'var(--lh-relaxed)',
                }}
              >
                Ask anything. PHANTOM reads context, remembers long-term, and speaks in your tone.
              </p>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {orderedMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </AnimatePresence>

          {streamingMessage && (
            <MessageBubble
              key={streamingMessage.id}
              message={streamingMessage}
              streaming
              compact
            />
          )}

          {isTyping && !streaming && (
            <motion.div
              className="self-start glass-panel flex items-center gap-2 px-4 py-2 rounded-full"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              aria-label="PHANTOM is thinking"
              style={{
                color: 'var(--ink-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wide)',
              }}
            >
              <Sparkles size={12} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
              <span>Thinking</span>
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

        {/* Input bar — glass card rounded-full */}
        <div className="px-5 pb-4 pt-2 shrink-0">
          <div
            className="glass-card flex items-center gap-2 pl-2 pr-2"
            style={{
              borderRadius: 9999,
              height: 52,
            }}
          >
            {showVoice && (
              <button
                type="button"
                onClick={toggleVoice}
                className="flex items-center justify-center shrink-0 transition-all active:scale-95"
                style={{
                  width: 40,
                  height: 40,
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 9999,
                  background: voiceActive
                    ? 'var(--accent)'
                    : 'var(--glass-subtle)',
                  color: voiceActive ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                  border: voiceActive
                    ? '1px solid var(--accent)'
                    : '1px solid var(--glass-border)',
                  boxShadow: voiceActive
                    ? '0 0 16px var(--accent-glow)'
                    : 'none',
                }}
                aria-label={voiceActive ? 'Stop listening' : 'Start listening'}
                aria-pressed={voiceActive}
              >
                {voiceActive ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}
              </button>
            )}

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              aria-label="Chat input"
              className="flex-1 resize-none outline-none bg-transparent"
              style={{
                minHeight: 40,
                maxHeight: 120,
                padding: '10px 12px',
                color: 'var(--ink-primary)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-base)',
                lineHeight: 'var(--lh-normal)',
                border: 'none',
              }}
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex items-center justify-center shrink-0 transition-all active:scale-95"
              style={{
                width: 40,
                height: 40,
                minWidth: 44,
                minHeight: 44,
                borderRadius: 9999,
                background:
                  input.trim() && !sending ? 'var(--accent)' : 'var(--glass-subtle)',
                color:
                  input.trim() && !sending ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                border:
                  input.trim() && !sending
                    ? '1px solid var(--accent)'
                    : '1px solid var(--glass-border)',
                boxShadow:
                  input.trim() && !sending ? '0 0 16px var(--accent-glow)' : 'none',
                opacity: input.trim() && !sending ? 1 : 0.6,
              }}
              aria-label="Send message"
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatErrorBanner({ message }: { message: string }) {
  const isProviderError = message.includes('AI провайдер недоступний');
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
      {isProviderError && (
        <a
          href="/settings"
          className="underline underline-offset-2"
          style={{
            color: 'var(--signal-alert)',
            minHeight: 44,
            padding: '10px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            fontWeight: 500,
          }}
        >
          Open Settings
        </a>
      )}
    </div>
  );
}
