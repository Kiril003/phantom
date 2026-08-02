import { RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Mic, MicOff, Send, X, Menu, Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { AttachDrawer, type AttachSelection } from './AttachDrawer';
import { ModelCard } from './ModelCard';

/** Види думок приходять службовими ключами; у стрічці має бути слово. */
const THOUGHT_UA: Record<string, string> = {
  plan: 'план',
  reflection: 'роздум',
  proactive: 'ініціатива',
  emotion_shift: 'настрій',
};

interface ChatInputRailProps {
  input: string;
  setInput: (v: string) => void;
  inputFocused: boolean;
  setInputFocused: (v: boolean) => void;
  attachOpen: boolean;
  setAttachOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  pendingAttachments: AttachSelection[];
  setPendingAttachments: (v: AttachSelection[] | ((prev: AttachSelection[]) => AttachSelection[])) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: () => void;
  sending: boolean;
  placeholder?: string;
  setSessionsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  showVoice: boolean;
  voiceActive: boolean;
  toggleVoice: () => void;
  minimalChrome: boolean;
  activeThoughts: Array<{ text: string; kind: string; id: string }>;
  activeProvider: string | null;
  activeStt: string | null;
}

export function ChatInputRail({
  input,
  setInput,
  inputFocused,
  setInputFocused,
  attachOpen,
  setAttachOpen,
  pendingAttachments,
  setPendingAttachments,
  textareaRef,
  handleKeyDown,
  handleSend,
  sending,
  placeholder,
  setSessionsOpen,
  showVoice,
  voiceActive,
  toggleVoice,
  minimalChrome,
  activeThoughts,
  activeProvider,
  activeStt,
}: ChatInputRailProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-auto px-4 pb-4 shrink-0 flex flex-col items-center">
      <div className="w-full max-w-[800px] flex flex-col relative">
        <AnimatePresence>
          {activeThoughts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              /* Тло bg-white/[0.02] і текст neutral-400 писались під темну
                 тему: на кремовому лишався сам заголовок, а думки під ним
                 не читались. */
              className="px-4 py-2 mb-2 rounded-xl glass-subtle flex flex-col gap-1.5 overflow-hidden"
              style={{ border: '1px solid var(--line-subtle)' }}
            >
              <div
                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-bold pb-1"
                style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--line-subtle)' }}
              >
                <Sparkles size={10} className="animate-pulse" style={{ color: 'var(--accent)' }} />
                <span>{t('chat.thoughtStream')}</span>
              </div>
              <div className="flex flex-col gap-1 text-[11px] leading-tight">
                {activeThoughts.map((thought, idx) => {
                  const colors: Record<string, string> = {
                    plan: '#06b6d4',      // cyan
                    reflection: '#a3a3a3', // gray
                    proactive: '#f59e0b',  // amber
                    emotion_shift: '#10b981', // green
                  };
                  const isLast = idx === activeThoughts.length - 1;
                  return (
                    <motion.div
                      key={thought.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: isLast ? 1 : 0.45, x: 0 }}
                      className="flex items-start gap-2"
                    >
                      <span
                        className="font-bold text-[9px] uppercase shrink-0 mt-0.5"
                        style={{ color: colors[thought.kind] || 'var(--accent)' }}
                      >
                        {THOUGHT_UA[thought.kind] ?? thought.kind}:
                      </span>
                      <span
                        className="font-serif italic"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        “{thought.text}”
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!minimalChrome && (inputFocused || input.trim().length > 0 || sending) && (
          <div className="px-2 pb-1">
            <ModelCard provider={activeProvider} sttEngine={activeStt} />
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <div
            className="flex flex-wrap gap-1 px-3 pb-2"
            data-testid="attach-chip-strip"
          >
            {pendingAttachments.map((att, idx) => (
              <span
                key={`${att.kind}-${idx}`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--ink-secondary)',
                  letterSpacing: 'var(--tracking-wide)',
                }}
                data-attach-kind={att.kind}
              >
                <span className="capitalize">{att.kind}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingAttachments((curr) =>
                      curr.filter((_, i) => i !== idx)
                    )
                  }
                  className="flex items-center justify-center"
                  style={{
                    width: 16,
                    height: 16,
                    minWidth: 44,
                    minHeight: 44,
                    borderRadius: 9999,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink-muted)',
                  }}
                  aria-label={`Remove ${att.kind} attachment`}
                >
                  <X size={10} strokeWidth={1.75} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <AttachDrawer
            open={attachOpen}
            onClose={() => setAttachOpen(false)}
            onSelect={(sel) =>
              setPendingAttachments((curr) => [...curr, sel])
            }
          />
          <div
            className="glass-card flex items-end gap-2 pl-2 pr-2 transition-all"
            style={{
              borderRadius: inputFocused ? 22 : 9999,
              minHeight: 44,
              paddingTop: 4,
              paddingBottom: 4,
              borderColor: inputFocused
                ? 'color-mix(in srgb, var(--accent) 65%, transparent)'
                : 'var(--glass-border)',
              boxShadow: inputFocused
                ? '0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent), 0 12px 36px -12px var(--accent-glow), inset 0 1px 0 var(--glass-highlight)'
                : '0 14px 36px -10px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2), inset 0 1px 0 var(--glass-highlight)',
            }}
            data-focus={inputFocused ? '1' : '0'}
          >
            <button
              type="button"
              onClick={() => setSessionsOpen((v) => !v)}
              className="flex items-center justify-center shrink-0 transition-all active:scale-95 self-end"
              style={{
                width: 40,
                height: 40,
                minWidth: 44,
                minHeight: 44,
                borderRadius: 9999,
                background: 'var(--glass-subtle)',
                color: 'var(--ink-secondary)',
                border: '1px solid var(--glass-border)',
              }}
              aria-label={t('chat.sessions.toggle')}
            >
              <Menu size={16} strokeWidth={1.75} />
            </button>

            {showVoice && (
              <button
                type="button"
                onClick={toggleVoice}
                className="flex items-center justify-center shrink-0 transition-all active:scale-95 self-end"
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
                aria-label={voiceActive ? 'Зупинити запис' : 'Говорити'}
                aria-pressed={voiceActive}
              >
                {voiceActive ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              disabled={sending}
              className="flex items-center justify-center shrink-0 transition-all active:scale-95 self-end"
              style={{
                width: 40,
                height: 40,
                minWidth: 44,
                minHeight: 44,
                borderRadius: 9999,
                background: attachOpen
                  ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                  : 'var(--glass-subtle)',
                color: attachOpen ? 'var(--accent)' : 'var(--ink-secondary)',
                border: attachOpen
                  ? '1px solid var(--accent)'
                  : '1px solid var(--glass-border)',
                opacity: sending ? 0.5 : 1,
              }}
              aria-label="Долучити файл"
              aria-expanded={attachOpen}
              data-testid="chat-attach-button"
            >
              <Plus size={16} strokeWidth={2} />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={sending ? t('chat.input.sending') : (placeholder || t('chat.input.placeholder'))}
              rows={1}
              aria-label="Поле повідомлення"
              className="flex-1 resize-none outline-none bg-transparent"
              style={{
                minHeight: 36,
                maxHeight: 120,
                padding: '8px 10px',
                color: 'var(--ink-primary)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-base)',
                lineHeight: 'var(--lh-normal)',
                border: 'none',
                opacity: sending ? 0.72 : 1,
              }}
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex items-center justify-center shrink-0 self-end active:scale-95"
              style={{
                width: 40,
                height: 40,
                minWidth: 44,
                minHeight: 44,
                borderRadius: 9999,
                background:
                  input.trim() && !sending
                    ? 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--ink-inverse)))'
                    : 'var(--glass-subtle)',
                color:
                  input.trim() && !sending ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                border:
                  input.trim() && !sending
                    ? '1px solid color-mix(in srgb, var(--accent) 70%, transparent)'
                    : '1px solid var(--glass-border)',
                boxShadow:
                  input.trim() && !sending
                    ? '0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent), 0 0 22px var(--accent-glow)'
                    : 'none',
                opacity: input.trim() && !sending ? 1 : 0.6,
                /* Без зменшення: scale(0.94) робив кнопку 41px і рвав
                   правило 44×44 у неактивному стані. */
                transition:
                  'background 200ms, color 200ms, box-shadow 220ms, border-color 200ms, opacity 200ms, transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              aria-label="Надіслати"
              data-active={input.trim() && !sending ? '1' : '0'}
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
