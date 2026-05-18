import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Wind, TrendingDown, Brain, Route } from 'lucide-react';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { ChatWindow } from '../components/chat/ChatWindow';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { useSettingsStore } from '../stores/settingsStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * DIALOGUE — voice + chat surface, sunrise redesign.
 *
 *   ┌──────────────┬───────────────────────────────────────────────────┐
 *   │ VOICE ORB    │  TRANSCRIPT — wired ChatWindow with date marker,  │
 *   │ phoneme bars │  AI greeting bubble, user voice bubble + waveform,│
 *   │ "Listening…" │  thinking pill, inline scenes, suggestion chips,  │
 *   │ bio chips    │  glass-strong input pill at bottom.               │
 *   │ glass card   │                                                   │
 *   └──────────────┴───────────────────────────────────────────────────┘
 *
 * Wiring is preserved:
 *   - useSystemStore.context           — biosignal chips
 *   - useChatStore (isTyping/streaming) — orb pulse trigger
 *   - useVoiceAlwaysOnStatusStore       — armed / listening / cooldown
 *   - useSettingsStore.values.voice_mode — sphere label
 *   - ChatWindow handles the actual transcript, scenes and input pill;
 *     DialogueLayout only reframes it inside the new glass scaffolding.
 *
 * Animations carry meaning:
 *   - orb-breathe = listening (slows when always-on is asleep)
 *   - phoneme bars use phantom-pulse-slow with staggered durations to
 *     read as voice phoneme energy when the orb is "live"
 *   - the breathing equaliser bars in the YOU·NOW card animate only when
 *     breathing_bpm is real, never on null fixtures.
 */
export default function DialogueLayout() {
  const context = useSystemStore((s) => s.context);
  const isTyping = useChatStore((s) => s.isTyping);
  const streaming = useChatStore((s) => s.streaming);
  const [voiceActive, setVoiceActive] = useState(false);
  // Phase 11c.3 — gate is mounted at App level; read its status here.
  const alwaysOnStatus = useVoiceAlwaysOnStatusStore((s) => s.status);
  // Phase 12.0 — sphere label depends on the current voice mode.
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
    if (voiceActive) return 'Recording…';
    if (alwaysOnStatus === 'armed') return 'Armed';
    if (alwaysOnStatus === 'cooldown') return 'Cooldown';
    if (pulsing) return 'Thinking…';
    if (alwaysOnStatus === 'listening') return 'Listening…';
    if (alwaysOnActive) {
      if (voiceMode === 'wake_word') return 'Awake';
      if (voiceMode === 'continuous') return 'Listening…';
      return 'Ready';
    }
    return 'Ready';
  }, [voiceActive, pulsing, alwaysOnStatus, alwaysOnActive, voiceMode]);

  const bpm = context?.body.breathing_bpm;
  const stress = context?.body.stress_level;
  const provider = context?.system.ai_provider;
  const breathingState = context?.body.breathing_state;

  // Pulse the orb harder when the operator (or AI) is producing speech.
  const orbScale = voiceActive ? 1.04 : pulsing ? 1.02 : 1;

  return (
    <motion.div
      className="w-[1024px] h-[600px] relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />
      <StatusBar />

      <main className="absolute inset-0 z-10" style={{ top: 44, bottom: 0 }}>
        {/* === LEFT — VOICE PRESENCE PANEL ================================== */}
        <motion.aside
          className="absolute"
          style={{ left: 12, top: 12, bottom: 76, width: 296, zIndex: 3 }}
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: EASE_PHANTOM as unknown as number[] }}
        >
          {/* Big animated voice orb with phoneme bars. */}
          <div
            className="relative flex items-center justify-center"
            style={{ height: 240 }}
          >
            <svg
              viewBox="0 0 240 240"
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                transform: `scale(${orbScale})`,
                transition: 'transform 120ms ease',
              }}
            >
              <defs>
                <radialGradient id="dialogue-voice-core" cx="35%" cy="30%">
                  <stop offset="0%" stopColor="#fff" />
                  <stop offset="40%" stopColor="#fde9b8" />
                  <stop offset="100%" stopColor="#f4af25" />
                </radialGradient>
              </defs>

              {/* Outer voice-lock rings */}
              {[110, 92, 76].map((r, i) => (
                <circle
                  key={r}
                  cx="120"
                  cy="120"
                  r={r}
                  fill="none"
                  stroke={`rgba(244,175,37,${0.18 - i * 0.04})`}
                  strokeWidth="0.8"
                  strokeDasharray={i === 1 ? '2 4' : undefined}
                  style={{
                    animation: `orb-breathe ${3 + i}s ease-in-out infinite`,
                  }}
                />
              ))}

              {/* Phoneme bars — 36 spokes around the orb */}
              {Array.from({ length: 36 }).map((_, i) => {
                const angle = (i / 36) * Math.PI * 2;
                const baseR = 60;
                const len =
                  8 + Math.abs(Math.sin(i * 0.7) * 14) + (i % 5 === 0 ? 6 : 0);
                const x1 = 120 + Math.cos(angle) * baseR;
                const y1 = 120 + Math.sin(angle) * baseR;
                const x2 = 120 + Math.cos(angle) * (baseR + len);
                const y2 = 120 + Math.sin(angle) * (baseR + len);
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#f4af25"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity={pulsing ? 0.5 + (i % 4) * 0.15 : 0.25 + (i % 4) * 0.1}
                    style={{
                      animation: pulsing
                        ? `phantom-pulse-slow ${1 + (i % 6) * 0.2}s ease-in-out infinite`
                        : undefined,
                    }}
                  />
                );
              })}

              {/* Solid core */}
              <circle
                cx="120"
                cy="120"
                r="46"
                fill="url(#dialogue-voice-core)"
                style={{
                  animation: 'orb-breathe 4s ease-in-out infinite',
                  filter: 'drop-shadow(0 0 20px rgba(244,175,37,0.5))',
                }}
              />
              <circle cx="108" cy="108" r="14" fill="rgba(255,255,255,0.7)" />
            </svg>
          </div>

          <div className="text-center" style={{ padding: '0 8px' }}>
            <div
              className="playfair"
              style={{ fontSize: 20, color: 'var(--ink-secondary)' }}
            >
              {sphereLabel}
            </div>
            <div className="micro-label" style={{ marginTop: 4 }}>
              {voiceActive ? 'TAP ORB TO INTERRUPT' : 'TAP ORB TO SPEAK'}
            </div>
          </div>

          {/* Bio chips — wired to context.body / system.ai_provider */}
          <div className="glass" style={{ marginTop: 14, padding: 12 }}>
            <div className="micro-label" style={{ marginBottom: 8 }}>
              YOU · NOW
            </div>
            <div className="flex flex-col" style={{ gap: 6 }}>
              {/* Breathing — equaliser bars only animate when bpm is live */}
              <div className="flex items-center" style={{ gap: 6, fontSize: 11 }}>
                <Wind size={12} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
                <span className="flex-1" style={{ color: 'var(--ink-muted)' }}>
                  BREATHING
                </span>
                <span className="flex" style={{ gap: 1 }}>
                  {[4, 7, 4, 7, 4, 7, 4].map((h, i) => (
                    <span
                      key={i}
                      style={{
                        width: 2,
                        height: h,
                        background: 'var(--primary)',
                        borderRadius: 1,
                        opacity: bpm != null ? 1 : 0.35,
                        animation:
                          bpm != null
                            ? `phantom-pulse-slow ${1.6 + (i % 3) * 0.2}s ease-in-out infinite`
                            : undefined,
                      }}
                    />
                  ))}
                </span>
                <span
                  className="tabular"
                  style={{ fontWeight: 600, fontSize: 11 }}
                >
                  {bpm != null ? `${bpm}/min` : '—'}
                </span>
              </div>

              {/* Stress — bar + label, colour follows level */}
              <StressRow stress={stress} />

              {/* State (breathing_state) */}
              <div className="flex items-center" style={{ gap: 6, fontSize: 11 }}>
                <Brain size={12} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
                <span className="flex-1" style={{ color: 'var(--ink-muted)' }}>
                  STATE
                </span>
                <span
                  className="playfair"
                  style={{ fontSize: 12, color: 'var(--ink-secondary)' }}
                >
                  {breathingState ?? '—'}
                </span>
              </div>

              {/* Route — AI provider + whisper pill */}
              <div className="flex items-center" style={{ gap: 6, fontSize: 11 }}>
                <Route size={12} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
                <span className="flex-1" style={{ color: 'var(--ink-muted)' }}>
                  ROUTE
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
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
                    {voiceMode === 'wake_word' ? 'wake' : 'live'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.aside>

        {/* === RIGHT — TRANSCRIPT + INPUT (wired ChatWindow) ================ */}
        <motion.div
          className="absolute"
          style={{ left: 320, right: 12, top: 12, bottom: 76, zIndex: 2 }}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
        >
          {/* Glass shell behind the chat surface — gives the transcript the
              same warm panel as the bio card on the left. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-[24px]"
            style={{ 
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(30px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}
          />
          <div className="relative h-full overflow-hidden rounded-[24px]">
            <ChatWindow
              onVoiceToggle={handleVoiceToggle}
              placeholder="Message PHANTOM…"
              className="pb-2"
            />
          </div>
        </motion.div>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}

/* ─── Stress row ──────────────────────────────────────────────────────── */

function StressRow({ stress }: { stress: number | null | undefined }) {
  const view = (() => {
    if (stress == null)
      return {
        pct: 0,
        bar: 'var(--ink-muted)',
        label: '—',
        labelColor: 'var(--ink-muted)',
      };
    const pct = Math.max(0, Math.min(100, stress * 100));
    if (stress >= 0.7)
      return {
        pct,
        bar: 'var(--signal-alert)',
        label: 'high',
        labelColor: 'var(--coral-deep)',
      };
    if (stress >= 0.4)
      return {
        pct,
        bar: 'var(--signal-warn)',
        label: 'mid',
        labelColor: '#8a5e0a',
      };
    return {
      pct,
      bar: 'var(--signal-ok)',
      label: 'low',
      labelColor: '#16a34a',
    };
  })();

  return (
    <div className="flex items-center" style={{ gap: 6, fontSize: 11 }}>
      <TrendingDown
        size={12}
        strokeWidth={1.75}
        style={{ color: stress != null && stress < 0.4 ? 'var(--signal-ok)' : 'var(--primary-deep)' }}
      />
      <span className="flex-1" style={{ color: 'var(--ink-muted)' }}>
        STRESS
      </span>
      <div
        style={{
          width: 60,
          height: 4,
          borderRadius: 2,
          background: 'var(--line-subtle)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${view.pct}%`,
            background: view.bar,
            borderRadius: 2,
          }}
        />
      </div>
      <span
        style={{ fontSize: 10, fontWeight: 600, color: view.labelColor }}
      >
        {view.label}
      </span>
    </div>
  );
}
