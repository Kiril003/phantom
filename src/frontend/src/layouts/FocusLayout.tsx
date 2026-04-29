import { motion } from 'framer-motion';
import {
  Activity,
  Thermometer,
  Wind,
  Radar,
  Cpu,
  MemoryStick,
  HardDrive,
  Gauge,
} from 'lucide-react';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { Orb } from '../components/core/Orb';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * FOCUS — system-core composition, repainted with sunrise design DNA.
 *
 * The prototypes ship two ambient screens (Shadow, Dialogue) plus a
 * tactical Sentinel; Focus has no dedicated mock. Per FE-LAYOUTS-1
 * scope: treat Focus as the "deep work" sibling of Shadow — same warm
 * cream palette and `.glass` panels, but a stronger amber accent on the
 * orb and a tighter ambient stack so the operator can read the system
 * pulse at a glance while staying productive.
 *
 * All Zustand selectors and prop wiring from the prior implementation
 * are preserved verbatim. Only the visual scaffolding is swapped to
 * sunrise: `.glass` / `.sub-glass` chrome, `.micro-label` / `.tabular`
 * typography, amber gauges, and Playfair italic for the centre quote.
 */
export default function FocusLayout() {
  const context = useSystemStore((s) => s.context);
  const wsConnected = useSystemStore((s) => s.wsConnected);
  const esp32 = useSystemStore((s) => s.esp32);

  const cpu = context?.system.cpu_percent;
  const ram = context?.system.ram_percent;
  const disk = context?.system.disk_percent;
  const tempC = context?.env.temp_c;
  const aqi = context?.env.aqi;
  const bpm = context?.body.breathing_bpm;
  const placeName = context?.where.place_name;
  const pending = context?.history.pending_events_1h ?? 0;
  const esp32Disabled = esp32 === 'disabled';
  const esp32Offline = esp32 === 'offline';

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

      <main className="flex-1 grid grid-cols-12 gap-4 px-4 py-4 min-h-0 z-10">
        {/* ─── Left — system + environment ─────────────────────────────── */}
        <section className="col-span-3 flex flex-col gap-3 min-h-0">
          <SectionLabel>SYSTEM_CORE</SectionLabel>

          <Card>
            <CardHead icon={<Cpu size={14} strokeWidth={1.75} />} label="CPU" />
            <Gauge1 value={cpu} unit="%" />
          </Card>

          <Card>
            <CardHead icon={<MemoryStick size={14} strokeWidth={1.75} />} label="RAM" />
            <Gauge1 value={ram} unit="%" />
          </Card>

          <Card>
            <CardHead icon={<HardDrive size={14} strokeWidth={1.75} />} label="DISK" />
            <Gauge1 value={disk} unit="%" />
          </Card>

          <SectionLabel>ENVIRONMENT</SectionLabel>
          <Card>
            <CardRow
              icon={<Thermometer size={14} strokeWidth={1.75} />}
              label="Temp"
              value={tempC != null ? `${tempC.toFixed(1)}°C` : '—'}
              muted={tempC == null}
            />
            <CardRow
              icon={<Wind size={14} strokeWidth={1.75} />}
              label="AQI"
              value={aqi != null ? String(aqi) : '—'}
              muted={aqi == null}
            />
            <CardRow
              icon={<Activity size={14} strokeWidth={1.75} />}
              label="BPM"
              value={bpm != null ? `${bpm}` : '—'}
              muted={bpm == null}
            />
            {(esp32Disabled || esp32Offline) && (
              <div
                className="flex items-center gap-2 mt-1 px-1"
                style={{
                  color: esp32Disabled ? 'var(--ink-muted)' : 'var(--signal-warn)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-micro)',
                  letterSpacing: 'var(--tracking-wider)',
                }}
                title={esp32Disabled ? 'Serial bridge disabled' : 'Serial bridge enabled, no device'}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background: esp32Disabled ? 'var(--ink-muted)' : 'var(--signal-warn)',
                    boxShadow: esp32Disabled ? 'none' : '0 0 4px var(--signal-warn)',
                    display: 'inline-block',
                  }}
                />
                {esp32Disabled ? 'ESP32 disabled' : 'ESP32 offline'}
              </div>
            )}
          </Card>
        </section>

        {/* ─── Centre — orb halo ───────────────────────────────────────── */}
        <section className="col-span-6 flex flex-col items-center justify-center relative">
          {/* Soft amber halo behind the orb — picks up the FOCUS accent
              automatically because it draws from --accent-glow. */}
          <div
            aria-hidden
            className="absolute rounded-full animate-pulse-slow"
            style={{
              width: 380,
              height: 380,
              background: 'var(--accent-glow)',
              filter: 'blur(80px)',
              opacity: 0.55,
            }}
          />

          <Orb size="lg" />

          <motion.div
            className="mt-6 flex flex-col items-center gap-2 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <p
              className="playfair"
              style={{
                fontSize: 26,
                color: 'var(--ink-secondary)',
                letterSpacing: '-0.01em',
                fontWeight: 600,
                textShadow: '0 1px 0 rgba(255,255,255,0.5)',
              }}
            >
              {placeName ?? 'Deep work window'}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                color: 'var(--ink-muted)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {pending > 0
                ? `${pending} thing${pending > 1 ? 's' : ''} queued · stay sharp`
                : 'no interrupts · breath in'}
            </p>
          </motion.div>
        </section>

        {/* ─── Right — spatial + log ───────────────────────────────────── */}
        <section className="col-span-3 flex flex-col gap-3 min-h-0">
          <SectionLabel>SPATIAL</SectionLabel>
          <Card>
            <CardRow
              icon={<Radar size={14} strokeWidth={1.75} />}
              label="Presence"
              value={context?.presence.user_detected ? 'Operator' : 'None'}
            />
            <CardRow
              icon={<Gauge size={14} strokeWidth={1.75} />}
              label="Motion"
              value={context?.body.motion_energy != null ? String(context.body.motion_energy) : '—'}
              muted={context?.body.motion_energy == null}
            />
            <CardRow
              icon={<Gauge size={14} strokeWidth={1.75} />}
              label="Static"
              value={context?.body.static_energy != null ? String(context.body.static_energy) : '—'}
              muted={context?.body.static_energy == null}
            />
          </Card>

          <SectionLabel>SYS_LOG</SectionLabel>
          <Card className="flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              <LogLine
                tone={wsConnected ? 'ok' : 'warn'}
                message={wsConnected ? 'WebSocket hub: online' : 'WebSocket hub: offline'}
                sub="realtime"
              />
              <LogLine
                tone={context ? 'ok' : 'muted'}
                message={context ? 'Context engine: tick 500ms' : 'Context engine: awaiting data'}
                sub={context ? 'live' : '—'}
              />
              <LogLine
                tone={esp32 === 'online' ? 'ok' : esp32 === 'disabled' ? 'muted' : 'warn'}
                message={
                  esp32 === 'online'
                    ? 'ESP32 serial bridge: connected'
                    : esp32 === 'disabled'
                      ? 'ESP32 serial bridge: disabled'
                      : 'ESP32 serial bridge: offline'
                }
                sub={
                  esp32 === 'online'
                    ? 'batched'
                    : esp32 === 'disabled'
                      ? 'dev mode'
                      : 'no batch'
                }
              />
              <LogLine
                tone={context?.system.ai_provider === 'gemini' ? 'info' : 'muted'}
                message={`AI provider: ${context?.system.ai_provider ?? '—'}`}
                sub={context?.system.internet_available ? 'internet' : 'local'}
              />
              <LogLine
                tone="info"
                message={`STT engine: ${context?.system.stt_engine ?? '—'}`}
                sub="voice"
              />
              <LogLine
                tone="muted"
                message={`Uptime: ${formatUptime(context?.system.uptime_s ?? 0)}`}
                sub="now"
              />
            </div>
          </Card>
        </section>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}

/* ─── Primitives (sunrise design DNA) ─────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="micro-label"
      style={{ color: 'var(--primary-deep)', letterSpacing: '0.22em' }}
    >
      {children}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`glass flex flex-col gap-2 ${className}`}
      style={{ padding: '12px 14px' }}
    >
      {children}
    </div>
  );
}

function CardHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: 'var(--primary-deep)' }}>{icon}</span>
      <span className="micro-label">{label}</span>
    </div>
  );
}

function CardRow({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: 'var(--ink-muted)' }}>{icon}</span>
      <span className="flex-1 micro-label" style={{ letterSpacing: '0.18em' }}>
        {label}
      </span>
      <span
        className="tabular"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: muted ? 'var(--ink-muted)' : 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Gauge1({ value, unit }: { value: number | undefined; unit?: string }) {
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  const v = hasValue ? (value as number) : 0;
  const color = !hasValue
    ? 'var(--ink-muted)'
    : v > 85
      ? 'var(--signal-alert)'
      : v > 60
        ? 'var(--signal-warn)'
        : 'var(--primary-deep)';
  const fill = !hasValue
    ? 'var(--ink-muted)'
    : v > 85
      ? 'linear-gradient(90deg,#ef4444,#b9201f)'
      : v > 60
        ? 'linear-gradient(90deg,#f59e0b,#fb923c)'
        : 'linear-gradient(90deg,#f4af25,#fb923c)';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span
          className="tabular"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 600,
            color,
            letterSpacing: 'var(--tracking-tight)',
            lineHeight: 1,
          }}
        >
          {hasValue ? Math.round(v) : '—'}
        </span>
        {unit && hasValue && (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-muted)',
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <span
        className="block overflow-hidden"
        style={{
          height: 4,
          borderRadius: 9999,
          background: 'var(--line-subtle)',
          position: 'relative',
        }}
      >
        <span
          className="block absolute left-0 top-0 bottom-0"
          style={{
            width: hasValue ? `${Math.max(3, Math.min(100, v))}%` : '0%',
            background: fill,
            borderRadius: 9999,
            boxShadow: hasValue ? '0 0 8px rgba(244,175,37,0.45)' : 'none',
          }}
        />
      </span>
    </div>
  );
}

function LogLine({
  tone,
  message,
  sub,
}: {
  tone: 'ok' | 'info' | 'muted' | 'warn' | 'alert';
  message: string;
  sub?: string;
}) {
  const color =
    tone === 'ok'    ? 'var(--signal-ok)' :
    tone === 'warn'  ? 'var(--signal-warn)' :
    tone === 'alert' ? 'var(--signal-alert)' :
    tone === 'info'  ? 'var(--primary-deep)' :
    'var(--ink-muted)';
  const textColor =
    tone === 'muted' ? 'var(--ink-secondary)' : 'var(--ink-primary)';
  return (
    <div className="flex items-start gap-2 py-1">
      <span
        className="block rounded-full shrink-0 mt-1.5"
        style={{ width: 5, height: 5, background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <div className="flex-1 min-w-0">
        <p
          className="truncate"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-xs)',
            color: textColor,
            fontWeight: 500,
            letterSpacing: 'var(--tracking-tight)',
          }}
        >
          {message}
        </p>
        {sub && (
          <p
            className="tabular"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
            }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
