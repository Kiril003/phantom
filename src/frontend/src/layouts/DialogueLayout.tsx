import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { Avatar } from '../components/core/Avatar';
import { ChatWindow } from '../components/chat/ChatWindow';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * DIALOGUE — full conversation mode.
 * Left panel: Avatar + live context + memory hints.
 * Right panel: ChatWindow with session list, response forms, voice toggle.
 */
export default function DialogueLayout() {
  const context = useSystemStore((s) => s.context);
  const isTyping = useChatStore((s) => s.isTyping);
  const [voiceActive, setVoiceActive] = useState(false);

  const handleVoiceToggle = useCallback((active: boolean) => {
    setVoiceActive(active);
  }, []);

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-deep)' }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <StatusBar />

      <div className="flex-1 flex overflow-hidden">
        <motion.aside
          className="w-[240px] h-full flex flex-col items-center border-r py-4 px-3 gap-4 shrink-0"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--line-subtle)',
          }}
          initial={{ x: -240 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <Avatar size={140} speaking={isTyping} listening={voiceActive} />

          <div className="w-full flex flex-col gap-2 mt-2">
            {context?.body.breathing_bpm != null && (
              <ContextLine label="Breathing" value={`${context.body.breathing_bpm} bpm`} />
            )}
            {context?.body.stress_level != null && (
              <ContextLine
                label="Stress"
                value={`${(context.body.stress_level * 100).toFixed(0)}%`}
                alert={context.body.stress_level > 0.7}
              />
            )}
            {context?.where.place_name && (
              <ContextLine label="Location" value={context.where.place_name} />
            )}
            <ContextLine label="AI" value={context?.system.ai_provider ?? '—'} />
          </div>

          {context?.memory_hints && context.memory_hints.length > 0 && (
            <div className="w-full flex flex-col gap-1 mt-auto">
              <span
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
                className="tracking-wider"
              >
                MEMORY CONTEXT
              </span>
              {context.memory_hints.slice(0, 3).map((hint, i) => (
                <span
                  key={i}
                  className="truncate"
                  style={{
                    color: 'var(--ink-secondary)',
                    fontSize: 'var(--fs-micro)',
                  }}
                >
                  {hint}
                </span>
              ))}
            </div>
          )}
        </motion.aside>

        <div className="flex-1 h-full min-w-0 min-h-0">
          <ChatWindow
            onVoiceToggle={handleVoiceToggle}
            minimalChrome={false}
            placeholder="Розмова з PHANTOM…"
          />
        </div>
      </div>
    </motion.div>
  );
}

function ContextLine({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{label}</span>
      <span
        className="font-mono"
        style={{
          color: alert ? 'var(--signal-alert)' : 'var(--ink-secondary)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
