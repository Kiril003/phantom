import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { Orb } from '../components/core/Orb';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * SHADOW — passive observation.
 * Minimal surface: Orb floats quietly in the middle with dim ambient glows.
 */
export default function ShadowLayout() {
  const context = useSystemStore((s) => s.context);

  const timeStr = context?.when.time ?? '';
  const temp = context?.env.temp_c;

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />
      <StatusBar />

      <main className="flex-1 relative overflow-hidden flex flex-col items-center justify-center gap-6 z-10">
        <Orb size="sm" />

        <motion.div
          className="flex flex-col items-center gap-1"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 0.7, y: 0 }}
          transition={{ delay: 0.35, duration: 0.9 }}
        >
          {timeStr && (
            <span
              className="tabular-nums"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xl)',
                color: 'var(--ink-secondary)',
                fontWeight: 300,
                letterSpacing: 'var(--tracking-tight)',
              }}
            >
              {timeStr}
            </span>
          )}
          {temp != null && (
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-muted)',
                letterSpacing: 'var(--tracking-wide)',
              }}
            >
              {temp.toFixed(1)}°C · ambient
            </span>
          )}
          <span
            className="italic mt-2"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-muted)',
            }}
          >
            Quiet. Watching. Yours.
          </span>
        </motion.div>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}
