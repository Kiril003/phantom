import { motion } from 'framer-motion';
import { TacticalMap } from '../components/map/TacticalMap';
import { StatusBar } from '../components/core/StatusBar';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { EASE_PHANTOM } from '../styles/motion';
import { useSettingsStore } from '../stores/settingsStore';
import '../styles/map.css';

const DEFAULT_ZOOM = 15;

/**
 * MapLayout — sunrise-warm tactical map shell.
 *
 * Reference: docs/design-handoff/project/screen-5-map.jsx
 *
 * The frame paints a warm cream backdrop with a soft amber sunrise glow
 * around the lower-centre and a faint orange wash on the upper-right
 * (matching the design DNA radial gradient stack). The actual cartography
 * + glass HUD lives inside `TacticalMap`. The frame here is responsible
 * for:
 *   - locking 1024×600 dimensions (no scroll on the primary surface),
 *   - rendering the sunrise gradient + soft sun-orb fixture,
 *   - composing StatusBar (top) + FloatingToolbar (bottom) so the map
 *     gets a true full-bleed canvas in between.
 *
 * AmbientGlows is intentionally NOT used here — the map needs a
 * predictable warm gutter (cream paper) so MapLibre tile gaps don't
 * suddenly reveal a moving accent gradient. We render a static blur stack
 * tuned for cartographic legibility instead.
 *
 * `prefers-reduced-motion`: the sun-orb breathing animation lives in
 * map.css and is gated on `(prefers-reduced-motion: no-preference)`; this
 * component uses Framer's enter fade only on first paint (no loop).
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
      className="w-[1024px] h-[600px] flex flex-col relative overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
      data-layout="map"
    >
      {/* Warm sunrise wash — static, beneath everything. Mirrors the
          radial-gradient stack used by the design prototype so the
          frame edges glow even when MapLibre is panned to ocean. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 0,
          background:
            // Amber lower-left lobe — operator-centre warmth.
            'radial-gradient(ellipse 50% 40% at 30% 75%, rgba(244,175,37,0.22) 0%, rgba(244,175,37,0) 70%),' +
            // Orange upper-right — sunrise direction, matches design DNA.
            'radial-gradient(ellipse 70% 50% at 80% 20%, rgba(251,146,60,0.16) 0%, rgba(251,146,60,0) 70%),' +
            // Cream paper base.
            'linear-gradient(180deg, #fef6e6 0%, #f6ead4 100%)',
        }}
      />

      {/* Sun-orb fixture — small, off-screen-bottom luminance. Subtle
          enough to read as ambient warmth, not a UI element. */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          zIndex: 1,
          left: '50%',
          bottom: '-180px',
          transform: 'translateX(-50%)',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 50% 30%, rgba(255,243,208,0.55) 0%, rgba(244,175,37,0.32) 35%, rgba(251,146,60,0.10) 70%, rgba(251,146,60,0) 100%)',
          filter: 'blur(2px)',
          opacity: 0.6,
        }}
      />

      {/* Cyberdeck-cold compatibility — when the legacy theme is active
          the warm fixtures above would clash with the dark slate look,
          so we cover them with a near-opaque dark wash that respects the
          token. The `[data-theme]` selector cascade leaves them alone in
          the warm themes. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none cyberdeck-cover"
        style={{ zIndex: 1 }}
      />

      <div className="relative z-10 flex flex-col w-full h-full">
        <StatusBar />
        <main className="flex-1 min-h-0 relative">
          <TacticalMap initialZoom={initialZoom} />
        </main>
        <FloatingToolbar />
      </div>
    </motion.div>
  );
}
