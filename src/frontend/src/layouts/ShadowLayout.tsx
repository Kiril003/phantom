import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lock,
  Coffee,
  Sunrise,
  Sun,
  Sparkles,
  CalendarClock,
  ChevronRight,
} from 'lucide-react';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { useSystemStore } from '../stores/systemStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { EASE_PHANTOM } from '../styles/motion';
import { formatRelativeClock } from '../utils/format';

const STATE_UA: Record<string, string> = {
  shadow: 'тінь',
  focus: 'фокус',
  dialogue: 'діалог',
  sentinel: 'варту',
  ghost: 'привид',
  dream: 'сон',
};

const BREATH_UA: Record<string, string> = {
  sleep: 'сон',
  calm: 'спокій',
  normal: 'норма',
  elevated: 'підвищене',
  stressed: 'напружене',
};

const HEARING_UA: Record<string, string> = {
  disabled: 'слух вимкнено',
  disconnected: 'слух відключений',
  connecting: 'під’єднуюсь до слуху',
  ready: 'чекаю на «Фантом»',
  listening: 'чекаю на «Фантом»',
  armed: 'слухаю тебе',
  cooldown: 'пауза після відповіді',
  error: 'слух не піднявся',
};

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
  const pressure = context?.env.pressure_hpa;
  const aqi = context?.env.aqi;
  const placeName = context?.where.place_name;
  const username = context?.who.username;
  const pendingEvents = context?.history.pending_events_1h ?? 0;
  const memoryHint = context?.memory_hints?.[0];
  const timeStr = context?.when.time ?? '';
  const lastInteractionAgo = context?.history.last_interaction_ago_s;
  const hearing = useVoiceAlwaysOnStatusStore((s) => s.status);
  const hearingLine = HEARING_UA[hearing] ?? 'слух вимкнено';

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
      return { dot: 'var(--signal-alert)', label: 'високий' };
    if (stress >= 0.4)
      return { dot: 'var(--signal-warn)', label: 'середній' };
    return { dot: 'var(--signal-ok)', label: 'низький' };
  }, [stress]);

  const aqiView = useMemo(() => {
    if (aqi == null) return { dot: 'var(--ink-muted)', label: '—' };
    if (aqi > 100) return { dot: 'var(--signal-alert)', label: 'брудне' };
    if (aqi > 50) return { dot: 'var(--signal-warn)', label: 'помірне' };
    return { dot: 'var(--signal-ok)', label: 'чисте' };
  }, [aqi]);

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
        label: 'зміна стану',
        sub: `перейшов у ${STATE_UA[context?.system.state ?? 'shadow'] ?? 'тінь'}`,
      });
    }
    if (lastInteractionAgo != null && lastInteractionAgo < 24 * 3600) {
      out.push({
        time: formatRelativeClock(lastInteractionAgo),
        icon: <Coffee size={12} strokeWidth={1.75} />,
        label: 'остання розмова',
        sub: username ? `з ${username.toLowerCase()}` : 'оператор',
      });
    }
    if (context?.system.wifi_connected) {
      out.push({
        time: timeStr || '—',
        icon: <Lock size={12} strokeWidth={1.75} />,
        label: 'канал піднято',
        sub: context.system.internet_available ? 'wi-fi · хмара є' : 'лише wi-fi',
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
      className="w-full h-full relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />

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

      {/* Присутність — підпис над орбом */}
      <motion.div
        className="absolute text-center"
        style={{ top: 80, left: 244, right: 264, zIndex: 4 }}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6 }}
      >
        <div className="micro-label" style={{ color: 'var(--primary-deep)' }}>
          ПОРУЧ
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

      {/* Рядок присутності під орбом. Смуга між колонками, а не 50% екрана:
          Framer Motion переписує inline-transform, тож translateX(-50%) тут
          не тримався і текст наїжджав на праву панель. */}
      <motion.div
        className="absolute text-center"
        style={{ top: 338, left: 244, right: 264, zIndex: 4 }}
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
            : 'Тиша. Пильную. Твій.'}
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
          {hearingLine}
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
          <div className="micro-label">ЖИТТЄВІ ПОКАЗНИКИ</div>
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

        <svg
          viewBox="0 0 200 50"
          aria-hidden
          preserveAspectRatio="none"
          style={{ width: '100%', height: 48, marginTop: 8 }}
        >
          <path
            d={breathPath(bpm, ekgAmplitude)}
            stroke={bpm != null ? 'var(--coral)' : 'var(--line-subtle)'}
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
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
            вд/хв · {BREATH_UA[breathingState ?? ''] ?? 'сенсор мовчить'}
          </span>
        </div>

        <div
          aria-hidden
          style={{ marginTop: 10, height: 1, background: 'var(--line-subtle)' }}
        />

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
              ЦИКЛ
            </div>
            <div className="tabular" style={{ fontSize: 14, fontWeight: 600 }}>
              {bpm != null && bpm > 0 ? (60 / bpm).toFixed(1) : '—'}
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--ink-muted)',
                  fontWeight: 400,
                  marginLeft: 2,
                }}
              >
                с
              </span>
            </div>
          </div>
          <div className="sub-glass" style={{ padding: '6px 8px' }}>
            <div className="micro-label" style={{ fontSize: 8 }}>
              СТРЕС
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
        style={{ left: 12, top: 274, width: 220, padding: 14, zIndex: 4 }}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.32, duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <div className="micro-label">СЬОГОДНІ · {moments.length}</div>
        {moments.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--ink-muted)',
              fontStyle: 'italic',
            }}
          >
            Поки нічого. День тихий.
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
          className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center border border-amber-500/25 bg-white/70 hover:bg-amber-100 text-amber-700 active:scale-95 transition-all backdrop-blur-sm"
          style={{ left: -52, width: 44, height: 44, zIndex: 10 }}
          aria-label={panelCollapsed ? 'Розгорнути панель' : 'Згорнути панель'}
          title={panelCollapsed ? 'Розгорнути панель' : 'Згорнути панель'}
        >
          <ChevronRight
            size={16}
            strokeWidth={2}
            style={{
              transform: panelCollapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          />
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
              ОТОЧЕННЯ
            </div>
          </div>
        ) : (
          <>
            {/* Weather card */}
        <div className="glass" style={{ padding: 14 }}>
          <div className="flex items-center justify-between">
            <div className="micro-label">
              ПОВІТРЯ · {placeName ? placeName.toUpperCase() : 'ПОРУЧ'}
            </div>
            <Sun size={14} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
          </div>
          <div className="flex items-baseline" style={{ gap: 6, marginTop: 6 }}>
            <span className="tabular" style={{ fontSize: 32, fontWeight: 300 }}>
              {tempC != null ? `${tempC.toFixed(0)}°` : '—'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              {tempC != null ? 'датчик у кімнаті' : 'датчик мовчить'}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginTop: 10,
            }}
          >
            <div className="sub-glass" style={{ padding: '6px 8px' }}>
              <div className="micro-label" style={{ fontSize: 8 }}>ТИСК</div>
              <div className="tabular" style={{ fontSize: 13, fontWeight: 600 }}>
                {pressure != null ? pressure.toFixed(0) : '—'}
                <span style={{ fontSize: 9, color: 'var(--ink-muted)', fontWeight: 400, marginLeft: 2 }}>
                  гПа
                </span>
              </div>
            </div>
            <div className="sub-glass" style={{ padding: '6px 8px' }}>
              <div className="micro-label" style={{ fontSize: 8 }}>ПОВІТРЯ</div>
              <div className="flex items-center" style={{ gap: 4, marginTop: 2 }}>
                <span
                  aria-hidden
                  style={{ width: 6, height: 6, borderRadius: 999, background: aqiView.dot }}
                />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{aqiView.label}</span>
              </div>
            </div>
          </div>
        </div>

        {/* NEXT — pending event progress */}
        <div className="glass" style={{ padding: 14 }}>
          <div className="micro-label">ДАЛІ</div>
          <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
            <CalendarClock
              size={18}
              strokeWidth={1.75}
              style={{ color: 'var(--primary-deep)' }}
            />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {pendingEvents > 0
                  ? `${pendingEvents} ${pluralUa(pendingEvents, 'подія', 'події', 'подій')}`
                  : 'Календар вільний'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                {pendingEvents > 0 ? 'протягом години' : 'найближча година вільна'}
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
            <span>зараз</span>
            <span>+1 год</span>
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
              NEXUS РАДИТЬ
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
    </motion.div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Дихальна хвиля за 30 секунд: період — з виміряної частоти, висота — зі
 * стану дихання. Без сигналу лінія рівна: радар міряє дихання, а не серце,
 * тож QRS-комплекс тут був би вигадкою про природу даних.
 */
function breathPath(bpm: number | null | undefined, amplitude: number): string {
  if (bpm == null || bpm <= 0) return 'M0 25 L200 25';
  const a = Math.max(0.2, Math.min(2.5, amplitude));
  const cycles = Math.max(0.5, (bpm / 60) * 30);
  const pts: string[] = [];
  for (let x = 0; x <= 200; x += 2) {
    const y = 25 - Math.sin((x / 200) * cycles * Math.PI * 2) * 16 * a * 0.6;
    pts.push(`${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Pick the NEXUS suggestion line based on actual context signals. */
function nexusSuggestion(
  isNight: boolean | undefined,
  pending: number,
  breath: string | undefined,
): string {
  if (isNight) return '«Тихо. Якщо хочеш — приглушу світло і переведу в сон.»';
  if (pending > 0)
    return `«У тебе ${pending} ${pluralUa(pending, 'пункт', 'пункти', 'пунктів')} в найближчій годині. Підняти бриф?»`;
  if (breath === 'stressed' || breath === 'elevated')
    return '«Дихання підняте. Зробимо хвилину спокою?»';
  return '«Ранок. Зібрати тобі короткий бриф на день?»';
}

/** Українське відмінювання числівників: 1 подія, 2 події, 5 подій. */
function pluralUa(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
