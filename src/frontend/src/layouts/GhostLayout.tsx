import { motion } from 'framer-motion';
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

  return (
    <motion.div
      className="w-[1024px] h-[600px] relative"
      style={{ background: 'var(--surface-void)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
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

      {/* Recording duration — extremely subtle, center bottom */}
      {context && (
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
            {formatUptime(context.system.uptime_s)}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
