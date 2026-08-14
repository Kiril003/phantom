/** Хід місії — хребет розділу. Наказ угорі закріплений, під ним один злитий
 * потік: твої вказівки, відповіді Фантома, події вузлів, народжені файли.
 * Кожен запис прив'язаний до вузла, тому наведення підсвічує його у плані —
 * саме цим «я написав завдання» зшито з «воно розгорнулось». */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SendHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { usePolisStore } from '../../../stores/polisStore';
import { MarkdownResponse } from '../../chat/MarkdownResponse';
import { buildThread, type ThreadEntry } from './missionView';

const EVENT_VAR: Record<string, string> = {
  ok: '--signal-ok',
  fail: '--signal-alert',
  forge: '--primary',
  note: '--ink-muted',
};

function Brief({ text, pipeline }: { text: string; pipeline: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 150;
  return (
    <div
      className="shrink-0 px-4 py-2.5"
      style={{ borderBottom: '1px solid var(--glass-border)' }}
      data-testid="mission-brief"
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="font-mono shrink-0"
          style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-faint)', letterSpacing: 'var(--tracking-wide)' }}
        >
          НАКАЗ
        </span>
        <span className="font-mono truncate" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-faint)' }}>
          {pipeline}
        </span>
        <div className="flex-1" />
        {long && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 flex items-center gap-1"
            style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)', minHeight: 22 }}
          >
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>
      <p
        className={open ? '' : 'line-clamp-2'}
        style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-normal)' }}
      >
        {text}
      </p>
    </div>
  );
}

/** Подія вузла: крапка кольору стану, текст, і файли окремими фішками. */
function EventRow({
  e, hot, onHover, onPick, onOpenFile,
}: {
  e: ThreadEntry;
  hot: boolean;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
  onOpenFile: (name: string) => void;
}) {
  const tint = `var(${EVENT_VAR[e.kind] ?? '--ink-muted'})`;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="self-stretch rounded-xl px-2.5 py-1.5"
      style={{
        background: hot ? 'var(--glass-subtle)' : 'transparent',
        border: `1px solid ${hot ? 'var(--glass-border)' : 'transparent'}`,
        cursor: e.nodeId ? 'pointer' : 'default',
      }}
      onMouseEnter={() => onHover(e.nodeId)}
      onMouseLeave={() => onHover(null)}
      onClick={() => e.nodeId && onPick(e.nodeId)}
      data-testid="thread-event"
    >
      <div className="flex items-start gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]"
          style={{ background: tint, boxShadow: `0 0 6px ${tint}` }}
        />
        <span
          className="min-w-0"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-normal)' }}
        >
          {e.text}
        </span>
      </div>
      {e.files.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 ml-3.5">
          {e.files.slice(0, 6).map((f) => (
            <button
              key={f}
              onClick={(ev) => { ev.stopPropagation(); onOpenFile(f); }}
              className="px-1.5 py-0.5 rounded-md font-mono active:scale-[0.97]"
              style={{
                fontSize: 'var(--fs-micro)',
                color: 'var(--primary)',
                background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
              }}
            >
              {f.split('/').pop()}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function ThreadPanel({
  hoverNode, onHoverNode,
}: {
  hoverNode: string | null;
  onHoverNode: (id: string | null) => void;
}) {
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const mission = usePolisStore((s) => s.missions.find((m) => m.id === s.selectedMissionId));
  const chat = usePolisStore((s) => (missionId ? (s.chats[missionId] ?? []) : []));
  const gates = usePolisStore((s) => s.gates.filter((g) => g.mission_id === missionId));
  const sendChat = usePolisStore((s) => s.sendChat);
  const resolveGate = usePolisStore((s) => s.resolveGate);
  const openArtifact = usePolisStore((s) => s.openArtifact);
  const openInspector = usePolisStore((s) => s.openInspector);
  const focusNode = usePolisStore((s) => s.inspectorNodeId);
  const chatBusy = usePolisStore((s) => s.chatBusy);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const thread = useMemo(() => buildThread(chat, mission), [chat, mission]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, gates.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void sendChat(text);
  };

  const hot = (id: string | null) => !!id && (id === hoverNode || id === focusNode);

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="thread-panel">
      {mission && <Brief text={mission.brief || mission.title} pipeline={mission.pipeline} />}

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5"
      >
        {thread.length === 0 && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
            Тут іде хід місії. Міняй курс словами: «додай крок…», «постав на паузу»,
            «покажи, що зробив архітектор».
          </p>
        )}

        <AnimatePresence initial={false}>
          {thread.map((e) =>
            e.kind === 'operator' ? (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-end max-w-[80%]"
              >
                <div
                  className="rounded-2xl rounded-br-md px-3.5 py-2"
                  style={{
                    background: 'linear-gradient(135deg, var(--primary), var(--primary-deep))',
                    color: 'var(--ink-inverse)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 'var(--lh-normal)',
                  }}
                >
                  {e.text}
                </div>
              </motion.div>
            ) : e.kind === 'phantom' ? (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-start max-w-[88%] flex gap-2"
              >
                <div
                  className="w-6 h-6 rounded-full shrink-0 mt-0.5"
                  style={{ background: 'var(--accent-radial)', boxShadow: '0 0 12px var(--accent-glow)' }}
                />
                <div className="min-w-0">
                  <div
                    className="rounded-2xl rounded-tl-md px-3.5 py-2"
                    style={{
                      background: 'var(--glass-card)',
                      border: '1px solid var(--glass-border)',
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--ink-primary)',
                    }}
                  >
                    <MarkdownResponse content={e.text} />
                  </div>
                  {e.applied.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {e.applied.map((a, k) => (
                        <span
                          key={k}
                          className="px-1.5 py-0.5 rounded-md font-mono"
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
              </motion.div>
            ) : (
              <EventRow
                key={e.id}
                e={e}
                hot={hot(e.nodeId)}
                onHover={onHoverNode}
                onPick={openInspector}
                onOpenFile={(name) => missionId && void openArtifact(missionId, name)}
              />
            ),
          )}
        </AnimatePresence>

        {chatBusy && (
          <div className="self-start flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full shrink-0 animate-pulse"
              style={{ background: 'var(--accent-radial)', boxShadow: '0 0 12px var(--accent-glow)' }}
            />
            <div className="flex gap-1 items-center py-2">
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

      {/* Ворота — смуга над полем вводу, не картка у стрічці. Коли на тебе
          чекають, це найважливіше на екрані, і відповідь має бути там, куди
          ти й так дивишся. */}
      <AnimatePresence>
        {gates.map((g) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 overflow-hidden"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--primary) 45%, transparent)' }}
            data-testid={`gate-band-${g.id}`}
          >
            <div
              className="px-3.5 py-2.5"
              style={{ background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}
                />
                <span
                  className="font-mono"
                  style={{ fontSize: 'var(--fs-micro)', color: 'var(--primary)', letterSpacing: 'var(--tracking-wide)' }}
                >
                  ЧЕКАЄ ТВОГО РІШЕННЯ
                </span>
              </div>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>{g.question}</p>
              {g.payload_preview && (
                <p
                  className="mt-0.5 line-clamp-2"
                  style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
                >
                  {g.payload_preview}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => void resolveGate(g.id, true)}
                  className="flex-1 min-h-[44px] rounded-xl active:scale-[0.97]"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 'var(--fs-sm)',
                  }}
                  data-testid={`gate-yes-${g.id}`}
                >
                  Так
                </button>
                <button
                  onClick={() => void resolveGate(g.id, false)}
                  className="flex-1 min-h-[44px] rounded-xl active:scale-[0.97]"
                  style={{
                    background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)',
                    color: 'var(--signal-alert)',
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  Ні
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <footer
        className="shrink-0 px-3 pb-3 pt-2 flex gap-2"
        style={{ borderTop: '1px solid var(--glass-border)' }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={missionId ? 'Наказ, питання або зміна курсу…' : 'Обери місію зліва'}
          disabled={!missionId}
          className="flex-1 min-h-[46px] rounded-2xl px-4 outline-none focus:ring-2"
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
          className="min-w-[46px] min-h-[46px] rounded-2xl flex items-center justify-center active:scale-[0.95] disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--primary-deep))',
            color: 'var(--ink-inverse)',
            boxShadow: draft.trim() ? 'var(--shadow-glow)' : 'none',
          }}
          aria-label="надіслати"
          data-testid="mission-chat-send"
        >
          <SendHorizontal size={18} strokeWidth={2} />
        </button>
      </footer>
    </div>
  );
}
