import { motion } from 'framer-motion';
import { User, Sparkles, Mic, Hash, Info } from 'lucide-react';
import type { ChatMessage } from '@shared/types';
import { ResponseRenderer } from './ResponseRenderer';

interface MessageBubbleProps {
  message: ChatMessage;
  streaming?: boolean;
  compact?: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function MessageBubble({ message, streaming = false, compact = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const meta = message.metadata ?? {};
  const inputMethod = (meta as { input_method?: string }).input_method;
  const provider = (meta as { ai_provider?: string }).ai_provider;
  const latency = (meta as { latency_ms?: number }).latency_ms;
  const tokens = (meta as { tokens_used?: number }).tokens_used;

  if (isSystem) {
    return (
      <motion.div
        className="self-center flex items-center gap-2 px-3 py-1 rounded-full glass-subtle"
        style={{
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          letterSpacing: 'var(--tracking-widest)',
          textTransform: 'uppercase',
        }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Info size={11} strokeWidth={1.5} />
        <span>{message.content}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`flex items-start gap-3 ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}
      style={{ maxWidth: '82%' }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Avatar */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 32,
          height: 32,
          borderRadius: 12,
          background: isUser
            ? 'var(--glass-subtle)'
            : 'color-mix(in srgb, var(--accent) 14%, transparent)',
          border: `1px solid ${isUser ? 'var(--glass-border)' : 'color-mix(in srgb, var(--accent) 40%, transparent)'}`,
          color: isUser ? 'var(--ink-secondary)' : 'var(--accent)',
          boxShadow: isUser ? 'none' : '0 0 14px var(--accent-glow)',
        }}
      >
        {isUser ? <User size={15} strokeWidth={1.75} /> : <Sparkles size={15} strokeWidth={1.75} />}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        {/* Bubble */}
        <div
          className={`relative ${isUser ? 'glass-subtle' : 'glass-panel'}`}
          style={{
            padding: '12px 16px',
            borderRadius: 18,
            borderTopLeftRadius: isUser ? 18 : 6,
            borderTopRightRadius: isUser ? 6 : 18,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-base)',
            color: 'var(--ink-primary)',
            lineHeight: 'var(--lh-normal)',
            boxShadow: isUser
              ? 'inset 0 1px 0 var(--glass-highlight)'
              : '0 4px 20px -4px color-mix(in srgb, var(--accent) 10%, transparent), inset 0 1px 0 var(--glass-highlight)',
          }}
        >
          <ResponseRenderer message={message} streaming={streaming} />
          {streaming && (
            <motion.span
              className="inline-block align-middle ml-1"
              style={{
                width: 8,
                height: 16,
                background: 'var(--accent)',
                borderRadius: 2,
              }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
              aria-hidden
            />
          )}
        </div>

        {/* Meta line */}
        {!compact && (
          <div
            className={`flex items-center gap-2 ${isUser ? 'justify-end flex-row-reverse' : 'justify-start'}`}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-wide)',
            }}
          >
            <span>{formatTime(message.created_at)}</span>
            {inputMethod === 'voice' && (
              <span className="inline-flex items-center gap-0.5">
                <Mic size={10} strokeWidth={1.75} />
                voice
              </span>
            )}
            {!isUser && provider && (
              <span className="inline-flex items-center gap-1 capitalize">
                <span
                  aria-hidden
                  className="block rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background:
                      provider === 'gemini' ? 'var(--signal-info)' :
                      provider === 'ollama' ? 'var(--signal-ok)' :
                      'var(--ink-muted)',
                  }}
                />
                {provider}
              </span>
            )}
            {!isUser && latency != null && latency > 0 && <span>{latency}ms</span>}
            {!isUser && tokens != null && tokens > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Hash size={9} strokeWidth={1.75} />
                {tokens}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
