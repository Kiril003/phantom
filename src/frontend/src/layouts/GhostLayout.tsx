import { motion } from 'framer-motion';
import { ShieldOff } from 'lucide-react';
import { useSystemStore } from '../stores/systemStore';

/**
 * GHOST — Encrypted recording mode.
 * UI: screen dark, only micro-indicator.
 * Sensors: everything recorded, encrypted.
 * AI: silent.
 * Voice: recording only, no TTS.
 * OLED: off.
 * RGB: off.
 * Everything writes to AES-256 encrypted log.
 */
export default function GhostLayout() {
  const context = useSystemStore((s) => s.context);
  const goShadow = useSystemStore((s) => s.goShadow);

  return (
    <motion.div
      className="w-[1024px] h-[600px] relative"
      style={{ background: 'var(--surface-void)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Exit button — improved for touchscreens */}
      <motion.button
        type="button"
        onClick={goShadow}
        className="absolute top-4 left-4 p-2.5 rounded-full z-50 border border-white/5 active:opacity-100"
        style={{
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(8px)',
          color: 'var(--ink-muted)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        whileHover={{ opacity: 0.6, background: 'rgba(255,255,255,0.08)' }}
        whileTap={{ scale: 0.94, opacity: 1, background: 'rgba(255,255,255,0.12)' }}
        transition={{ duration: 0.2 }}
        aria-label="Exit Ghost"
      >
        <ShieldOff size={16} />
      </motion.button>

      {/* Micro indicator — bottom-right, 2x2 pixel equivalent */}
      <motion.div
        className="absolute bottom-[4px] right-[4px]"
        animate={{ opacity: [0.2, 0.5, 0.2] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div
          className="rounded-full"
          style={{
            width: 3,
            height: 3,
            background: 'var(--accent)',
          }}
        />
      </motion.div>

      {context && (() => {
        const uptime = context.system.uptime_s;
        const hh = String(Math.floor(uptime / 3600)).padStart(2, '0');
        const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0');
        const ss = String(uptime % 60).padStart(2, '0');
        return (
          <motion.div
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.08 }}
            transition={{ delay: 2, duration: 1 }}
          >
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--accent)' }}
            >
              {`${hh}:${mm}:${ss}`}
            </span>
          </motion.div>
        );
      })()}
    </motion.div>
  );
}
