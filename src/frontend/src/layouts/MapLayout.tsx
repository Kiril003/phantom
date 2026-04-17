import { motion } from 'framer-motion';
import { TacticalMap } from '../components/map/TacticalMap';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * MapLayout — dedicated screen for tactical map.
 * Accessible via /map route (triggered from FloatingToolbar).
 */
export default function MapLayout() {
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
      <main className="flex-1 min-h-0 relative z-10">
        <TacticalMap />
      </main>
      <FloatingToolbar />
    </motion.div>
  );
}
