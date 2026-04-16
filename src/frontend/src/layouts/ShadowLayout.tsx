import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { Avatar } from '../components/core/Avatar';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * SHADOW — Passive observation.
 * UI: only status bar 28px, rest is dark.
 * Minimal presence: faint avatar breathing in center.
 * AI: passive, no initiative.
 * Voice: wake word detection only.
 */
export default function ShadowLayout() {
  const context = useSystemStore((s) => s.context);

  const timeStr = context?.when.time ?? '';
  const temp = context?.env.temp_c;

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-void)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <StatusBar />

      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        {/* Avatar — small, subdued breathing */}
        <Avatar size={80} />

        {/* Ambient time display — very dim */}
        <motion.div
          className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.25 }}
          transition={{ delay: 0.4, duration: 1 }}
        >
          {timeStr && (
            <span
              className="font-mono tabular-nums tracking-[0.2em]"
              style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xl)' }}
            >
              {timeStr}
            </span>
          )}
          {temp != null && (
            <span
              className="font-mono"
              style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
            >
              {temp.toFixed(1)}°C
            </span>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
