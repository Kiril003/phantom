import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Send, Mic, MicOff, Plus, Trash2 } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useChatStream } from '../../hooks/useChatStream';
import { useSystemStore } from '../../stores/systemStore';
import { EASE_PHANTOM } from '../../styles/motion';
import type { ChatMessage } from '@shared/types';

interface ChatWindowProps {
  /** Hide side panel (session list, history controls). */
  minimalChrome?: boolean;
  /** Show voice button. Defaults to true. */
  showVoice?: boolean;
  /** Invoked when voice button toggles. If omitted, voice state is local-only. */
  onVoiceToggle?: (active: boolean) => void;
  /** Force a placeholder string. */
  placeholder?: string;
  /** Optional wrapper className. */
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
  const [voiceActive, setVoiceActive] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

  // Auto-load session list once
  useEffect(() => {
    if (!minimalChrome) {
      loadSessions();
    }
  }, [minimalChrome, loadSessions]);

  // Auto-scroll on new messages, but only if user is near bottom
  useEffect(() => {
    if (stickyBottomRef.current && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, streaming, isTyping]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 60;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    stickyBottomRef.current = atBottom;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    stickyBottomRef.current = true;
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

  const toggleVoice = useCallback(() => {
    setVoiceActive((v) => {
      const next = !v;
      onVoiceToggle?.(next);
      return next;
    });
  }, [onVoiceToggle]);

  const streamingMessage = useMemo(() => {
    if (!streaming) return null;
    return streamingMessageShape(streaming.id, streaming.content);
  }, [streaming]);

  return (
    <div
      className={`flex h-full w-full min-h-0 ${className}`}
      style={{ background: 'var(--surface-deep)' }}
    >
      {/* Sessions side panel */}
      {!minimalChrome && (
        <aside
          className="w-[220px] h-full flex flex-col shrink-0"
          style={{
            background: 'var(--surface-raised)',
            borderRight: '1px solid var(--line-subtle)',
          }}
        >
          <header
            className="px-3 py-2 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--line-subtle)' }}
          >
            <span
              className="font-mono tracking-wider uppercase flex-1"
              style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
            >
              SESSIONS
            </span>
            <button
              type="button"
              onClick={startNewSession}
              className="flex items-center justify-center rounded"
              style={{
                minWidth: 44,
                minHeight: 44,
                color: 'var(--accent)',
                background: 'var(--surface-glass)',
                border: '1px solid var(--line-subtle)',
              }}
              aria-label="New session"
              title="New session"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto py-1">
            {sessions.length === 0 && (
              <div
                className="px-3 py-6 text-center font-mono tracking-wider"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
              >
                NO SESSIONS YET
              </div>
            )}
            {sessions.map((sess) => {
              const active = sess.id === currentSessionId;
              const preview = sess.summary ?? `Session ${sess.id.slice(0, 8)}`;
              const startedAt = new Date(sess.started_at);
              const dateLabel = startedAt.toLocaleDateString('uk-UA', {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div
                  key={sess.id}
                  className="mx-2 mb-1 rounded-md flex items-start gap-2 cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--accent-glow)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    padding: '6px 8px',
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
                        color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                        fontSize: 'var(--fs-xs)',
                      }}
                    >
                      {preview}
                    </div>
                    <div
                      className="flex items-center gap-2 font-mono"
                      style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
                    >
                      <span>{dateLabel}</span>
                      <span>·</span>
                      <span>{sess.message_count}m</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded flex items-center justify-center"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      color: 'var(--ink-muted)',
                      opacity: active ? 1 : 0.6,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(sess.id);
                    }}
                    aria-label="Delete session"
                    title="Delete session"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0"
        >
          {messages.length === 0 && !streaming && (
            <div
              className="self-center my-auto flex flex-col items-center gap-2"
              style={{ color: 'var(--ink-muted)' }}
            >
              <div
                className="font-mono tracking-wider"
                style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
              >
                {currentSessionId ? 'SESSION LOADED' : 'NEW SESSION'}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)' }}>PHANTOM is listening.</div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg) => (
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
              className="self-start flex items-center gap-1 px-3 py-2 rounded-lg"
              style={{
                background: 'var(--surface-glass)',
                border: '1px solid var(--line-subtle)',
              }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: EASE_PHANTOM as unknown as number[] }}
              aria-label="PHANTOM is thinking"
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="block rounded-full"
                  style={{ width: 6, height: 6, background: 'var(--accent)' }}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </motion.div>
          )}

          <div ref={endRef} />
        </div>

        {error && (
          <div
            className="px-4 py-2 font-mono tracking-wider"
            style={{
              background: 'rgba(255,107,107,.08)',
              borderTop: '1px solid var(--signal-alert)',
              color: 'var(--signal-alert)',
              fontSize: 'var(--fs-micro)',
            }}
          >
            [ CHAT.ERR ] {error}
          </div>
        )}

        <div
          className="flex items-end gap-2 px-3 py-2 shrink-0"
          style={{
            borderTop: '1px solid var(--line-subtle)',
            background: 'var(--surface-raised)',
          }}
        >
          {showVoice && (
            <button
              type="button"
              onClick={toggleVoice}
              className="flex items-center justify-center rounded-md shrink-0 transition-colors"
              style={{
                width: 44,
                height: 44,
                background: voiceActive ? 'var(--accent)' : 'var(--surface-glass)',
                color: voiceActive ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                border: `1px solid ${voiceActive ? 'var(--accent)' : 'var(--line-subtle)'}`,
              }}
              aria-label={voiceActive ? 'Stop listening' : 'Start listening'}
              aria-pressed={voiceActive}
            >
              {voiceActive ? (
                <MicOff size={18} strokeWidth={1.75} />
              ) : (
                <Mic size={18} strokeWidth={1.75} />
              )}
            </button>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 resize-none font-mono outline-none rounded-md"
            style={{
              minHeight: 44,
              maxHeight: 120,
              padding: '12px 14px',
              background: 'var(--surface-glass)',
              color: 'var(--ink-primary)',
              border: '1px solid var(--line-default)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 'var(--lh-normal)',
            }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex items-center justify-center rounded-md shrink-0 transition-opacity"
            style={{
              width: 44,
              height: 44,
              background: input.trim() && !sending ? 'var(--accent)' : 'var(--surface-glass)',
              color: input.trim() && !sending ? 'var(--ink-inverse)' : 'var(--ink-muted)',
              opacity: input.trim() && !sending ? 1 : 0.5,
              border: `1px solid ${input.trim() && !sending ? 'var(--accent)' : 'var(--line-subtle)'}`,
            }}
            aria-label="Send message"
          >
            <Send size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
