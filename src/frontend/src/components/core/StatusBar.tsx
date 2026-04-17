import { useEffect, useState } from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useFaceStore } from '../../stores/faceStore';
import { SystemState } from '@shared/types';
import {
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  Activity,
  Thermometer,
  Cpu,
  MemoryStick,
  HardDrive,
  User as UserIcon,
  Sparkles,
  UserCheck,
  HelpCircle,
} from 'lucide-react';
import { OledEyePreview } from './OledEyePreview';

const STATE_LABELS: Record<SystemState, string> = {
  [SystemState.SHADOW]: 'Shadow',
  [SystemState.FOCUS]: 'Focus',
  [SystemState.DIALOGUE]: 'Dialogue',
  [SystemState.SENTINEL]: 'Sentinel',
  [SystemState.GHOST]: 'Ghost',
  [SystemState.DREAM]: 'Dream',
};

/**
 * StatusBar — 36px glass strip with rounded pill segments.
 * Icons from lucide; labels in Space Grotesk with subtle tracking.
 * Hidden in GHOST / DREAM per VISUAL_SYSTEM.md (stealth / offline modes).
 */
export function StatusBar() {
  const { state, wsConnected, context, esp32 } = useSystemStore();
  const { user } = useAuthStore();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (state === SystemState.GHOST || state === SystemState.DREAM) return null;

  const bpm = context?.body.breathing_bpm;
  const tempC = context?.env.temp_c;
  const cpu = context?.system.cpu_percent;
  const ram = context?.system.ram_percent;
  const disk = context?.system.disk_percent;
  const provider = context?.system.ai_provider ?? '—';
  /* ESP32 tri-state comes from /health polling; fallback derived from sensor data. */
  const esp32DerivedOnline = bpm != null || tempC != null;
  const esp32Effective: 'disabled' | 'offline' | 'online' | 'unknown' =
    esp32 === 'unknown' && esp32DerivedOnline ? 'online' : esp32;

  return (
    <div
      className="w-[1024px] flex items-center shrink-0 relative gap-2 px-4 glass-panel"
      style={{
        height: 'var(--status-bar-h)',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        opacity: 'var(--ui-opacity)',
      }}
    >
      {/* State pill (left-most) */}
      <StatePill state={state} />

      <Divider />

      {/* Operator */}
      {user && (
        <>
          <Segment
            icon={<UserIcon size={12} strokeWidth={2} />}
            label={user.username}
            sub={user.role}
          />
          <Divider />
        </>
      )}

      {/* Biosignal */}
      <Segment
        icon={<Activity size={12} strokeWidth={2} />}
        value={bpm != null ? `${bpm}` : '—'}
        unit="bpm"
      />
      <Divider />

      {/* Environment */}
      <Segment
        icon={<Thermometer size={12} strokeWidth={2} />}
        value={tempC != null ? tempC.toFixed(1) : '—'}
        unit="°C"
      />
      <Divider />

      {/* ESP32 tri-state pill: disabled (muted) / offline (amber) / online (green) */}
      {esp32Effective !== 'unknown' && <Esp32Pill status={esp32Effective} />}
      {esp32Effective !== 'unknown' && <Divider />}

      <div className="flex-1" />

      {/* Resource load (CPU/RAM/Disk come from Radxa psutil — these are live locally even without ESP32) */}
      <Resource icon={<Cpu size={12} strokeWidth={2} />} label="CPU" pct={cpu} />
      <Resource icon={<MemoryStick size={12} strokeWidth={2} />} label="RAM" pct={ram} />
      <Resource icon={<HardDrive size={12} strokeWidth={2} />} label="Disk" pct={disk} />

      <Divider />

      {/* AI */}
      <Segment
        icon={<Sparkles size={12} strokeWidth={2} />}
        label={provider}
        capitalize
      />

      <Divider />

      {/* Face recognition chip (visible only while tracking is active) */}
      <FaceChip />

      {/* OLED eye preview — mirrors the hardware face animator */}
      <OledEyePreview />

      <Divider />

      {/* Connectivity */}
      <ConnectivityDot ok={!!context?.system.wifi_connected} Icon={{ on: Wifi, off: WifiOff }} />
      <ConnectivityDot ok={!!context?.system.internet_available} Icon={{ on: Cloud, off: CloudOff }} />
      <div
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: wsConnected ? 'var(--signal-ok)' : 'var(--signal-alert)',
          boxShadow: wsConnected
            ? '0 0 6px var(--signal-ok)'
            : '0 0 6px var(--signal-alert)',
        }}
        title={wsConnected ? 'Realtime connected' : 'Realtime offline'}
      />

      <Divider />

      {/* Time */}
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-primary)',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        {timeStr}
      </span>
    </div>
  );
}

function FaceChip() {
  const recognized = useFaceStore((s) => s.recognized);
  const unknownSince = useFaceStore((s) => s.unknownSince);
  const detection = useFaceStore((s) => s.lastDetection);

  // Only render when a face has been seen recently; otherwise the chip
  // flickers every time the detector briefly loses track.
  const active = !!detection || !!recognized || !!unknownSince;
  if (!active) return null;

  const matched = !!recognized;
  const color = matched
    ? 'var(--signal-ok)'
    : unknownSince
      ? 'var(--signal-warn)'
      : 'var(--ink-muted)';
  const label = matched
    ? recognized.username
    : unknownSince
      ? 'Unknown'
      : 'Scanning';

  const Icon = matched ? UserCheck : HelpCircle;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 rounded-full"
      style={{
        height: 20,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        color,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tracking-wider)',
      }}
      title={
        matched
          ? `Recognized ${recognized.username} at ${(recognized.confidence * 100).toFixed(0)}%`
          : unknownSince
            ? 'Face detected but no enrolled user matched'
            : 'Face detector online'
      }
    >
      <Icon size={11} strokeWidth={2} />
      {label}
    </span>
  );
}

function Esp32Pill({ status }: { status: 'disabled' | 'offline' | 'online' }) {
  const color =
    status === 'online'
      ? 'var(--signal-ok)'
      : status === 'offline'
        ? 'var(--signal-warn)'
        : 'var(--ink-muted)';
  const label =
    status === 'online' ? 'ESP32 online' : status === 'offline' ? 'ESP32 offline' : 'ESP32 disabled';
  const title =
    status === 'online'
      ? 'Serial bridge connected; sensor batches incoming'
      : status === 'offline'
        ? 'Serial bridge enabled but no ESP32 device connected'
        : 'Serial bridge disabled (dev mode or no hardware)';
  return (
    <span
      className="uppercase px-2 rounded-full inline-flex items-center gap-1.5"
      style={{
        height: 20,
        lineHeight: '18px',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        color,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tracking-widest)',
      }}
      title={title}
    >
      <span
        aria-hidden
        className="rounded-full"
        style={{
          width: 5,
          height: 5,
          background: color,
          boxShadow: status === 'online' ? `0 0 6px ${color}` : 'none',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

function StatePill({ state }: { state: SystemState }) {
  return (
    <div
      className="flex items-center gap-2 px-3 rounded-full"
      style={{
        height: 24,
        minHeight: 24,
        background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
        boxShadow: 'inset 0 0 12px color-mix(in srgb, var(--accent) 18%, transparent)',
      }}
    >
      <span
        aria-hidden
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: 'var(--accent)',
          boxShadow: '0 0 8px var(--accent-glow)',
          animation: state === SystemState.SENTINEL
            ? 'pulse-state 0.6s ease-in-out infinite'
            : 'pulse-state 2s ease-in-out infinite',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--accent)',
          letterSpacing: 'var(--tracking-widest)',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        {STATE_LABELS[state]}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="block self-center"
      style={{ width: 1, height: 14, background: 'var(--line-default)' }}
    />
  );
}

interface SegmentProps {
  icon?: React.ReactNode;
  label?: string;
  value?: string;
  unit?: string;
  sub?: string;
  capitalize?: boolean;
}

function Segment({ icon, label, value, unit, sub, capitalize }: SegmentProps) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && (
        <span style={{ color: 'var(--ink-muted)' }} className="inline-flex">
          {icon}
        </span>
      )}
      {value && (
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
      )}
      {unit && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
          }}
        >
          {unit}
        </span>
      )}
      {label && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-primary)',
            textTransform: capitalize ? 'capitalize' : 'none',
          }}
        >
          {label}
        </span>
      )}
      {sub && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
          }}
        >
          · {sub}
        </span>
      )}
    </div>
  );
}

function Resource({
  icon,
  label,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  pct: number | undefined;
}) {
  const hasValue = typeof pct === 'number' && Number.isFinite(pct);
  const v = hasValue ? (pct as number) : 0;
  const color = !hasValue
    ? 'var(--ink-muted)'
    : v > 85
      ? 'var(--signal-alert)'
      : v > 60
        ? 'var(--signal-warn)'
        : 'var(--ink-primary)';
  const width = Math.max(3, Math.min(100, v));
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: 'var(--ink-muted)' }}>{icon}</span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        {label}
      </span>
      <span
        className="block"
        style={{
          width: 28,
          height: 3,
          borderRadius: 9999,
          background: 'var(--line-subtle)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span
          className="block absolute left-0 top-0 bottom-0"
          style={{
            width: hasValue ? `${width}%` : '0%',
            background: color,
            borderRadius: 9999,
          }}
        />
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color,
          minWidth: 20,
          textAlign: 'right',
        }}
      >
        {hasValue ? Math.round(v) : '—'}
      </span>
    </div>
  );
}

function ConnectivityDot({
  ok,
  Icon,
}: {
  ok: boolean;
  Icon: {
    on: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
    off: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  };
}) {
  const Component = ok ? Icon.on : Icon.off;
  return (
    <span
      className="inline-flex items-center"
      style={{ color: ok ? 'var(--signal-ok)' : 'var(--ink-muted)' }}
    >
      <Component size={12} strokeWidth={2} />
    </span>
  );
}
