import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { Avatar } from '../components/core/Avatar';
import { TacticalMap } from '../components/map/TacticalMap';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';
import {
  Activity,
  Thermometer,
  Wind,
  Wifi,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
} from 'lucide-react';

/**
 * FOCUS — Workspace active.
 * UI: workspace + mini sidebar.
 * AI: may initiate priority 3-5.
 * Voice: wake word + keyword detection.
 * OLED: current state / mini-info.
 */
export default function FocusLayout() {
  const context = useSystemStore((s) => s.context);

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-deep)' }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <StatusBar />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — mini context panel */}
        <motion.aside
          className="w-[200px] h-full flex flex-col border-r p-3 gap-3"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--line-subtle)',
          }}
          initial={{ x: -200 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
        >
          {/* Avatar */}
          <div className="flex justify-center py-2">
            <Avatar size={72} />
          </div>

          {/* Context cards */}
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
            {/* Body */}
            <ContextCard
              icon={<Activity size={14} strokeWidth={1.5} />}
              label="Body"
              value={context?.body.breathing_bpm != null
                ? `${context.body.breathing_bpm} bpm`
                : '—'}
              sub={context?.body.breathing_state ?? ''}
            />

            {/* Environment */}
            <ContextCard
              icon={<Thermometer size={14} strokeWidth={1.5} />}
              label="Temp"
              value={context?.env.temp_c != null ? `${context.env.temp_c.toFixed(1)}°C` : '—'}
            />
            <ContextCard
              icon={<Wind size={14} strokeWidth={1.5} />}
              label="AQI"
              value={context?.env.aqi != null ? `${context.env.aqi}` : '—'}
            />

            {/* Network */}
            <ContextCard
              icon={<Wifi size={14} strokeWidth={1.5} />}
              label="WiFi"
              value={context?.system.wifi_connected ? 'Connected' : 'Off'}
            />

            {/* Time info */}
            <ContextCard
              icon={<Clock size={14} strokeWidth={1.5} />}
              label="Time"
              value={context?.when.time ?? '—'}
              sub={context?.when.work_hours ? 'Work hours' : 'Off hours'}
            />

            {/* System resources */}
            <div className="mt-auto flex flex-col gap-1 pt-2 border-t" style={{ borderColor: 'var(--line-subtle)' }}>
              <ResourceBar
                icon={<Cpu size={12} strokeWidth={1.5} />}
                label="CPU"
                percent={context?.system.cpu_percent ?? 0}
              />
              <ResourceBar
                icon={<MemoryStick size={12} strokeWidth={1.5} />}
                label="RAM"
                percent={context?.system.ram_percent ?? 0}
              />
              <ResourceBar
                icon={<HardDrive size={12} strokeWidth={1.5} />}
                label="Disk"
                percent={context?.system.disk_percent ?? 0}
              />
            </div>
          </div>
        </motion.aside>

        {/* Main workspace — TacticalMap */}
        <main className="flex-1 h-full min-w-0 overflow-hidden relative">
          <TacticalMap />
          {/* Overlay chip: mode + active location */}
          <div
            className="absolute top-3 right-3 flex flex-col items-end gap-1 pointer-events-none z-10"
          >
            <span
              className="font-mono tracking-[0.3em] px-2 py-1 rounded"
              style={{
                color: 'var(--ink-muted)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--line-subtle)',
                fontSize: 'var(--fs-micro)',
              }}
            >
              FOCUS MODE
            </span>
            {context?.where.place_name && (
              <span
                className="font-mono px-2 py-1 rounded"
                style={{
                  color: 'var(--ink-secondary)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--line-subtle)',
                  fontSize: 'var(--fs-micro)',
                }}
              >
                {context.where.place_name}
              </span>
            )}
            {context?.history.pending_events_1h != null && context.history.pending_events_1h > 0 && (
              <span
                className="font-mono px-2 py-1 rounded"
                style={{
                  color: 'var(--signal-warn)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--signal-warn)',
                  fontSize: 'var(--fs-micro)',
                }}
              >
                {context.history.pending_events_1h} event{context.history.pending_events_1h > 1 ? 's' : ''} in next hour
              </span>
            )}
          </div>
        </main>
      </div>
    </motion.div>
  );
}

function ContextCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="flex items-start gap-2 p-2 rounded"
      style={{ background: 'var(--surface-glass)' }}
    >
      <div style={{ color: 'var(--accent)', marginTop: 1 }}>{icon}</div>
      <div className="flex flex-col min-w-0">
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{label}</span>
        <span className="font-mono" style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-xs)' }}>
          {value}
        </span>
        {sub && (
          <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

function ResourceBar({
  icon,
  label,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number;
}) {
  const color = percent > 85 ? 'var(--signal-alert)' : percent > 60 ? 'var(--signal-warn)' : 'var(--accent)';

  return (
    <div className="flex items-center gap-1.5">
      <div style={{ color: 'var(--ink-muted)' }}>{icon}</div>
      <span className="font-mono w-[28px]" style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>
        {label}
      </span>
      <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--line-subtle)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percent, 100)}%` }}
          transition={{ duration: 0.8, ease: EASE_PHANTOM as unknown as number[] }}
        />
      </div>
      <span className="font-mono w-[30px] text-right" style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>
        {percent.toFixed(0)}%
      </span>
    </div>
  );
}
