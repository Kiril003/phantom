import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Wind, TrendingDown, Route } from 'lucide-react';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { ChatWindow } from '../components/chat/ChatWindow';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { useSettingsStore } from '../stores/settingsStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * DIALOGUE — the conversation IS the screen.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ PRESENCE STRIP — mini orb · state label · bio chips · route    │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │                                                                │
 *   │  TRANSCRIPT — full-bleed ChatWindow (scenes, images,           │
 *   │  workbench cards, input pill at the bottom)                    │
 *   │                                                                │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * The old 296px voice-orb panel duplicated the input-pill mic button
 * and cost a third of the screen; its wiring (always-on status, voice
 * mode, breathing/stress/provider chips) now lives in one 44px strip.
 * The orb still breathes: it pulses while PHANTOM thinks or listens.
 */
export default function DialogueLayout() {
  const context = useSystemStore((s) => s.context);
  const isTyping = useChatStore((s) => s.isTyping);
  const streaming = useChatStore((s) => s.streaming);
  const [voiceActive, setVoiceActive] = useState(false);
  const alwaysOnStatus = useVoiceAlwaysOnStatusStore((s) => s.status);
  const voiceMode = useSettingsStore(
    (s) => (s.values.voice_mode as 'off' | 'continuous' | 'wake_word' | undefined) ?? 'off',
  );

  const handleVoiceToggle = useCallback((active: boolean) => {
    setVoiceActive(active);
  }, []);

  const alwaysOnActive =
    alwaysOnStatus === 'ready' ||
    alwaysOnStatus === 'listening' ||
    alwaysOnStatus === 'armed' ||
    alwaysOnStatus === 'cooldown';

  const pulsing =
    isTyping ||
    !!streaming ||
    voiceActive ||
    alwaysOnStatus === 'armed' ||
    alwaysOnStatus === 'cooldown';

  const sphereLabel = useMemo(() => {
    if (voiceActive) return 'Слухаю тебе…';
    if (alwaysOnStatus === 'armed') return 'Напоготові';
    if (alwaysOnStatus === 'cooldown') return 'Пауза';
    if (pulsing) return 'Думаю…';
    if (alwaysOnStatus === 'listening') return 'Слухаю…';
    if (alwaysOnActive) {
      if (voiceMode === 'wake_word') return 'Не сплю';
      if (voiceMode === 'continuous') return 'Слухаю…';
      return 'Готовий';
    }
    return 'Готовий';
  }, [voiceActive, pulsing, alwaysOnStatus, alwaysOnActive, voiceMode]);

  const bpm = context?.body.breathing_bpm;
  const stress = context?.body.stress_level;
  const provider = context?.system.ai_provider;

  return (
    <motion.div
      className="w-full h-full min-w-[1024px] min-h-full relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />

      <main className="absolute inset-0 z-10" style={{ top: 44, bottom: 0 }}>
        {/* === TRANSCRIPT — full-bleed chat =============================== */}
        <motion.div
          className="absolute"
          style={{ left: 12, right: 12, top: 8, bottom: 84, zIndex: 2 }}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <div
            aria-hidden
            className="absolute inset-0 rounded-[24px]"
            style={{
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(30px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            }}
          />
          <div className="relative h-full overflow-hidden rounded-[24px]">
            <ChatWindow
              onVoiceToggle={handleVoiceToggle}
              placeholder="Напиши PHANTOM…"
              className="pb-2"
              presence={
                <Presence
                  pulsing={pulsing}
                  label={sphereLabel}
                  bpm={bpm}
                  stress={stress}
                  provider={provider}
                  voiceMode={voiceMode}
                />
              }
            />
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}

/* ─── Присутність у заголовку чату ────────────────────────────────────── */

function Presence({
  pulsing,
  label,
  bpm,
  stress,
  provider,
  voiceMode,
}: {
  pulsing: boolean;
  label: string;
  bpm: number | null | undefined;
  stress: number | null | undefined;
  provider: string | null | undefined;
  voiceMode: 'off' | 'continuous' | 'wake_word';
}) {
  return (
    <div className="flex items-center min-w-0" style={{ gap: 10 }}>
          {/* Mini orb — same soul, 26px */}
          <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden>
            <defs>
              <radialGradient id="dialogue-voice-core" cx="35%" cy="30%">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="40%" stopColor="#fde9b8" />
                <stop offset="100%" stopColor="#f4af25" />
              </radialGradient>
            </defs>
            <circle
              cx="16" cy="16" r="13"
              fill="none"
              stroke="rgba(244,175,37,0.35)"
              strokeWidth="1"
              strokeDasharray={pulsing ? undefined : '2 3'}
              style={{ animation: 'orb-breathe 3s ease-in-out infinite' }}
            />
            <circle
              cx="16" cy="16" r={pulsing ? 9 : 8}
              fill="url(#dialogue-voice-core)"
              style={{
                animation: `orb-breathe ${pulsing ? 1.6 : 4}s ease-in-out infinite`,
                filter: 'drop-shadow(0 0 6px rgba(244,175,37,0.5))',
                transition: 'r 200ms ease',
              }}
            />
          </svg>
      <span
        className="playfair truncate"
        style={{ fontSize: 14, color: 'var(--ink-secondary)' }}
      >
        {label}
      </span>

      {/* Живий датчик показуємо, мертвий ховаємо: ряд прочерків
          створював враження зламаного приладу. */}
      {bpm != null && (
        <span className="flex items-center" style={{ gap: 5, fontSize: 11 }}>
          <Wind size={12} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
          <span className="tabular" style={{ fontWeight: 600 }}>{bpm}/хв</span>
        </span>
      )}
      {stress != null && <StressChip stress={stress} />}
      <span className="flex items-center" style={{ gap: 5, fontSize: 11 }}>
        <Route size={12} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
          {provider ?? '—'}
        </span>
        {voiceMode !== 'off' && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--primary-deep)',
              padding: '1px 5px',
              borderRadius: 999,
              background: 'rgba(244,175,37,0.15)',
              letterSpacing: '0.1em',
            }}
          >
            {voiceMode === 'wake_word' ? 'на слово' : 'наживо'}
          </span>
        )}
      </span>
    </div>
  );
}

/* ─── Stress chip ─────────────────────────────────────────────────────── */

function StressChip({ stress }: { stress: number | null | undefined }) {
  const view = (() => {
    if (stress == null)
      return { pct: 0, bar: 'var(--ink-muted)', label: '—', labelColor: 'var(--ink-muted)' };
    const pct = Math.max(0, Math.min(100, stress * 100));
    if (stress >= 0.7)
      return { pct, bar: 'var(--signal-alert)', label: 'високий', labelColor: 'var(--coral-deep)' };
    if (stress >= 0.4)
      return { pct, bar: 'var(--signal-warn)', label: 'середній', labelColor: '#8a5e0a' };
    return { pct, bar: 'var(--signal-ok)', label: 'низький', labelColor: '#16a34a' };
  })();

  return (
    <span className="flex items-center" style={{ gap: 5, fontSize: 11 }}>
      <TrendingDown
        size={12}
        strokeWidth={1.75}
        style={{ color: stress != null && stress < 0.4 ? 'var(--signal-ok)' : 'var(--primary-deep)' }}
      />
      <span
        style={{
          width: 40, height: 4, borderRadius: 2,
          background: 'var(--line-subtle)', position: 'relative', display: 'inline-block',
        }}
      >
        <span
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${view.pct}%`, background: view.bar, borderRadius: 2,
          }}
        />
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: view.labelColor }}>
        {view.label}
      </span>
    </span>
  );
}
