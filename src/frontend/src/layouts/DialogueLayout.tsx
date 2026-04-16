import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { Avatar } from '../components/core/Avatar';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { EASE_PHANTOM } from '../styles/motion';
import { Send, Mic, MicOff } from 'lucide-react';

/**
 * DIALOGUE — Full conversation mode.
 * UI: chat expanded, avatar active.
 * AI: full interaction, response forms.
 * Voice: full duplex STT + TTS.
 */
export default function DialogueLayout() {
  const context = useSystemStore((s) => s.context);
  const { messages, isTyping } = useChatStore();
  const [inputText, setInputText] = useState('');
  const [voiceActive, setVoiceActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    useChatStore.getState().appendMessage({
      id: crypto.randomUUID(),
      session_id: '',
      user_id: '',
      role: 'user',
      content: text,
      response_form: 'text',
      metadata: {
        state_at_time: useSystemStore.getState().state,
        context_snapshot_id: '',
        ai_provider: context?.system.ai_provider ?? 'gemini',
        latency_ms: 0,
        tokens_used: 0,
        tone: '',
        input_method: 'text',
      },
      attachments: [],
      created_at: new Date().toISOString(),
    });

    setInputText('');
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [inputText, context]);

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-deep)' }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <StatusBar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — avatar + context */}
        <motion.div
          className="w-[280px] h-full flex flex-col items-center border-r py-4 px-3 gap-4"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--line-subtle)',
          }}
          initial={{ x: -280 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <Avatar size={140} speaking={isTyping} listening={voiceActive} />

          {/* Context summary */}
          <div className="w-full flex flex-col gap-2 mt-2">
            {context?.body.breathing_bpm != null && (
              <ContextLine label="Breathing" value={`${context.body.breathing_bpm} bpm`} />
            )}
            {context?.body.stress_level != null && (
              <ContextLine
                label="Stress"
                value={`${(context.body.stress_level * 100).toFixed(0)}%`}
                alert={context.body.stress_level > 0.7}
              />
            )}
            {context?.where.place_name && (
              <ContextLine label="Location" value={context.where.place_name} />
            )}
            <ContextLine
              label="AI"
              value={context?.system.ai_provider ?? '—'}
            />
          </div>

          {/* Memory hints */}
          {context?.memory_hints && context.memory_hints.length > 0 && (
            <div className="w-full flex flex-col gap-1 mt-auto">
              <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>
                Memory context
              </span>
              {context.memory_hints.slice(0, 3).map((hint, i) => (
                <span
                  key={i}
                  className="truncate"
                  style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-micro)' }}
                >
                  {hint}
                </span>
              ))}
            </div>
          )}
        </motion.div>

        {/* Chat area */}
        <div className="flex-1 h-full flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  className={`max-w-[80%] p-3 rounded-lg ${
                    msg.role === 'user' ? 'self-end' : 'self-start'
                  }`}
                  style={{
                    background: msg.role === 'user'
                      ? 'var(--surface-glass)'
                      : 'var(--surface-raised)',
                    border: `1px solid ${msg.role === 'user' ? 'var(--line-default)' : 'var(--line-subtle)'}`,
                  }}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <span
                    style={{
                      color: msg.role === 'user' ? 'var(--ink-primary)' : 'var(--accent)',
                      fontSize: 'var(--fs-sm)',
                      lineHeight: 'var(--lh-normal)',
                    }}
                  >
                    {msg.content}
                  </span>
                  <span
                    className="block mt-1 text-right"
                    style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
                  >
                    {new Date(msg.created_at).toLocaleTimeString('uk-UA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Typing indicator */}
            {isTyping && (
              <motion.div
                className="self-start p-3 rounded-lg flex items-center gap-1"
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--line-subtle)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--accent)' }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div
            className="flex items-center gap-2 px-4 py-3 border-t"
            style={{ borderColor: 'var(--line-subtle)', background: 'var(--surface-raised)' }}
          >
            <button
              className="flex items-center justify-center rounded-lg transition-colors"
              style={{
                width: 44,
                height: 44,
                background: voiceActive ? 'var(--accent)' : 'var(--surface-glass)',
                color: voiceActive ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
              }}
              onClick={() => setVoiceActive((v) => !v)}
              title={voiceActive ? 'Stop listening' : 'Start listening'}
            >
              {voiceActive ? <MicOff size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />}
            </button>

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Type a message..."
              className="flex-1 h-[44px] px-3 rounded-lg font-mono outline-none"
              style={{
                background: 'var(--surface-glass)',
                border: '1px solid var(--line-default)',
                color: 'var(--ink-primary)',
                fontSize: 'var(--fs-sm)',
              }}
            />

            <button
              className="flex items-center justify-center rounded-lg transition-opacity"
              style={{
                width: 44,
                height: 44,
                background: inputText.trim() ? 'var(--accent)' : 'var(--surface-glass)',
                color: inputText.trim() ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                opacity: inputText.trim() ? 1 : 0.5,
              }}
              onClick={handleSend}
              disabled={!inputText.trim()}
              title="Send"
            >
              <Send size={20} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ContextLine({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{label}</span>
      <span
        className="font-mono"
        style={{
          color: alert ? 'var(--signal-alert)' : 'var(--ink-secondary)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
