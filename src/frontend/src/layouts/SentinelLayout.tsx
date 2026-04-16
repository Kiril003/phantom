import { motion } from 'framer-motion';
import { StatusBar } from '../components/core/StatusBar';
import { Avatar } from '../components/core/Avatar';
import { useSystemStore } from '../stores/systemStore';
import { EASE_PHANTOM } from '../styles/motion';
import {
  ShieldAlert,
  Radar,
  MapPin,
  Users,
  AlertTriangle,
  Eye,
} from 'lucide-react';

/**
 * SENTINEL — Threat assessment mode.
 * UI: full map + radar card + camera placeholder.
 * Sensors: max sampling rate.
 * AI: threat assessment, recommendations.
 * Voice: voice alerts.
 * RGB: red pulsing.
 * Haptic: alert pattern.
 */
export default function SentinelLayout() {
  const context = useSystemStore((s) => s.context);

  const otherDistance = context?.presence.other_distance_cm;
  const motionEnergy = context?.body.motion_energy ?? 0;
  const staticEnergy = context?.body.static_energy ?? 0;

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-void)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <StatusBar />

      {/* Alert flash overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 'var(--z-overlay)' }}
        animate={{ opacity: [0, 0.06, 0] }}
        transition={{ duration: 0.8, repeat: Infinity }}
      >
        <div className="w-full h-full" style={{ background: 'var(--signal-alert)' }} />
      </motion.div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Map / radar area */}
        <div className="flex-1 h-full relative flex items-center justify-center">
          {/* Radar visualization */}
          <div className="relative">
            <Avatar size={100} />

            {/* Radar rings */}
            {[1, 2, 3].map((ring) => (
              <motion.div
                key={ring}
                className="absolute rounded-full border"
                style={{
                  width: 100 + ring * 80,
                  height: 100 + ring * 80,
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  borderColor: 'var(--signal-alert)',
                  opacity: 0.1 + (3 - ring) * 0.05,
                }}
                animate={{ scale: [1, 1.02, 1] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: ring * 0.3,
                }}
              />
            ))}

            {/* Sweep line */}
            <motion.div
              className="absolute"
              style={{
                width: 2,
                height: 180,
                background: `linear-gradient(to bottom, var(--signal-alert), transparent)`,
                top: '50%',
                left: '50%',
                transformOrigin: 'top center',
                opacity: 0.4,
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            />

            {/* Other presence marker */}
            {context?.presence.other_detected && otherDistance != null && (
              <motion.div
                className="absolute flex items-center justify-center"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: `translate(-50%, -${Math.min(otherDistance / 3, 120)}px)`,
                }}
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'var(--signal-alert)',
                    boxShadow: '0 0 8px var(--signal-alert)',
                  }}
                />
              </motion.div>
            )}
          </div>

          {/* Location info bottom-left */}
          <div
            className="absolute bottom-3 left-3 flex items-center gap-2 px-3 py-2 rounded"
            style={{ background: 'var(--surface-glass)', border: '1px solid var(--line-subtle)' }}
          >
            <MapPin size={14} strokeWidth={1.5} style={{ color: 'var(--signal-alert)' }} />
            <span className="font-mono" style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-xs)' }}>
              {context?.where.place_name ?? (
                context?.where.lat != null
                  ? `${context.where.lat.toFixed(4)}, ${context.where.lon?.toFixed(4)}`
                  : 'Unknown location'
              )}
            </span>
          </div>
        </div>

        {/* Right panel — threat info */}
        <motion.aside
          className="w-[320px] h-full flex flex-col border-l p-3 gap-3"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--signal-alert)',
          }}
          initial={{ x: 320 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.3, ease: EASE_PHANTOM as unknown as number[] }}
        >
          {/* Alert header */}
          <div className="flex items-center gap-2 px-2 py-2">
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 0.6, repeat: Infinity }}
            >
              <ShieldAlert size={20} strokeWidth={2} style={{ color: 'var(--signal-alert)' }} />
            </motion.div>
            <span
              className="font-mono tracking-widest"
              style={{ color: 'var(--signal-alert)', fontSize: 'var(--fs-sm)' }}
            >
              THREAT DETECTED
            </span>
          </div>

          {/* Threat cards */}
          <ThreatCard
            icon={<Users size={16} strokeWidth={1.5} />}
            label="Presence"
            value={context?.presence.other_detected ? 'Detected' : 'None'}
            alert={context?.presence.other_detected ?? false}
          />
          <ThreatCard
            icon={<Radar size={16} strokeWidth={1.5} />}
            label="Distance"
            value={otherDistance != null ? `${otherDistance} cm` : '—'}
            alert={otherDistance != null && otherDistance < 150}
          />
          <ThreatCard
            icon={<AlertTriangle size={16} strokeWidth={1.5} />}
            label="Motion"
            value={`${motionEnergy}`}
            alert={motionEnergy > 50}
          />
          <ThreatCard
            icon={<Eye size={16} strokeWidth={1.5} />}
            label="Static"
            value={`${staticEnergy}`}
            alert={staticEnergy > 70}
          />

          {/* First visit / night context */}
          <div className="flex flex-col gap-1 mt-2 px-2">
            {context?.where.first_visit && (
              <span
                className="font-mono"
                style={{ color: 'var(--signal-warn)', fontSize: 'var(--fs-xs)' }}
              >
                First visit to this location
              </span>
            )}
            {context?.when.is_night && (
              <span
                className="font-mono"
                style={{ color: 'var(--signal-warn)', fontSize: 'var(--fs-xs)' }}
              >
                Night time
              </span>
            )}
          </div>

          {/* Timestamp */}
          <div className="mt-auto px-2">
            <span className="font-mono" style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>
              Last scan: {context?.when.time ?? '—'}
            </span>
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}

function ThreatCard({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  alert: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded"
      style={{
        background: alert ? 'rgba(255,82,82,0.08)' : 'var(--surface-glass)',
        border: `1px solid ${alert ? 'rgba(255,82,82,0.3)' : 'var(--line-subtle)'}`,
      }}
    >
      <div style={{ color: alert ? 'var(--signal-alert)' : 'var(--ink-muted)' }}>{icon}</div>
      <div className="flex-1">
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{label}</span>
      </div>
      <span
        className="font-mono"
        style={{
          color: alert ? 'var(--signal-alert)' : 'var(--ink-primary)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
