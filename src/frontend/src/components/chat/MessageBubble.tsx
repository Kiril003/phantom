import { motion } from 'framer-motion';
import { User, Bot, Mic, Hash, Activity } from 'lucide-react';
import type { ChatMessage } from '@shared/types';
import { ResponseRenderer } from './ResponseRenderer';
import { EASE_PHANTOM } from '../../styles/motion';

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

function ProviderDot({ provider }: { provider: string | undefined }) {
  if (!provider) return null;
  const color = provider === 'gemini' ? 'var(--signal-info)' : provider === 'ollama' ? 'var(--signal-ok)' : 'var(--ink-muted)';
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 5, height: 5, background: color }}
      title={`AI: ${provider}`}
    />
  );
}

export function MessageBubble({ message, streaming = false, compact = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const meta = message.metadata ?? {};
  const inputMethod = (meta as { input_method?: string }).input_method;
  const provider = (meta as { ai_provider?: string }).ai_provider;
  const latency = (meta as { latency_ms?: number }).latency_ms;
  const tokens = (meta as { tokens_used?: number }).tokens_used;
  const tone = (meta as { tone?: string }).tone;

  if (isSystem) {
    return (
      <motion.div
        className="self-center flex items-center gap-2 px-3 py-1 rounded-full font-mono tracking-wider"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line-subtle)',
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-micro)',
        }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <Activity size={10} strokeWidth={1.5} />
        <span>{message.content}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`flex items-start gap-2 ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}
      style={{ maxWidth: '84%' }}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: EASE_PHANTOM as unknown as number[] }}
    >
      {/* Avatar */}
      <div
        className="flex items-center justify-center rounded-md shrink-0"
        style={{
          width: 28,
          height: 28,
          background: isUser ? 'var(--surface-raised)' : 'var(--accent-glow)',
          color: isUser ? 'var(--ink-secondary)' : 'var(--accent)',
          border: `1px solid ${isUser ? 'var(--line-subtle)' : 'var(--accent)'}`,
        }}
      >
        {isUser ? <User size={14} strokeWidth={1.5} /> : <Bot size={14} strokeWidth={1.5} />}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        {/* Bubble */}
        <div
          className={`rounded-lg p-3 ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}`}
          style={{
            background: isUser ? 'var(--surface-raised)' : 'var(--surface-glass)',
            border: `1px solid ${isUser ? 'var(--line-subtle)' : 'var(--line-default)'}`,
          }}
        >
          <ResponseRenderer message={message} streaming={streaming} />
          {streaming && (
            <motion.span
              className="inline-block ml-1"
              style={{
                width: 8,
                height: 14,
                background: 'var(--accent)',
                verticalAlign: 'text-bottom',
              }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
              aria-hidden
            />
          )}
        </div>

        {/* Meta row */}
        {!compact && (
          <div
            className={`flex items-center gap-2 font-mono ${isUser ? 'justify-end flex-row-reverse' : 'justify-start'}`}
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
          >
            <span>{formatTime(message.created_at)}</span>
            {inputMethod === 'voice' && (
              <span className="flex items-center gap-0.5">
                <Mic size={10} strokeWidth={1.5} />
                VOICE
              </span>
            )}
            {!isUser && provider && (
              <span className="flex items-center gap-1">
                <ProviderDot provider={provider} />
                {provider.toUpperCase()}
              </span>
            )}
            {!isUser && latency != null && latency > 0 && (
              <span>{latency}ms</span>
            )}
            {!isUser && tokens != null && tokens > 0 && (
              <span className="flex items-center gap-0.5">
                <Hash size={9} strokeWidth={1.5} />
                {tokens}
              </span>
            )}
            {!isUser && tone && (
              <span className="truncate" style={{ maxWidth: 200 }} title={tone}>
                {tone}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
