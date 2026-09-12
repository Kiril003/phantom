import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { OmniMap } from '../components/map/OmniMap';
import { EASE_PHANTOM } from '../styles/motion';
import { useSettingsStore } from '../stores/settingsStore';
import { useSystemStore } from '../stores/systemStore';
import '../styles/map.css';

const DEFAULT_ZOOM = 15;

/**
 * Очікування сесії словами — і чому тут не крутиться саме лише кільце.
 *
 * До 12.09.2026 тут було кільце `animate-spin` і напис «PHANTOM OS», і
 * більше нічого. На кадрі зі скла пейн МАПА крутив його безкінечно: сесії
 * не було й не могло бути, а пейн мовчав про це так само і першу секунду,
 * і п'яту хвилину. Це той самий клас вади, що й «Unknown error» поруч —
 * прилад, який не називає причини.
 *
 * Зразок узято з `PhantomLoader` (app/App.tsx): підпис іде за прожитим
 * часом, і після порога каже, що саме не приїхало.
 */
function WaitingForSession() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const late = elapsed >= 8;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center"
      style={{ background: 'var(--surface-void)', padding: 24 }}
    >
      <div className="flex flex-col items-center" style={{ gap: 12, maxWidth: 340 }}>
        {!late && (
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        )}
        <span
          className="tracking-widest font-mono text-xs uppercase"
          style={{ color: 'var(--ink-muted)', textAlign: 'center' }}
        >
          {late ? 'Мапа не відкрилась' : 'Чекаю на сесію вузла'}
        </span>
        {late && (
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ink-muted)',
              textAlign: 'center',
            }}
          >
            Мапа читає тайли й треки цього вузла, тож без входу вона порожня.
            Сесії немає {elapsed} с — увійди в PHANTOM, і пейн намалюється сам.
          </span>
        )}
      </div>
    </div>
  );
}

export default function MapLayout() {
  const authenticated = useSystemStore((s) => s.authenticated);
  // Маршруту /login не існує — MainRouter сам показує вхід, поки немає
  // сесії. Редирект сюди лишав мапу порожньою назавжди.

  // Pull the user's preferred default zoom from the persisted settings store.
  // bootstrapSettings seeds this at startup; falls back to 15 when the store
  // hasn't loaded yet (first frame after a cold start).
  const zoomRaw = useSettingsStore((s) => s.values.ui_map_default_zoom);
  const initialZoom =
    typeof zoomRaw === 'number' && Number.isFinite(zoomRaw) ? zoomRaw : DEFAULT_ZOOM;

  if (!authenticated) return <WaitingForSession />;

  return (
    <motion.div
      className="w-full h-full flex flex-col relative overflow-hidden"
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
        <main className="flex-1 min-h-0 relative">
          <OmniMap initialZoom={initialZoom} />
        </main>
      </div>
    </motion.div>
  );
}
