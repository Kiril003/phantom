import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { User, Sparkles, Mic, Hash, Info, Copy, Check } from 'lucide-react';
import type { ChatMessage } from '@shared/types';
import { ResponseRenderer } from './ResponseRenderer';
import { ChatScene } from './scenes';
import { getPhantomTransition } from '../../styles/motion';

interface MessageBubbleProps {
  message: ChatMessage;
  streaming?: boolean;
  compact?: boolean;
  // When the transcript is virtualized, off-screen rows unmount and re-mount as
  // they scroll back into view. Passing `animateIn={false}` renders the bubble
  // at rest (initial={false}) so an already-seen message doesn't replay its
  // enter animation on every scroll. Defaults to true — the enter animation for
  // a genuinely new arrival, and every non-virtualized caller, is unchanged.
  animateIn?: boolean;
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

function getHormoneGlowClass(hormones?: { cortisol: number; dopamine: number; oxytocin: number }): string {
  if (!hormones) return '';
  const { cortisol, dopamine, oxytocin } = hormones;
  const maxVal = Math.max(cortisol, dopamine, oxytocin);
  if (maxVal < 0.3) return ''; // too low to emit a visual aura
  if (maxVal === cortisol && cortisol > 0.4) return 'glow-cortisol';
  if (maxVal === dopamine && dopamine > 0.45) return 'glow-dopamine';
  if (maxVal === oxytocin && oxytocin > 0.45) return 'glow-oxytocin';
  return '';
}

export function MessageBubble({ message, streaming = false, compact = false, animateIn = true }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const meta = message.metadata ?? {};
  const inputMethod = (meta as { input_method?: string }).input_method;
  const provider = (meta as { ai_provider?: string }).ai_provider;
  const latency = (meta as { latency_ms?: number }).latency_ms;
  const tokens = (meta as { tokens_used?: number }).tokens_used;
  const [showHormones, setShowHormones] = useState(false);

  // Day-5 D5-DSGN5 — copy-to-clipboard. Touch-device-friendly: tap
  // toggles to a "Copied" state for ~1.4s then resets. We copy the
  // raw `content` string; rich scenes still get a plain-text dump
  // through their own data fields downstream (good enough for now).
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text =
      typeof message.content === 'string' ? message.content : String(message.content ?? '');
    if (!text) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).catch(() => {
        /* clipboard API guarded; nothing to do */
      });
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [message.content]);

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
        initial={animateIn ? { opacity: 0, y: 4 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={getPhantomTransition('ghostPreview')}
      >
        <Info size={11} strokeWidth={1.5} />
        <span>{message.content}</span>
      </motion.div>
    );
  }

  // Full-bleed surfaces (an arbitrary artifact widget) are not text:
  // they must escape the 82%-capped padded chat bubble or they render
  // squeezed into a phone-width column. Render them on the full chat
  // surface, sized for the 1024×600 device.
  const sceneKind = (message.scene as { kind?: string } | undefined)?.kind;
  if (message.scene && sceneKind === 'artifact') {
    return (
      <motion.div
        data-testid="scene-breakout"
        className="self-stretch w-full"
        style={{ maxWidth: 1024 }}
        initial={animateIn ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={getPhantomTransition('bubbleEnter')}
      >
        <ChatScene scene={message.scene} />
        {!compact && (
          <div
            className="flex items-center gap-2 justify-start mt-1"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-wide)',
            }}
          >
            <span>{formatTime(message.created_at)}</span>
            {provider && <span className="capitalize">{provider}</span>}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      data-testid="message-bubble-root"
      className={`flex items-start gap-3 ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}
      style={{ maxWidth: '82%' }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={getPhantomTransition('bubbleEnter')}
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

      <div className="flex flex-col gap-1 min-w-0 group">
        {/* Bubble */}
        <div
          className={`relative ${isUser ? 'glass-subtle' : 'glass-panel'} ${!isUser ? getHormoneGlowClass((meta as any).hormones) : ''}`}
          style={{
            padding: '12px 16px',
            borderRadius: 18,
            borderTopLeftRadius: isUser ? 18 : 6,
            borderTopRightRadius: isUser ? 6 : 18,
            // Day-5 D5-DSGN5 — user bubbles get a subtle accent tint
            // on the trailing edge so the side-of-conversation reads
            // immediately even at a glance. Assistant keeps the
            // standard glass-panel + accent-glow halo.
            background: isUser
              ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--glass-subtle)), var(--glass-subtle))'
              : undefined,
            borderColor: isUser
              ? 'color-mix(in srgb, var(--accent) 22%, var(--glass-border))'
              : undefined,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-base)',
            color: 'var(--ink-primary)',
            lineHeight: 'var(--lh-normal)',
            boxShadow: isUser
              ? 'inset 0 1px 0 var(--glass-highlight), 0 6px 18px -8px color-mix(in srgb, var(--accent) 14%, transparent)'
              : '0 4px 20px -4px color-mix(in srgb, var(--accent) 10%, transparent), inset 0 1px 0 var(--glass-highlight)',
          }}
        >
          {/* Day-5 D5-DSGN5 — copy button. Sits just inside the bubble
              corner opposite the avatar; appears on hover for desktop
              and is always tappable on touch (44x44 hit area). */}
          {!streaming && message.content && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? 'Copied' : 'Copy message'}
              data-testid="message-copy-button"
              data-copied={copied ? '1' : '0'}
              className="absolute flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 active:scale-95"
              style={{
                top: -6,
                [isUser ? 'left' : 'right']: -6,
                width: 28,
                height: 28,
                minWidth: 28,
                minHeight: 28,
                borderRadius: 9999,
                background: copied
                  ? 'color-mix(in srgb, var(--signal-ok) 18%, transparent)'
                  : 'var(--glass-elevated)',
                border: copied
                  ? '1px solid color-mix(in srgb, var(--signal-ok) 60%, transparent)'
                  : '1px solid var(--glass-border)',
                color: copied ? 'var(--signal-ok)' : 'var(--ink-secondary)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 4px 12px -4px rgba(0,0,0,0.45)',
              }}
            >
              {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
            </button>
          )}
          {/*
            Day-4 W-2: when the message carries a typed `scene` envelope,
            the ChatScene composer takes over from ResponseRenderer. Per
            ADR-CS-002 §60 back-compat invariant, messages WITHOUT a scene
            still render byte-identical to e12188f via ResponseRenderer.
          */}
          {message.scene ? (
            <ChatScene scene={message.scene} />
          ) : (
            <ResponseRenderer message={message} streaming={streaming} />
          )}
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
            {!isUser && (meta as any).hormones && (
              <div className="relative inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setShowHormones(!showHormones)}
                  onMouseEnter={() => setShowHormones(true)}
                  onMouseLeave={() => setShowHormones(false)}
                  className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors shrink-0"
                  style={{ minWidth: 0, minHeight: 0, height: 16 }}
                  title="Ендокринний відбиток"
                >
                  <span
                    className="block w-1 h-3 rounded-full"
                    style={{
                      background: 'var(--coral)',
                      opacity: 0.3 + ((meta as any).hormones.cortisol ?? 0) * 0.7,
                      boxShadow: ((meta as any).hormones.cortisol ?? 0) > 0.5 ? '0 0 4px var(--coral)' : 'none',
                    }}
                  />
                  <span
                    className="block w-1 h-3 rounded-full"
                    style={{
                      background: 'var(--primary)',
                      opacity: 0.3 + ((meta as any).hormones.dopamine ?? 0) * 0.7,
                      boxShadow: ((meta as any).hormones.dopamine ?? 0) > 0.5 ? '0 0 4px var(--primary)' : 'none',
                    }}
                  />
                  <span
                    className="block w-1 h-3 rounded-full"
                    style={{
                      background: 'var(--warmth)',
                      opacity: 0.3 + ((meta as any).hormones.oxytocin ?? 0) * 0.7,
                      boxShadow: ((meta as any).hormones.oxytocin ?? 0) > 0.5 ? '0 0 4px var(--warmth)' : 'none',
                    }}
                  />
                </button>
                <AnimatePresence>
                  {showHormones && (
                    <motion.div
                      className="absolute bottom-5 left-0 z-30 flex flex-col gap-1 p-2 rounded-lg border bg-black/90 border-white/[0.08] backdrop-blur text-[10px] text-neutral-300 pointer-events-none"
                      style={{ width: 140 }}
                      initial={{ opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className="font-bold border-b border-white/[0.06] pb-1 mb-1 text-white uppercase tracking-wider text-[9px]">
                        Хімія Синтезу
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Кортизол (стрес):</span>
                        <span className="font-bold" style={{ color: 'var(--coral-soft)' }}>{Math.round(((meta as any).hormones.cortisol ?? 0) * 100)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Дофамін (драйв):</span>
                        <span className="font-bold" style={{ color: 'var(--primary)' }}>{Math.round(((meta as any).hormones.dopamine ?? 0) * 100)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Окситоцин (довіра):</span>
                        <span className="font-bold" style={{ color: 'var(--warmth)' }}>{Math.round(((meta as any).hormones.oxytocin ?? 0) * 100)}%</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {/* Phase 27-e — only surface latency when it's actually
                noteworthy (>100ms). Green-path responses run sub-100
                and the chip was just chrome on every assistant row. */}
            {/* «4322ms» — машинний формат. Секунди читаються з першого разу. */}
            {!isUser && latency != null && latency > 100 && (
              <span>
                {latency < 1000
                  ? `${latency} мс`
                  : `${(latency / 1000).toFixed(1).replace('.', ',')} с`}
              </span>
            )}
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
