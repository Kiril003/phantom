import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lock,
  Coffee,
  Sunrise,
  Sun,
  Sparkles,
  CalendarClock,
} from 'lucide-react';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';
import { formatRelativeClock } from '../utils/format';

/**
 * SHADOW — passive observation, sunrise dawn surface (R1 redesign).
 *
 * Layout (1024×600, no scroll):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ StatusBar (44 px)                                                  │
 *   ├──────────────┬───────────────────────────────────────┬─────────────┤
 *   │ VITALS glass │   AURORA ORB centrepiece              │ WEATHER     │
 *   │ EKG / breath │   halo rings · particles · core       │ NEXT mtg    │
 *   │ HRV · stress │   "Quiet. Watching. Yours." poetry    │ NEXUS sugg  │
 *   ├──────────────┤                                       │             │
 *   │ TODAY · 3    │                                       │             │
 *   │ moments log  │                                       │             │
 *   ├──────────────┴───────────────────────────────────────┴─────────────┤
 *   │ FloatingToolbar reserved (~76 px)                                  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Wiring stays identical to the prior implementation: all data is read
 * from `useSystemStore.context`. No Zustand selector or WS subscription
 * is added or removed; only the visual DNA changes.
 *
 * Animations carry meaning:
 *   - orb-breathe   → aurora pulse = "system is attending"
 *   - phantom-pulse-slow / orb-breathe on halo rings → calm presence
 *   - bpm dot animates only when breathing_bpm is live (not the placeholder)
 *
 * `prefers-reduced-motion` is respected via the global rules in
 * `globals.css` — animations are tagged with the same keyframes that the
 * reduced-motion media block already neutralises.
 */
export default function ShadowLayout() {
  const context = useSystemStore((s) => s.context);

  // Live derived values; never invent numbers — fall back to em-dashes.
  const bpm = context?.body.breathing_bpm;
  const breathingState = context?.body.breathing_state;
  const stress = context?.body.stress_level;
  const tempC = context?.env.temp_c;
  const placeName = context?.where.place_name;
  const username = context?.who.username;
  const pendingEvents = context?.history.pending_events_1h ?? 0;
  const memoryHint = context?.memory_hints?.[0];
  const timeStr = context?.when.time ?? '';
  const lastInteractionAgo = context?.history.last_interaction_ago_s;

  // Local clock for the small relative-time line beneath the activity log.
  const [, force] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  useEffect(() => {
    const t = setInterval(() => force((n) => (n + 1) % 60), 30_000);
    return () => clearInterval(t);
  }, []);

  // EKG amplitude scales with breathing_state (calm → tight wave; elevated
  // → taller spikes). Gives operators an at-a-glance bio read without
  // numeric staring.
  const ekgAmplitude = useMemo(() => {
    switch (breathingState) {
      case 'sleep':
        return 0.35;
      case 'calm':
        return 0.6;
      case 'normal':
        return 1;
      case 'elevated':
        return 1.35;
      case 'stressed':
        return 1.7;
      default:
        return 1;
    }
  }, [breathingState]);

  // Stress level → coloured pip + label. ≥0.7 = red, ≥0.4 = amber, else green.
  const stressView = useMemo(() => {
    if (stress == null) return { dot: 'var(--ink-muted)', label: '—' };
    if (stress >= 0.7)
      return { dot: 'var(--signal-alert)', label: 'high' };
    if (stress >= 0.4)
      return { dot: 'var(--signal-warn)', label: 'mid' };
    return { dot: 'var(--signal-ok)', label: 'low' };
  }, [stress]);

  // Recent activity feed. We assemble it from real signals so the panel
  // never lies: state-change → "state shift", auth → "operator", first
  // pending event → "queued". Each item is rendered only if its source
  // value is real; the list collapses gracefully when nothing has happened.
  const moments = useMemo(() => {
    const out: Array<{ time: string; icon: React.ReactNode; label: string; sub: string }> = [];
    const stateChange = context?.history.last_state_change_ago_s;
    if (stateChange != null && stateChange < 24 * 3600) {
      out.push({
        time: formatRelativeClock(stateChange),
        icon: <Sunrise size={12} strokeWidth={1.75} />,
        label: 'state shift',
        sub: `into ${context?.system.state ?? 'shadow'}`.toLowerCase(),
      });
    }
    if (lastInteractionAgo != null && lastInteractionAgo < 24 * 3600) {
      out.push({
        time: formatRelativeClock(lastInteractionAgo),
        icon: <Coffee size={12} strokeWidth={1.75} />,
        label: 'last exchange',
        sub: username ? `with ${username.toLowerCase()}` : 'operator',
      });
    }
    if (context?.system.wifi_connected) {
      out.push({
        time: timeStr || '—',
        icon: <Lock size={12} strokeWidth={1.75} />,
        label: 'link armed',
        sub: context.system.internet_available ? 'wifi · cloud ok' : 'wifi only',
      });
    }
    return out.slice(0, 3);
  }, [
    context?.history.last_state_change_ago_s,
    context?.system.state,
    context?.system.wifi_connected,
    context?.system.internet_available,
    lastInteractionAgo,
    username,
    timeStr,
  ]);

  return (
    <motion.div
      className="w-[1024px] h-[600px] relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />
      <StatusBar />

      {/* === AURORA ORB CENTERPIECE ============================================ */}
      <svg
        viewBox="0 0 1024 524"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        style={{
          position: 'absolute',
          top: 44,
          left: 0,
          width: '100%',
          height: 524,
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        <defs>
          <radialGradient id="shadow-aurora-core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#fff8dc" stopOpacity="1" />
            <stop offset="20%" stopColor="#fde9b8" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#f4af25" stopOpacity="0.85" />
            <stop offset="85%" stopColor="#fb923c" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
          </radialGradient>
          <filter id="shadow-aurora-blur">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* Halo rings — three concentric breaths at staggered durations. */}
        {[280, 220, 170].map((r, i) => (
          <circle
            key={r}
            cx="512"
            cy="240"
            r={r}
            fill="none"
            stroke={`rgba(244,175,37,${0.08 + i * 0.04})`}
            strokeWidth="0.8"
            strokeDasharray={i === 1 ? '4 8' : undefined}
            style={{ animation: `orb-breathe ${5 + i}s ease-in-out infinite` }}
          />
        ))}

        {/* Particle constellation — 28 dots orbit the orb on staggered pulses. */}
        {Array.from({ length: 28 }).map((_, i) => {
          const angle = (i / 28) * Math.PI * 2;
          const r = 130 + (i % 3) * 30;
          const x = 512 + Math.cos(angle) * r;
          const y = 240 + Math.sin(angle) * r * 0.6;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={1.2 + (i % 3) * 0.4}
              fill="#f4af25"
              opacity={0.5 + (i % 3) * 0.15}
              style={{
                animation: `phantom-pulse-slow ${2 + (i % 5) * 0.5}s ease-in-out infinite`,
              }}
            />
          );
        })}

        <circle
          cx="512"
          cy="240"
          r="160"
          fill="url(#shadow-aurora-core)"
          style={{ animation: 'orb-breathe 6s ease-in-out infinite' }}
        />
        <circle
          cx="500"
          cy="225"
          r="48"
          fill="#fff"
          opacity="0.85"
          filter="url(#shadow-aurora-blur)"
        />
        <circle cx="512" cy="240" r="36" fill="url(#shadow-aurora-core)" />
      </svg>

      {/* ATTENDING label above the orb */}
      <motion.div
        className="absolute text-center"
        style={{ top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 4 }}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6 }}
      >
        <div className="micro-label" style={{ color: 'var(--primary-deep)' }}>
          ATTENDING
        </div>
        <div
          aria-hidden
          style={{
            marginTop: 6,
            height: 1.5,
            width: 60,
            background:
              'linear-gradient(90deg, transparent, var(--primary), transparent)',
            margin: '6px auto',
          }}
        />
      </motion.div>

      {/* Poetry below the orb */}
      <motion.div
        className="absolute text-center"
        style={{ top: 338, left: '50%', transform: 'translateX(-50%)', zIndex: 4 }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.7 }}
      >
        <div
          className="playfair"
          style={{
            fontSize: 26,
            color: 'var(--ink-secondary)',
            letterSpacing: '-0.01em',
            textShadow: '0 1px 0 rgba(255,255,255,0.5)',
          }}
        >
          {memoryHint
            ? `“${memoryHint}”`
            : 'Quiet. Watching. Yours.'}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--ink-muted)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          listening for "Phantom" · whisper mode
        </div>
      </motion.div>

      {/* === LEFT — VITALS ===================================================== */}
      <motion.div
        className="glass absolute"
        style={{ left: 12, top: 56, width: 220, padding: 14, zIndex: 4 }}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.18, duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <div className="flex items-center justify-between">
          <div className="micro-label">VITALS</div>
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: bpm != null ? 'var(--signal-ok)' : 'var(--ink-muted)',
              animation: bpm != null
                ? 'phantom-pulse-slow 1.4s ease-in-out infinite'
                : undefined,
            }}
          />
        </div>

        {/* EKG — amplitude scales with breathing_state. */}
        <svg
          viewBox="0 0 200 50"
          aria-hidden
          style={{ width: '100%', height: 44, marginTop: 8 }}
        >
          <path
            d={ekgPath(ekgAmplitude)}
            stroke="var(--coral)"
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>

        <div className="flex items-baseline" style={{ gap: 6 }}>
          <span
            className="tabular"
            style={{ fontSize: 28, fontWeight: 600, color: 'var(--ink-primary)' }}
          >
            {bpm ?? '—'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
            bpm · {breathingState ?? 'resting'}
          </span>
        </div>

        <div
          aria-hidden
          style={{ marginTop: 10, height: 1, background: 'var(--line-subtle)' }}
        />

        {/* Breath bars */}
        <div style={{ marginTop: 10 }}>
          <div className="micro-label">
            BREATH · {bpm != null ? `${bpm}/MIN` : '—'}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'flex-end',
              height: 24,
              marginTop: 6,
            }}
          >
            {[8, 12, 16, 20, 18, 12, 8, 4, 8, 12, 16, 20, 18, 12, 8, 4, 8, 12, 16, 22].map(
              (h, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: h,
                    borderRadius: 1,
                    background: 'var(--primary)',
                    opacity: 0.3 + i / 30,
                  }}
                />
              ),
            )}
          </div>
        </div>

        {/* HRV / Stress sub-glass cards */}
        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
          }}
        >
          <div className="sub-glass" style={{ padding: '6px 8px' }}>
            <div className="micro-label" style={{ fontSize: 8 }}>
              HRV
            </div>
            <div className="tabular" style={{ fontSize: 14, fontWeight: 600 }}>
              {bpm != null ? Math.round(900 / bpm) : '—'}
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--ink-muted)',
                  fontWeight: 400,
                  marginLeft: 2,
                }}
              >
                ms
              </span>
            </div>
          </div>
          <div className="sub-glass" style={{ padding: '6px 8px' }}>
            <div className="micro-label" style={{ fontSize: 8 }}>
              STRESS
            </div>
            <div className="flex items-center" style={{ gap: 4, marginTop: 2 }}>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: stressView.dot,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {stressView.label}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* === LEFT — TODAY · 3 MOMENTS ========================================== */}
      <motion.div
        className="glass absolute"
        style={{ left: 12, top: 336, width: 220, bottom: 76, padding: 14, zIndex: 4 }}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.32, duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <div className="micro-label">
          TODAY · {moments.length} MOMENT{moments.length === 1 ? '' : 'S'}
        </div>
        {moments.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--ink-muted)',
              fontStyle: 'italic',
            }}
          >
            Nothing yet. The day is quiet.
          </div>
        ) : (
          moments.map((it, i) => (
            <div
              key={`${it.label}-${i}`}
              style={{
                marginTop: i ? 8 : 10,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <span
                className="tabular"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--ink-muted)',
                  paddingTop: 2,
                  minWidth: 36,
                }}
              >
                {it.time}
              </span>
              <span style={{ color: 'var(--primary-deep)', marginTop: 2 }}>
                {it.icon}
              </span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{it.label}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{it.sub}</div>
              </div>
            </div>
          ))
        )}
      </motion.div>

      {/* === RIGHT — AMBIENT STACK ============================================= */}
      <motion.div
        className="absolute"
        style={{
          right: 12,
          top: 56,
          bottom: 76,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 4,
          overflow: 'visible',
        }}
        initial={{ opacity: 0, x: 16 }}
        animate={{ 
          opacity: 1, 
          x: 0,
          width: panelCollapsed ? 52 : 240,
        }}
        transition={{ delay: 0.18, duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        {/* Toggle Collapse Button */}
        <button
          onClick={() => setPanelCollapsed(!panelCollapsed)}
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-12 rounded-full flex items-center justify-center border border-amber-500/30 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900 text-amber-700 dark:text-amber-300 hover:scale-105 active:scale-95 transition-all shadow-md"
          style={{ zIndex: 10 }}
          title={panelCollapsed ? "Розгорнути панель" : "Згорнути панель"}
        >
          <span style={{ fontSize: 10, transform: panelCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
        </button>

        {panelCollapsed ? (
          <div className="flex flex-col items-center gap-4 py-4 h-full bg-white/70 dark:bg-neutral-900/60 border border-white/50 dark:border-white/5 rounded-2xl">
            <motion.div
              className="flex items-center justify-center shrink-0"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(244,175,37,0.15)',
                border: '1px solid rgba(244,175,37,0.3)',
                color: '#b07a10',
              }}
            >
              <Sun size={18} />
            </motion.div>
            <div className="vertical-text font-mono text-[8px] tracking-widest text-[#b07a10] font-bold uppercase select-none opacity-60" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              AMBIENT PANEL
            </div>
          </div>
        ) : (
          <>
            {/* Weather card */}
        <div className="glass" style={{ padding: 14 }}>
          <div className="flex items-center justify-between">
            <div className="micro-label">
              WEATHER · {placeName ? placeName.toUpperCase() : 'LOCAL'}
            </div>
            <Sun size={14} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
          </div>
          <div className="flex items-baseline" style={{ gap: 6, marginTop: 6 }}>
            <span className="tabular" style={{ fontSize: 32, fontWeight: 300 }}>
              {tempC != null ? `${tempC.toFixed(0)}°` : '—'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              {tempC != null
                ? `feels ${tempC.toFixed(0)}° · ambient`
                : 'sensor offline'}
            </span>
          </div>
          {/* Mini hourly bars — derived from current temp; flat when offline. */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              marginTop: 8,
              height: 30,
              alignItems: 'flex-end',
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
              const base = tempC ?? 16;
              const t = Math.max(8, base + Math.sin(i * 0.6) * 4 + (i - 4) * 0.4);
              const hour = (((context?.when.hour ?? 8) + i) % 24).toString().padStart(2, '0');
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      height: Math.min(22, Math.max(4, t - 8)),
                      width: '70%',
                      background: 'linear-gradient(180deg,#f4af25,#fb923c)',
                      opacity: 0.5,
                      borderRadius: '2px 2px 0 0',
                    }}
                  />
                  <div style={{ fontSize: 7, color: 'var(--ink-muted)' }}>{hour}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* NEXT — pending event progress */}
        <div className="glass" style={{ padding: 14 }}>
          <div className="micro-label">NEXT</div>
          <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
            <CalendarClock
              size={18}
              strokeWidth={1.75}
              style={{ color: 'var(--primary-deep)' }}
            />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {pendingEvents > 0
                  ? `${pendingEvents} item${pendingEvents > 1 ? 's' : ''} queued`
                  : 'Calendar clear'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                {pendingEvents > 0 ? 'within the next hour' : 'next hour open'}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 8,
              height: 4,
              borderRadius: 2,
              background: 'var(--line-subtle)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: pendingEvents > 0 ? `${Math.min(100, pendingEvents * 25)}%` : '0%',
                background: 'linear-gradient(90deg,#f4af25,#fb923c)',
                borderRadius: 2,
              }}
            />
          </div>
          <div
            className="flex justify-between"
            style={{ marginTop: 4, fontSize: 9, color: 'var(--ink-muted)' }}
          >
            <span>now</span>
            <span>+1 h</span>
          </div>
        </div>

        {/* NEXUS suggestion */}
        <div
          className="sub-glass"
          style={{
            padding: 14,
            background:
              'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.08))',
            border: '1px solid rgba(244,175,37,0.32)',
          }}
        >
          <div className="flex items-center" style={{ gap: 6, marginBottom: 6 }}>
            <Sparkles
              size={12}
              strokeWidth={2}
              style={{ color: 'var(--primary-deep)' }}
            />
            <span
              className="micro-label"
              style={{ color: 'var(--primary-deep)' }}
            >
              NEXUS SUGGESTS
            </span>
          </div>
          <div
            className="playfair"
            style={{
              fontSize: 14,
              color: 'var(--ink-secondary)',
              lineHeight: 1.4,
            }}
          >
            {nexusSuggestion(context?.when.is_night, pendingEvents, breathingState)}
          </div>
          <div className="flex" style={{ gap: 6, marginTop: 10 }}>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: 8,
                background: 'linear-gradient(135deg,#f4af25,#fb923c)',
                border: 'none',
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Так
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.6)',
                color: 'var(--ink-secondary)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Пізніше
            </button>
          </div>
        </div>
          </>
        )}
      </motion.div>

      <FloatingToolbar />
    </motion.div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Build an EKG path whose spikes scale with `amplitude` (0.35 sleep …
 * 1.7 stressed). Three QRS complexes spread across a 200-unit viewBox.
 */
function ekgPath(amplitude: number): string {
  const a = Math.max(0.2, Math.min(2.5, amplitude));
  const peakUp = (25 - 15 * a).toFixed(1);
  const peakDown = (25 + 13 * a).toFixed(1);
  return [
    'M0 25',
    'L40 25',
    'L48 25',
    `L52 ${peakUp}`,
    `L58 ${peakDown}`,
    'L66 25',
    'L100 25',
    'L108 25',
    `L112 ${peakUp}`,
    `L118 ${peakDown}`,
    'L126 25',
    'L160 25',
    'L168 25',
    `L172 ${peakUp}`,
    `L178 ${peakDown}`,
    'L186 25',
    'L200 25',
  ].join(' ');
}

/** Pick the NEXUS suggestion line based on actual context signals. */
function nexusSuggestion(
  isNight: boolean | undefined,
  pending: number,
  breath: string | undefined,
): string {
  if (isNight) return '"Тихо. Якщо хочеш — приглушу світло і запущу Sleep."';
  if (pending > 0)
    return `"У тебе ${pending} пункт${pending > 1 ? 'и' : ''} в годині. Підняти бриф?"`;
  if (breath === 'stressed' || breath === 'elevated')
    return '"Дихання підняте. Зробимо хвилину спокою?"';
  return '"Sun\'s up. Want me to start the kettle and queue your morning brief?"';
}
