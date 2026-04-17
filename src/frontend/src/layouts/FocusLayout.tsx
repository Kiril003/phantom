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
 * FOCUS — SYSTEM_CORE composition.
 * Left panel: CPU / RAM / ENV / SPATIAL cards in glass chrome.
 * Centre: Orb hovering inside a halo.
 * Right panel: SYS_LOG (recent activity) + CAM preview placeholder.
 */
export default function FocusLayout() {
  const context = useSystemStore((s) => s.context);

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
        {/* Left — system cards */}
        <section className="col-span-3 flex flex-col gap-3 min-h-0">
          <SectionLabel>SYSTEM_CORE</SectionLabel>

          <Card>
            <CardHead icon={<Cpu size={14} strokeWidth={1.75} />} label="CPU" />
            <Gauge1 value={context?.system.cpu_percent ?? 0} unit="%" />
          </Card>

          <Card>
            <CardHead icon={<MemoryStick size={14} strokeWidth={1.75} />} label="RAM" />
            <Gauge1 value={context?.system.ram_percent ?? 0} unit="%" />
          </Card>

          <Card>
            <CardHead icon={<HardDrive size={14} strokeWidth={1.75} />} label="Disk" />
            <Gauge1 value={context?.system.disk_percent ?? 0} unit="%" />
          </Card>

          <SectionLabel>ENVIRONMENT</SectionLabel>
          <Card>
            <CardRow
              icon={<Thermometer size={14} strokeWidth={1.75} />}
              label="Temp"
              value={context?.env.temp_c != null ? `${context.env.temp_c.toFixed(1)}°C` : '—'}
            />
            <CardRow
              icon={<Wind size={14} strokeWidth={1.75} />}
              label="AQI"
              value={context?.env.aqi != null ? String(context.env.aqi) : '—'}
            />
            <CardRow
              icon={<Activity size={14} strokeWidth={1.75} />}
              label="BPM"
              value={context?.body.breathing_bpm != null ? `${context.body.breathing_bpm}` : '—'}
            />
          </Card>
        </section>

        {/* Centre — orb */}
        <section className="col-span-6 flex flex-col items-center justify-center relative">
          <Orb size="lg" />

          <motion.div
            className="mt-6 flex flex-col items-center gap-2 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <p
              className="text-gradient"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xl)',
                fontWeight: 300,
                letterSpacing: 'var(--tracking-tight)',
              }}
            >
              {context?.where.place_name ?? 'Focus engaged'}
            </p>
            <p
              className="italic"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--ink-secondary)',
                maxWidth: 320,
              }}
            >
              {context?.history.pending_events_1h != null && context.history.pending_events_1h > 0
                ? `${context.history.pending_events_1h} thing${context.history.pending_events_1h > 1 ? 's' : ''} waiting for you in the next hour.`
                : 'All clear in the next hour. Deep work window.'}
            </p>
          </motion.div>
        </section>

        {/* Right — spatial / log */}
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
            />
            <CardRow
              icon={<Gauge size={14} strokeWidth={1.75} />}
              label="Static"
              value={context?.body.static_energy != null ? String(context.body.static_energy) : '—'}
            />
          </Card>

          <SectionLabel>SYS_LOG</SectionLabel>
          <Card className="flex-1">
            <LogLine tone="ok" message="Context engine: online" sub="just now" />
            <LogLine tone="info" message="Memory index: ready" sub="12s" />
            <LogLine tone="info" message="Serial bridge: scanning" sub="48s" />
            <LogLine tone="muted" message="Wardriving: idle" sub="2m" />
          </Card>
        </section>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}

/* ─── Primitives ──────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="uppercase"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        color: 'var(--ink-muted)',
        letterSpacing: 'var(--tracking-widest)',
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`glass-card flex flex-col gap-2 ${className}`}
      style={{
        borderRadius: 16,
        padding: '10px 12px',
      }}
    >
      {children}
    </div>
  );
}

function CardHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2" style={{ color: 'var(--ink-secondary)' }}>
      <span style={{ color: 'var(--accent)' }}>{icon}</span>
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          letterSpacing: 'var(--tracking-widest)',
          color: 'var(--ink-secondary)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function CardRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: 'var(--ink-muted)' }}>{icon}</span>
      <span
        className="flex-1 uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Gauge1({ value, unit }: { value: number; unit?: string }) {
  const color =
    value > 85 ? 'var(--signal-alert)' :
    value > 60 ? 'var(--signal-warn)' :
    'var(--accent)';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            color,
            letterSpacing: 'var(--tracking-tight)',
            lineHeight: 1,
          }}
        >
          {Math.round(value)}
        </span>
        {unit && (
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
            width: `${Math.max(3, Math.min(100, value))}%`,
            background: color,
            borderRadius: 9999,
            boxShadow: `0 0 8px ${color}`,
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
    tone === 'info'  ? 'var(--accent)' :
    'var(--ink-muted)';
  return (
    <div className="flex items-start gap-2 py-0.5">
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
            color: 'var(--ink-primary)',
          }}
        >
          {message}
        </p>
        {sub && (
          <p
            className="tabular-nums"
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
