/** Розмова — the mission IS a chat: operator ⇄ PHANTOM ⇄ system events,
 * gate decisions inline, steering commands change the live graph. */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { usePolisStore } from '../../../stores/polisStore';
import { MarkdownResponse } from '../../chat/MarkdownResponse';

function SystemLine({ text }: { text: string }) {
  const failed = text.startsWith('✗');
  const forged = text.startsWith('⚒');
  const web = text.startsWith('🌐');
  const tint = failed
    ? 'var(--signal-alert)'
    : forged || web
      ? 'var(--primary)'
      : 'var(--signal-ok)';
  // strip the leading emoji glyph — we render a clean dot instead
  const body = text.replace(/^[✓✗⚒🌐]\s*/u, '');
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="self-center flex items-center gap-2 px-3 py-1 rounded-full max-w-[92%]"
      style={{ background: `color-mix(in srgb, ${tint} 10%, transparent)` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: tint }}
      />
      <span
        className="truncate"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}
      >
        {body}
      </span>
    </motion.div>
  );
}

export function ConversationPanel() {
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const chat = usePolisStore((s) =>
    missionId ? (s.chats[missionId] ?? []) : [],
  );
  const gates = usePolisStore((s) =>
    s.gates.filter((g) => g.mission_id === missionId),
  );
  const sendChat = usePolisStore((s) => s.sendChat);
  const resolveGate = usePolisStore((s) => s.resolveGate);
  const chatBusy = usePolisStore((s) => s.chatBusy);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, gates.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void sendChat(text);
  };

  return (
    <div className="h-full flex flex-col" data-testid="conversation-panel">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2"
      >
        {chat.length === 0 && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
            Це командний канал місії. Питай про стан, міняй курс словами:
            «додай крок…», «постав на паузу», «покажи що зробив архітектор».
          </p>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m, i) =>
            m.role === 'system' ? (
              <SystemLine key={`${i}-${m.ts ?? ''}`} text={m.text} />
            ) : m.role === 'operator' ? (
              <motion.div
                key={`${i}-${m.ts ?? ''}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-end max-w-[78%]"
              >
                <div
                  className="rounded-2xl rounded-br-md px-4 py-2.5"
                  style={{
                    background: 'linear-gradient(135deg, var(--primary), var(--primary-deep))',
                    color: 'var(--ink-inverse)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: 'var(--fs-base)',
                    lineHeight: 'var(--lh-normal)',
                  }}
                >
                  {m.text}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`${i}-${m.ts ?? ''}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-start max-w-[86%] flex gap-2.5"
              >
                <div
                  className="w-8 h-8 rounded-full shrink-0 mt-0.5"
                  style={{
                    background: 'var(--accent-radial)',
                    boxShadow: '0 0 14px var(--accent-glow)',
                  }}
                />
                <div className="min-w-0">
                  <span
                    className="block mb-0.5 font-semibold"
                    style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', letterSpacing: '0.02em' }}
                  >
                    PHANTOM
                  </span>
                  <div
                    className="rounded-2xl rounded-tl-md px-4 py-2.5"
                    style={{
                      background: 'var(--glass-card)',
                      backdropFilter: 'blur(16px)',
                      WebkitBackdropFilter: 'blur(16px)',
                      border: '1px solid var(--glass-border)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-primary)' }}>
                      <MarkdownResponse content={m.text} />
                    </div>
                    {m.applied && m.applied.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.applied.map((a, k) => (
                          <span
                            key={k}
                            className="px-2 py-0.5 rounded-md font-mono"
                            style={{
                              fontSize: 'var(--fs-micro)',
                              color: 'var(--accent)',
                              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                            }}
                          >
                            ⚙ {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ),
          )}
        </AnimatePresence>

        {gates.map((g) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="self-center w-[92%] rounded-2xl p-3"
            style={{
              background: 'var(--glass-card)',
              border: '1px solid color-mix(in srgb, var(--primary) 45%, transparent)',
            }}
            data-testid={`chat-gate-${g.id}`}
          >
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--primary)' }}>
              🔔 {g.question}
            </p>
            {g.payload_preview && (
              <p
                className="mt-1 line-clamp-3"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
              >
                {g.payload_preview}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void resolveGate(g.id, true)}
                className="flex-1 min-h-[44px] rounded-lg active:scale-[0.97]"
                style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
              >
                Схвалити
              </button>
              <button
                onClick={() => void resolveGate(g.id, false)}
                className="flex-1 min-h-[44px] rounded-lg active:scale-[0.97]"
                style={{ background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)', color: 'var(--signal-alert)' }}
              >
                Відхилити
              </button>
            </div>
          </motion.div>
        ))}

        {chatBusy && (
          <div className="self-start flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full shrink-0 animate-pulse"
              style={{ background: 'var(--accent-radial)', boxShadow: '0 0 14px var(--accent-glow)' }}
            />
            <div className="flex gap-1 items-center py-3">
              {[0, 1, 2].map((k) => (
                <span
                  key={k}
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: 'var(--accent)', animationDelay: `${k * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="px-3 pb-3 pt-2 flex gap-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={
            missionId ? 'Наказ, питання або зміна курсу…' : 'Обери місію зліва'
          }
          disabled={!missionId}
          className="flex-1 min-h-[48px] rounded-2xl px-4 outline-none focus:ring-2"
          style={{
            background: 'var(--glass-subtle)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ink-primary)',
            fontSize: 'var(--fs-base)',
          }}
          data-testid="mission-chat-input"
        />
        <button
          onClick={submit}
          disabled={!missionId || !draft.trim()}
          className="min-w-[48px] min-h-[48px] rounded-2xl flex items-center justify-center active:scale-[0.95] disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--primary-deep))',
            color: 'var(--ink-inverse)',
            boxShadow: draft.trim() ? 'var(--shadow-glow)' : 'none',
          }}
          aria-label="надіслати"
          data-testid="mission-chat-send"
        >
          <SendHorizontal size={20} strokeWidth={2} />
        </button>
      </footer>
    </div>
  );
}
