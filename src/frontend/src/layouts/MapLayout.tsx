import { motion } from 'framer-motion';
import { TacticalMap } from '../components/map/TacticalMap';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { EASE_PHANTOM } from '../styles/motion';
import { useSettingsStore } from '../stores/settingsStore';

const DEFAULT_ZOOM = 15;

/**
 * MapLayout — dedicated screen for tactical map.
 * Accessible via /map route (triggered from FloatingToolbar).
 */
export default function MapLayout() {
  // Pull the user's preferred default zoom from the persisted settings store.
  // bootstrapSettings seeds this at startup; falls back to 15 when the store
  // hasn't loaded yet (first frame after a cold start).
  const zoomRaw = useSettingsStore((s) => s.values.ui_map_default_zoom);
  const initialZoom =
    typeof zoomRaw === 'number' && Number.isFinite(zoomRaw) ? zoomRaw : DEFAULT_ZOOM;

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
        <TacticalMap initialZoom={initialZoom} />
      </main>
      <FloatingToolbar />
    </motion.div>
  );
}
