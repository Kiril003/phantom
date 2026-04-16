import { motion } from 'framer-motion';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * DREAM — Night mode.
 * UI: minimal ambient glow (purple).
 * Sensors: radar only (breathing monitoring).
 * AI: whisper mode, minimal words, no questions.
 * Voice: whisper detection, quiet TTS.
 * OLED: off or dim clock.
 * RGB: dim purple breathing.
 */
export default function DreamLayout() {
  const context = useSystemStore((s) => s.context);

  const breathingBpm = context?.body.breathing_bpm;
  const breathingState = context?.body.breathing_state;
  const timeStr = context?.when.time ?? '';

  // Breathing cycle: sync animation speed to actual BPM
  const breathDuration = breathingBpm && breathingBpm > 0
    ? 60 / breathingBpm
    : 5;

  return (
    <motion.div
      className="w-[1024px] h-[600px] relative overflow-hidden"
      style={{ background: 'var(--surface-void)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1, ease: EASE_PHANTOM as unknown as number[] }}
    >
      {/* Ambient glow orb — synced to breathing */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="rounded-full"
          style={{
            width: 160,
            height: 160,
            background: `radial-gradient(circle, rgba(149,117,205,0.15) 0%, rgba(149,117,205,0.05) 40%, transparent 70%)`,
            boxShadow: '0 0 60px rgba(149,117,205,0.1)',
          }}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: breathDuration,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Very dim clock — center top */}
      <motion.div
        className="absolute top-[40%] left-0 right-0 flex flex-col items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.2 }}
        transition={{ delay: 1, duration: 2 }}
      >
        {timeStr && (
          <span
            className="font-mono tabular-nums tracking-[0.4em]"
            style={{ color: 'var(--accent)', fontSize: 'var(--fs-xxl)' }}
          >
            {timeStr}
          </span>
        )}
      </motion.div>

      {/* Breathing indicator — bottom center */}
      {breathingBpm != null && (
        <motion.div
          className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ delay: 2, duration: 1 }}
        >
          <div className="flex items-center gap-2">
            {/* Breathing bar — rises and falls */}
            <motion.div
              className="rounded-full"
              style={{
                width: 40,
                height: 3,
                background: 'var(--accent)',
              }}
              animate={{
                scaleX: [0.6, 1, 0.6],
                opacity: [0.3, 0.7, 0.3],
              }}
              transition={{
                duration: breathDuration,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </div>
          <span
            className="font-mono"
            style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
          >
            {breathingBpm} bpm
            {breathingState === 'sleep' && ' — sleep'}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
