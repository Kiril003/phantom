import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { Orb } from '../components/core/Orb';
import { ChatWindow } from '../components/chat/ChatWindow';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * DIALOGUE — conversation surface.
 * Left: Orb (voice-reactive) + live context whisper + memory hints.
 * Right: ChatWindow with sessions panel and glass input pill.
 */
export default function DialogueLayout() {
  const context = useSystemStore((s) => s.context);
  const isTyping = useChatStore((s) => s.isTyping);
  const streaming = useChatStore((s) => s.streaming);
  const [voiceActive, setVoiceActive] = useState(false);
  // Phase 11c.3 — gate is mounted at App level; read its status here.
  const alwaysOnStatus = useVoiceAlwaysOnStatusStore((s) => s.status);

  const handleVoiceToggle = useCallback((active: boolean) => {
    setVoiceActive(active);
  }, []);

  const alwaysOnActive = alwaysOnStatus === 'ready'
    || alwaysOnStatus === 'listening'
    || alwaysOnStatus === 'armed'
    || alwaysOnStatus === 'cooldown';

  const pulsing = isTyping || !!streaming || voiceActive
    || alwaysOnStatus === 'armed' || alwaysOnStatus === 'cooldown';

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />
      <StatusBar />

      <main className="flex-1 flex min-h-0 z-10 relative">
        {/* Left — Orb + context whisper */}
        <motion.aside
          className="w-[300px] shrink-0 flex flex-col items-center justify-between py-6 px-5 relative"
          initial={{ x: -32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <div className="flex-1 flex flex-col items-center justify-center gap-4 w-full">
            <Orb size="md" pulsing={pulsing} />
            <div
              className="text-center mt-2"
              style={{ maxWidth: 240 }}
            >
              <p
                className="text-gradient"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-lg)',
                  fontWeight: 300,
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {voiceActive
                  ? 'Listening'
                  : alwaysOnStatus === 'armed'
                    ? 'Armed'
                    : alwaysOnStatus === 'cooldown'
                      ? 'Cooldown'
                      : pulsing
                        ? 'Thinking'
                        : alwaysOnActive
                          ? 'Awake'
                          : 'Ready'}
              </p>
              <p
                className="italic mt-1"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--ink-secondary)',
                }}
              >
                {context?.memory_hints && context.memory_hints.length > 0
                  ? '"' + context.memory_hints[0] + '"'
                  : 'Speak freely.'}
              </p>
            </div>
          </div>

          {/* Context readouts */}
          {context && (
            <div className="w-full flex flex-col gap-1.5 glass-panel px-3 py-2.5"
              style={{ borderRadius: 14 }}
            >
              <ContextLine
                label="Breathing"
                value={context.body.breathing_bpm != null ? `${context.body.breathing_bpm} bpm` : '—'}
                muted={context.body.breathing_bpm == null}
              />
              <ContextLine
                label="Stress"
                value={
                  context.body.stress_level != null
                    ? `${Math.round(context.body.stress_level * 100)}%`
                    : '—'
                }
                alert={(context.body.stress_level ?? 0) > 0.7}
                muted={context.body.stress_level == null}
              />
              {context.where.place_name && (
                <ContextLine label="Location" value={context.where.place_name} />
              )}
              <ContextLine label="AI" value={context.system.ai_provider ?? '—'} capitalize />
            </div>
          )}
        </motion.aside>

        {/* Right — ChatWindow */}
        <motion.div
          className="flex-1 min-w-0 min-h-0 relative"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <div
            className="absolute inset-y-4 inset-x-0 mr-4 glass-panel"
            style={{
              borderRadius: 24,
              borderRight: 'none',
              zIndex: 0,
            }}
          />
          <div className="relative h-full">
            <ChatWindow
              onVoiceToggle={handleVoiceToggle}
              minimalChrome={false}
              placeholder="Message PHANTOM…"
              className="pb-14"
            />
          </div>
        </motion.div>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}

function ContextLine({
  label,
  value,
  alert = false,
  capitalize = false,
  muted = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
  capitalize?: boolean;
  muted?: boolean;
}) {
  const valueColor = alert
    ? 'var(--signal-alert)'
    : muted
      ? 'var(--ink-muted)'
      : 'var(--ink-primary)';
  return (
    <div className="flex items-center justify-between">
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: valueColor,
          textTransform: capitalize ? 'capitalize' : 'none',
        }}
      >
        {value}
      </span>
    </div>
  );
}
