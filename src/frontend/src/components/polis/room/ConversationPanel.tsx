/** Розмова — the mission IS a chat: operator ⇄ PHANTOM ⇄ system events,
 * gate decisions inline, steering commands change the live graph. */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolisStore } from '../../../stores/polisStore';
import { MarkdownResponse } from '../../chat/MarkdownResponse';

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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {chat.length === 0 && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
            Це командний канал місії. Питай про стан, міняй курс словами:
            «додай крок…», «постав на паузу», «покажи що зробив архітектор».
          </p>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m, i) => (
            <motion.div
              key={`${i}-${m.ts ?? ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={
                m.role === 'operator'
                  ? 'self-end max-w-[78%]'
                  : m.role === 'system'
                    ? 'self-center max-w-[90%]'
                    : 'self-start max-w-[85%]'
              }
            >
              {m.role === 'system' ? (
                <p
                  className="font-mono text-center px-3 py-1 rounded-full"
                  style={{
                    fontSize: 'var(--fs-micro)',
                    color: m.text.startsWith('✗') ? 'var(--signal-alert)' : 'var(--ink-muted)',
                    background: 'var(--glass-subtle)',
                  }}
                >
                  {m.text}
                </p>
              ) : (
                <div
                  className="rounded-2xl px-4 py-2.5"
                  style={{
                    background:
                      m.role === 'operator'
                        ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                        : 'var(--glass-card)',
                    border: '1px solid var(--glass-border)',
                  }}
                >
                  <div style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-primary)' }}>
                    <MarkdownResponse content={m.text} />
                  </div>
                  {m.applied && m.applied.length > 0 && (
                    <p
                      className="font-mono mt-1"
                      style={{ fontSize: 'var(--fs-micro)', color: 'var(--accent)' }}
                    >
                      ⚙ застосовано: {m.applied.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          ))}
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
          <p
            className="self-start font-mono animate-pulse px-1"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
          >
            PHANTOM осмислює стан міста…
          </p>
        )}
      </div>

      <footer className="px-3 pb-3 pt-1 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={
            missionId ? 'Наказ, питання або зміна курсу…' : 'Обери місію зліва'
          }
          disabled={!missionId}
          className="flex-1 min-h-[48px] rounded-xl px-4 outline-none"
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
          className="min-w-[48px] min-h-[48px] rounded-xl active:scale-[0.95] disabled:opacity-30"
          style={{ background: 'var(--accent)', color: 'var(--ink-inverse)' }}
          aria-label="надіслати"
          data-testid="mission-chat-send"
        >
          ↑
        </button>
      </footer>
    </div>
  );
}
