import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Eye,
  Volume2,
  Thermometer,
  Activity,
  TrendingDown,
  Megaphone,
  Video,
  Check,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * SENTINEL — sunrise build (phase-5-R1-FE-L2).
 *
 * Repaint of the threat-assessment surface against the warm-cream design DNA.
 * Wiring is unchanged — it still reads `presence`, `body.motion_energy`,
 * `body.static_energy`, `where`, `when` from `useSystemStore` and renders
 * a coral-tinted radar + alert panel. Visual scaffolding follows the
 * `screen-6-sentinel.jsx` Claude design handoff:
 *   - phantom-frame + coral-tint + flash-coral overlay (1.2s loop)
 *   - 480px central radar SVG with 4 distance rings, crosshair, 8 angle
 *     labels, two opposing sweep beams, intruder trail with 4 fading
 *     dots, "YOU" red orb at centre, detected presence orb with
 *     phantom-pulse 0.9s and red annotation tooltip
 *   - bottom-left location chip, right alert panel (380px) with shield
 *     header, DISTANCE/MOTION mini-cards, PRESENCE/AUDIO/IR/STATIC rows,
 *     ANOMALIES dashed panel, ALARM/RECORD/DISMISS action buttons.
 *
 * Hook-order (audit H-MM-1) preserved: every `useSystemStore` selector
 * runs unconditionally before any render branch.
 */
const RADAR_RINGS = [
  { r: 60, label: '0,3 м' },
  { r: 120, label: '1,1 м' },
  { r: 180, label: '2 м' },
  { r: 220, label: '2,5 м' },
];

export default function SentinelLayout() {
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const context = useSystemStore((s) => s.context);

  const otherDetected = context?.presence.other_detected ?? false;
  const otherDistance = context?.presence.other_distance_cm ?? null;
  const motionEnergy = context?.body.motion_energy ?? null;
  const staticEnergy = context?.body.static_energy ?? null;
  const firstVisit = context?.where.first_visit ?? false;
  const isNight = context?.when.is_night ?? false;
  const placeName =
    context?.where.place_name ??
    (context?.where.lat != null && context?.where.lon != null
      ? `${context.where.lat.toFixed(4)}, ${context.where.lon.toFixed(4)}`
      : 'Невідома локація');
  const lastScan = context?.when.time ?? '—';

  // Раніше в розмітці стояло «ЗАГРОЗА ВИЯВЛЕНА · конфіденс 0.91» — панель
  // кричала про загрозу навіть коли всі датчики мовчали.
  const alert = useMemo(() => {
    if (!otherDetected) {
      return {
        title: 'ЧИСТО',
        detail: motionEnergy != null || staticEnergy != null
          ? 'Радар пильнує · нікого поруч'
          : 'Радар без сигналу · дані не надходять',
      };
    }
    const seen = [
      'радар',
      motionEnergy != null && motionEnergy > 0 ? 'рух' : null,
      staticEnergy != null && staticEnergy > 70 ? 'шум' : null,
    ].filter(Boolean);
    const near = otherDistance != null ? ` · ${(otherDistance / 100).toFixed(1)} м` : '';
    return { title: 'ХТОСЬ ПОРУЧ', detail: `${seen.join(' + ')}${near}` };
  }, [otherDetected, otherDistance, motionEnergy, staticEnergy]);

  // Drive the detected-presence radar marker from real distance telemetry.
  // Distance compresses logarithmically so a 5 m / 50 cm spread reads on the
  // same canvas. 220px is the outermost ring radius; we map 30 cm → centre,
  // ≥ 250 cm → edge so very-close intruders don't fall behind the YOU orb.
  const intruderRadius = useMemo(() => {
    if (otherDistance == null) return 132; // sit on the second ring by default
    const clamped = Math.max(30, Math.min(250, otherDistance));
    const t = (clamped - 30) / (250 - 30);
    return 60 + t * 160; // 60..220 px from centre
  }, [otherDistance]);

  // 45° angle from the design handoff — keep the visual fixed but allow the
  // computed radius to shrink as distance closes. SVG y-axis is inverted, so
  // we negate sin for the screen-space coordinates.
  const intruderX = 240 + Math.cos((45 - 90) * (Math.PI / 180)) * intruderRadius;
  const intruderY = 240 + Math.sin((45 - 90) * (Math.PI / 180)) * intruderRadius;

  return (
    <motion.div
      // Панель уже казала «ЧИСТО», а екран при цьому лишався залитим
      // тривожним червоним — колір кричав небезпеку, поки текст казав, що
      // все спокійно. Тепер тон іде за станом, а не стоїть намертво.
      className={`w-full h-full min-w-[1024px] min-h-full sunrise-frame relative overflow-hidden ${
        otherDetected ? 'coral-tint' : ''
      }`}
      style={{ background: otherDetected ? 'var(--surface-coral)' : 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_PHANTOM as unknown as number[] }}
    >
      {/* Пульсуючий червоний спалах доречний лише коли справді хтось поруч.
          Він блимав завжди — і привчав не вірити тривозі. */}
      {otherDetected && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none animate-flash-coral"
          style={{
            background: 'rgba(239,68,68,0.12)',
            zIndex: 'var(--z-overlay)',
          }}
        />
      )}

      {/* === LEFT — RADAR === */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: 0,
          top: 68,
          bottom: 76,
          width: 640,
          zIndex: 3,
          // Каркас радара намальовано тривожним червоним у 49 місцях. Поки
          // нікого немає, знебарвлюємо його цілком — це чесний вигляд стану
          // спокою і не потребує правити кожен літерал окремо.
          filter: otherDetected ? undefined : 'saturate(0.28) opacity(0.82)',
          transition: 'filter 600ms ease',
        }}
      >
        <div className="relative" style={{ width: 480, height: 480 }}>
          <svg
            viewBox="0 0 480 480"
            className="absolute inset-0 w-full h-full"
            aria-hidden
          >
            <defs>
              <radialGradient id="sentinel-radar-bg" cx="50%" cy="50%">
                <stop offset="0%" stopColor="rgba(239,68,68,0.06)" />
                <stop offset="100%" stopColor="rgba(239,68,68,0)" />
              </radialGradient>
              <radialGradient id="sentinel-center-orb" cx="35%" cy="30%">
                <stop offset="0%" stopColor="#fda4af" />
                <stop offset="60%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#7f1d1d" />
              </radialGradient>
            </defs>

            <circle cx="240" cy="240" r="220" fill="url(#sentinel-radar-bg)" />

            {/* Підписи кілець беруться з тієї ж шкали, що й мітка порушника
                (30…250 см ⇒ 60…220 px). Раніше стояло 50–200 м — радар
                обіцяв дальність у сто разів більшу за сенсор. */}
            {RADAR_RINGS.map(({ r, label }, i) => (
              <g key={`ring-${r}`}>
                <circle
                  cx="240"
                  cy="240"
                  r={r}
                  fill="none"
                  stroke="rgba(239,68,68,0.32)"
                  strokeWidth="1"
                  strokeDasharray={i === 1 ? '4 6' : ''}
                />
                {/* Підписи кілець стояли по центру, тобто просто НА вертикальній
                    осі, а найвищий ще й точно під міткою «0°». Зсуваємо їх
                    ліворуч від осі й вирівнюємо по правому краю. */}
                <text
                  x="228"
                  y={240 - r - 5}
                  fontSize="9"
                  fill="rgba(185,32,31,0.7)"
                  textAnchor="end"
                  fontWeight="600"
                  letterSpacing="1"
                >
                  {label}
                </text>
              </g>
            ))}

            {/* Crosshair + diagonals */}
            <line x1="20" y1="240" x2="460" y2="240" stroke="rgba(239,68,68,0.18)" strokeWidth="0.6" />
            <line x1="240" y1="20" x2="240" y2="460" stroke="rgba(239,68,68,0.18)" strokeWidth="0.6" />
            <line x1="69" y1="69" x2="411" y2="411" stroke="rgba(239,68,68,0.10)" strokeWidth="0.5" />
            <line x1="411" y1="69" x2="69" y2="411" stroke="rgba(239,68,68,0.10)" strokeWidth="0.5" />

            {/* 8 angle labels around the perimeter */}
            {['0°', '45°', '90°', '135°', '180°', '225°', '270°', '315°'].map(
              (a, i) => {
                const rad = (i * 45 - 90) * (Math.PI / 180);
                const x = 240 + Math.cos(rad) * 232;
                const y = 240 + Math.sin(rad) * 232;
                return (
                  <text
                    key={a}
                    x={x}
                    y={y + 3}
                    fontSize="8"
                    fill="rgba(185,32,31,0.5)"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {a}
                  </text>
                );
              },
            )}

            {/* Primary 4s sweep beam */}
            <g
              style={{
                transformOrigin: '240px 240px',
                animation: 'radar-sweep 4s linear infinite',
              }}
            >
              <path
                d="M 240 240 L 240 20 A 220 220 0 0 1 380 80 Z"
                fill="rgba(239,68,68,0.16)"
              />
              <line
                x1="240"
                y1="240"
                x2="240"
                y2="20"
                stroke="rgba(239,68,68,0.7)"
                strokeWidth="2"
              />
            </g>

            {/* Reverse 9s slow secondary beam */}
            <g
              style={{
                transformOrigin: '240px 240px',
                animation: 'radar-sweep 9s linear infinite reverse',
                opacity: 0.5,
              }}
            >
              <line
                x1="240"
                y1="240"
                x2="240"
                y2="20"
                stroke="rgba(239,68,68,0.4)"
                strokeWidth="1"
              />
            </g>

            {/* Intruder trajectory trail — 4 fading dots */}
            <path
              d="M 380 100 L 360 130 L 345 160 L 335 185 L 332 200"
              fill="none"
              stroke="rgba(239,68,68,0.55)"
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
            {[100, 130, 160, 185].map((y, i) => (
              <circle
                key={`trail-${i}`}
                cx={380 - i * 16}
                cy={y + i * 8}
                r="2.5"
                fill="#ef4444"
                opacity={0.3 + i * 0.15}
              />
            ))}

            {/* Centre red orb — YOU */}
            <circle cx="240" cy="240" r="22" fill="url(#sentinel-center-orb)" />
            <circle
              cx="240"
              cy="240"
              r="22"
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
            />
            <text
              x="240"
              y="244"
              fontSize="9"
              fontWeight="700"
              fill="white"
              textAnchor="middle"
              letterSpacing="1"
            >
              ТИ
            </text>

            {/* Detected presence — only when sensors actually report it */}
            {otherDetected && (
              <g
                style={{
                  transformOrigin: `${intruderX}px ${intruderY}px`,
                  animation: 'phantom-pulse 0.9s ease-in-out infinite',
                }}
              >
                <circle cx={intruderX} cy={intruderY} r="22" fill="rgba(239,68,68,0.2)" />
                <circle cx={intruderX} cy={intruderY} r="14" fill="rgba(239,68,68,0.4)" />
                <circle
                  cx={intruderX}
                  cy={intruderY}
                  r="8"
                  fill="#ef4444"
                  stroke="white"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>

          {/* Annotation tooltip — appears next to the detected orb */}
          {otherDetected && (
            <div
              className="absolute"
              style={{
                top: intruderY - 22,
                left: intruderX + 22,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(239,68,68,0.92)',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                boxShadow: '0 4px 14px rgba(239,68,68,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              UNKNOWN · {otherDistance != null ? `${otherDistance} cm` : '— cm'} · 45°
              <span
                aria-hidden
                className="absolute"
                style={{
                  left: -5,
                  top: 12,
                  width: 0,
                  height: 0,
                  borderTop: '4px solid transparent',
                  borderBottom: '4px solid transparent',
                  borderRight: '5px solid rgba(239,68,68,0.92)',
                }}
              />
            </div>
          )}
        </div>

        {/* Чип місця стояв на bottom:20 — рівно під плавучим доком, який його
            і накривав. Док сидить на 76, тож піднімаємо чип над ним. */}
        <div
          className="sub-glass absolute inline-flex items-center gap-2"
          style={{
            bottom: 96,
            left: 20,
            padding: '8px 12px',
            border: otherDetected
              ? '1px solid rgba(239,68,68,0.25)'
              : '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <MapPin size={14} style={{ color: '#b9201f' }} />
          <span
            className="playfair"
            style={{ fontSize: 13, color: 'var(--ink-secondary)' }}
          >
            {placeName}
            {isNight ? ' · нічний режим' : ''}
          </span>
        </div>
      </div>

      {/* === RIGHT — ALERT PANEL === */}
      <motion.aside
        className="glass absolute flex flex-col gap-2"
        style={{
          right: 12,
          top: 68,
          bottom: 76,
          borderRadius: 18,
          borderColor: 'rgba(239,68,68,0.4)',
          background: 'rgba(255,255,255,0.78)',
          boxShadow: 'var(--shadow-glow-coral)',
          zIndex: 4,
          overflow: 'hidden',
        }}
        initial={{ x: 24, opacity: 0 }}
        animate={{ 
          x: 0, 
          opacity: 1,
          width: panelCollapsed ? 52 : 380,
          padding: panelCollapsed ? 8 : 16,
        }}
        transition={{ duration: 0.3, ease: EASE_PHANTOM as unknown as number[] }}
      >
        {/* Toggle Collapse Button */}
        <button
          onClick={() => setPanelCollapsed(!panelCollapsed)}
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-12 rounded-full flex items-center justify-center border border-red-500/30 bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 text-red-700 dark:text-red-300 hover:scale-105 active:scale-95 transition-all shadow-md"
          style={{ zIndex: 10 }}
          title={panelCollapsed ? "Розгорнути панель" : "Згорнути панель"}
        >
          <span style={{ fontSize: 10, transform: panelCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
        </button>

        {panelCollapsed ? (
          <div className="flex flex-col items-center gap-4 py-4 h-full">
            <motion.div
              className="flex items-center justify-center shrink-0"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#b9201f',
              }}
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ShieldAlert size={18} strokeWidth={2} />
            </motion.div>
            <div className="vertical-text font-mono text-[8px] tracking-widest text-[#b9201f] font-bold uppercase select-none opacity-60" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              ВАРТА
            </div>
          </div>
        ) : (
          <>
            {/* Щит пульсував тривожним червоним і тоді, коли писав «ЧИСТО».
                Тон і пульс тепер ідуть за станом: спокій не блимає. */}
        <div className="flex items-start gap-3">
          <motion.div
            className="flex items-center justify-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: otherDetected ? 'rgba(239,68,68,0.15)' : 'rgba(22,163,74,0.12)',
              border: otherDetected
                ? '1px solid rgba(239,68,68,0.3)'
                : '1px solid rgba(22,163,74,0.28)',
              color: otherDetected ? '#b9201f' : '#15803d',
            }}
            animate={otherDetected ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={{ duration: 1.4, repeat: otherDetected ? Infinity : 0, ease: 'easeInOut' }}
          >
            {otherDetected ? <ShieldAlert size={28} strokeWidth={2} /> : <ShieldCheck size={28} strokeWidth={2} />}
          </motion.div>
          <div className="flex-1 min-w-0">
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.22em',
                // «ЧИСТО», написане кольором тривоги, читається як тривога.
                color: otherDetected ? '#b9201f' : '#15803d',
              }}
            >
              {alert.title}
            </div>
            <div
              className="playfair"
              style={{
                fontSize: 14,
                color: 'var(--ink-secondary)',
                marginTop: 1,
              }}
            >
              {alert.detail}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
        <div className="grid grid-cols-2 gap-2">
          <CoralStatCard
            alarming={otherDetected}
            label="ВІДСТАНЬ"
            value={otherDistance != null ? otherDistance.toString() : '—'}
            unit="см"
            trailingIcon={<TrendingDown size={11} />}

          />
          <CoralStatCard
            alarming={otherDetected}
            label="РУХ"
            value={motionEnergy != null ? Math.round(motionEnergy).toString() : '—'}
            trailingIcon={<Activity size={11} />}
          />
        </div>

        {/* Threat detail rows */}
        <div className="flex flex-col gap-1.5">
          <ThreatRow
            icon={<Eye size={14} />}
            label="ПРИСУТНІСТЬ"
            value={
              otherDetected ? 'Виявлено · силует людини' : 'Чисто · нікого поруч'
            }
            coral={otherDetected}
          />
          <ThreatRow
            icon={<Volume2 size={14} />}
            label="ЗВУК"
            value={
              motionEnergy != null && motionEnergy > 30
                ? `${Math.min(99, Math.round(40 + motionEnergy / 4))} dB · footsteps`
                : '— дБ · фон'
            }
            coral={motionEnergy != null && motionEnergy > 30}
          />
          <ThreatRow
            icon={<Thermometer size={14} />}
            label="IR"
            value={otherDetected ? 'тепле тіло' : 'джерела тепла немає'}
            coral={otherDetected}
          />
          <ThreatRow
            icon={<Activity size={14} />}
            label="СТАТИЧНИЙ ШУМ"
            value={
              staticEnergy != null
                ? `${Math.round(staticEnergy)} · ${staticEnergy > 70 ? 'високий' : 'низький'}`
                : '— · тиша'
            }
            coral={staticEnergy != null && staticEnergy > 70}
          />
        </div>

        {/* Anomalies — dashed coral panel */}
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.06)',
            border: '1px dashed rgba(239,68,68,0.25)',
          }}
        >
          <div
            className="micro-label"
            style={{ color: '#b9201f', marginBottom: 4 }}
          >
            ВІДХИЛЕННЯ
          </div>
          {[
            firstVisit ? 'Уперше в цьому місці' : null,
            isNight ? `Нічний час · ${lastScan}` : null,
            otherDetected && staticEnergy != null && staticEnergy < 20
              ? 'Поряд немає жодного відомого пристрою'
              : null,
          ]
            .filter((s): s is string => s !== null)
            .map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5"
                style={{
                  fontSize: 11,
                  color: '#b9201f',
                  opacity: 0.85,
                  marginTop: 2,
                }}
              >
                <AlertTriangle size={11} />
                <span>{w}</span>
              </div>
            ))}
          {!firstVisit && !isNight && !otherDetected && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-muted)',
                opacity: 0.7,
                marginTop: 2,
              }}
            >
              Відхилень немає — довкола спокійно.
            </div>
          )}
        </div>

        </div>

        {/* Action triplet — закріплений унизу панелі */}
        <div className="flex gap-1.5 shrink-0">
          <ActionButton
            icon={<Megaphone size={14} />}
            label="ТРИВОГА"
            primary
          />
          <ActionButton icon={<Video size={14} />} label="ЗАПИС" />
          <ActionButton icon={<Check size={14} />} label="ЗАКРИТИ" />
        </div>

            {/* Footer — last-scan timestamp */}
            <div
              className="flex items-center justify-between"
              style={{ fontSize: 9, color: 'var(--ink-muted)' }}
            >
              <span>ОСТАННІЙ ОБХІД · {lastScan}</span>
              <span className="mono">sentinel.v0.4</span>
            </div>
          </>
        )}
      </motion.aside>

      {/* Audit H-MM-2 — keep the FloatingToolbar so the operator can
          escape SENTINEL without long-press chord. flash-coral overlay
          above is pointer-events:none, so taps reach the toolbar. */}
    </motion.div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

/** `alarming` — чи справді є кого тривожитись. Картка була рожевою завжди,
 *  тож два порожні прочерки виглядали як два зафіксовані інциденти. */
function CoralStatCard({
  label,
  value,
  unit,
  trailingIcon,
  sparkline,
  bars,
  alarming = true,
}: {
  label: string;
  value: string;
  unit?: string;
  trailingIcon?: React.ReactNode;
  sparkline?: React.ReactNode;
  bars?: number[];
  alarming?: boolean;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: alarming ? 'rgba(239,68,68,0.10)' : 'rgba(0,0,0,0.035)',
        border: alarming ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(0,0,0,0.07)',
      }}
    >
      <div className="micro-label" style={{ color: alarming ? '#b9201f' : 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="tabular"
          style={{ fontSize: 22, fontWeight: 700, color: '#b9201f' }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 10, color: '#b9201f' }}>{unit}</span>
        )}
        <span style={{ marginLeft: 'auto', color: '#b9201f' }}>
          {trailingIcon}
        </span>
      </div>
      {sparkline && (
        <svg viewBox="0 0 80 14" style={{ width: '100%', height: 14, marginTop: 2 }}>
          {sparkline}
        </svg>
      )}
      {bars && (
        <div
          className="flex gap-px items-end"
          style={{ marginTop: 2, height: 14 }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              style={{
                width: 4,
                height: h,
                background: '#ef4444',
                opacity: 0.5 + i * 0.04,
                borderRadius: 1,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreatRow({
  icon,
  label,
  value,
  coral,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  coral: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2.5"
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: coral ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.5)',
        border: `1px solid ${
          coral ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.5)'
        }`,
      }}
    >
      <span style={{ color: coral ? '#b9201f' : '#b07a10' }}>{icon}</span>
      <span
        className="micro-label"
        style={{
          flex: '0 0 100px',
          color: coral ? '#b9201f' : 'var(--ink-muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: coral ? '#b9201f' : 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex-1 inline-flex items-center justify-center gap-1 transition-transform active:scale-95"
      style={{
        padding: '10px',
        borderRadius: 12,
        background: primary
          ? 'linear-gradient(135deg,#ef4444,#b9201f)'
          : 'rgba(255,255,255,0.6)',
        border: primary ? 'none' : '1px solid rgba(0,0,0,0.08)',
        color: primary ? 'white' : 'var(--ink-secondary)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.05em',
        boxShadow: primary ? '0 4px 14px rgba(239,68,68,0.45)' : 'none',
        minHeight: 44,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
