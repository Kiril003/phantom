import { useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useFaceStore } from '../../stores/faceStore';
import { useAgentStore } from '../../stores/agentStore';
import { agentApi } from '../../services/agentApi';
import { SystemState } from '@shared/types';
import { OledEyePreview } from './OledEyePreview';

/**
 * StatusBar (sunrise build).
 *
 * Layout (44px tall, .glass strip):
 *   [State pill] · [Operator avatar+name] · [HR] · [°C] · [RAM] · [CPU] · [Disk]
 *   · [provider] · [proactive] · [BG track] · [face chip] · [oled eye]
 *   · [wifi/cloud/ws dots] · [tabular clock]
 *
 * Hidden in GHOST / DREAM (stealth / sleep).
 *
 * Design DNA references:
 *   - .glass / .status-pill / .micro-label / .tabular / Material Symbols Outlined
 *   - tokens: var(--ink-*), var(--accent), var(--signal-*), var(--font-*).
 *
 * Hook order: every hook MUST run before the GHOST/DREAM early-return so the
 * order stays stable across renders (audit fix H-MM-1).
 */

const STATE_LABELS: Record<SystemState, string> = {
  [SystemState.SHADOW]: 'Shadow',
  [SystemState.FOCUS]: 'Focus',
  [SystemState.DIALOGUE]: 'Dialogue',
  [SystemState.SENTINEL]: 'Sentinel',
  [SystemState.GHOST]: 'Ghost',
  [SystemState.DREAM]: 'Dream',
  [SystemState.OPERATOR]: 'Operator',
};

/** State → status-pill tone (amber default, coral for SENTINEL/GHOST, green for OPERATOR). */
function stateTone(state: SystemState): 'amber' | 'coral' | 'green' {
  if (state === SystemState.SENTINEL || state === SystemState.GHOST) return 'coral';
  if (state === SystemState.OPERATOR) return 'green';
  return 'amber';
}

/** Material Symbols Outlined inline glyph. */
function MSym({
  name,
  size = 16,
  fill = 0,
  weight = 400,
  color,
}: {
  name: string;
  size?: number;
  fill?: 0 | 1;
  weight?: 300 | 400 | 500 | 600;
  color?: string;
}) {
  return (
    <span
      className="msym"
      aria-hidden
      style={{
        fontSize: size,
        lineHeight: 1,
        color,
        fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}

export function StatusBar() {
  const { state, wsConnected, context, esp32 } = useSystemStore();
  const { user } = useAuthStore();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Audit H-MM-1 fix — every hook runs BEFORE the GHOST/DREAM early-return so
  // the hook order remains stable. Pre-fix the early-return ran before
  // useRouterStatePolled() and React tripped on "Rendered fewer hooks than
  // expected" the first time GHOST mounted.
  const routerState = useRouterStatePolled();

  if (state === SystemState.GHOST || state === SystemState.DREAM) return null;

  const bpm = context?.body.breathing_bpm;
  const tempC = context?.env.temp_c;
  const cpu = context?.system.cpu_percent;
  const ram = context?.system.ram_percent;
  const disk = context?.system.disk_percent;
  const provider = context?.system.ai_provider ?? '—';

  // ESP32 tri-state from /health polling; fall back to "online" once we see
  // sensor data even if the explicit tri-state is still unknown.
  const esp32DerivedOnline = bpm != null || tempC != null;
  const esp32Effective: 'disabled' | 'offline' | 'online' | 'unknown' =
    esp32 === 'unknown' && esp32DerivedOnline ? 'online' : esp32;

  const timeStr = now.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const tone = stateTone(state);
  const operatorName = user?.username ?? 'guest';
  const operatorRole = user?.role ?? 'GUEST';

  return (
    <div
      data-testid="status-bar"
      className="glass w-[1024px] flex items-center shrink-0 relative"
      style={{
        height: 'var(--status-bar-h)',
        padding: '0 14px',
        gap: 10,
        borderRadius: 0,
        // Override .glass border-radius: the status-bar is a flush strip at top.
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        opacity: 'var(--ui-opacity)',
      }}
    >
      {/* ── State pill ──────────────────────────────────────────────── */}
      <span
        className={`status-pill ${tone === 'coral' ? 'coral' : tone === 'green' ? 'green' : ''}`}
        style={{ height: 26 }}
        title={`State: ${STATE_LABELS[state]}`}
      >
        <span className="dot" aria-hidden />
        {STATE_LABELS[state]}
      </span>

      <Divider />

      {/* ── Operator avatar + name ──────────────────────────────────── */}
      <span className="inline-flex items-center" style={{ gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 8px rgba(244,175,37,0.35)',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-primary)',
          }}
        >
          {operatorName}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--ink-muted)',
          }}
        >
          · {operatorRole}
        </span>
      </span>

      <Divider />

      {/* ── Sensor chips ────────────────────────────────────────────── */}
      <SensorChip
        icon="favorite"
        value={bpm != null ? `${bpm}` : '—'}
        unit="bpm"
        accent="#b07a10"
        title={bpm != null ? `Heart rate: ${bpm} bpm` : 'Heart rate not available'}
      />
      <SensorChip
        icon="device_thermostat"
        value={tempC != null ? tempC.toFixed(1) : '—'}
        unit="°C"
        accent="#b07a10"
        title={tempC != null ? `Ambient ${tempC.toFixed(1)} °C` : 'Temperature offline'}
      />
      <SensorChip
        icon="memory"
        value={ram != null ? `${Math.round(ram)}` : '—'}
        unit="%"
        accent={pctTone(ram)}
        title={`RAM ${ram != null ? Math.round(ram) + '%' : 'unknown'}`}
      />
      <SensorChip
        icon="developer_board"
        value={cpu != null ? `${Math.round(cpu)}` : '—'}
        unit="%"
        accent={pctTone(cpu)}
        title={`CPU ${cpu != null ? Math.round(cpu) + '%' : 'unknown'}`}
      />
      <SensorChip
        icon="storage"
        value={disk != null ? `${Math.round(disk)}` : '—'}
        unit="%"
        accent={pctTone(disk)}
        title={`Disk ${disk != null ? Math.round(disk) + '%' : 'unknown'}`}
      />

      {/* ESP32 tri-state pill: only render if known. */}
      {esp32Effective !== 'unknown' && (
        <>
          <Divider />
          <Esp32Pill status={esp32Effective} />
        </>
      )}

      <Divider />

      {/* ── Provider status ─────────────────────────────────────────── */}
      <ProviderBadge provider={provider} routerState={routerState} />

      <Divider />

      {/* ── Proactive breathing dot ─────────────────────────────────── */}
      <ProactiveIndicator />

      {/* ── Background-track badge (only when activity) ─────────────── */}
      <BackgroundTrackSection />

      {/* ── Face recognition chip ───────────────────────────────────── */}
      <FaceChip />

      {/* ── OLED eye preview (mirrors hardware face animator) ───────── */}
      <OledEyePreview />

      <span style={{ flex: 1 }} />

      {/* ── Connectivity dots ───────────────────────────────────────── */}
      <ConnectivityIcon
        ok={!!context?.system.wifi_connected}
        iconOn="wifi"
        iconOff="wifi_off"
        label="WiFi"
      />
      <ConnectivityIcon
        ok={!!context?.system.internet_available}
        iconOn="cloud_done"
        iconOff="cloud_off"
        label="Internet"
      />
      <span
        aria-hidden
        title={wsConnected ? 'Realtime connected' : 'Realtime offline'}
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: wsConnected ? 'var(--signal-ok)' : 'var(--signal-alert)',
          boxShadow: wsConnected
            ? '0 0 8px var(--signal-ok)'
            : '0 0 6px var(--signal-alert)',
        }}
      />

      <Divider />

      {/* ── Clock — large tabular ───────────────────────────────────── */}
      <span
        className="tabular"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: 'var(--ink-primary)',
        }}
      >
        {timeStr}
      </span>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function pctTone(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'var(--ink-muted)';
  if (v > 85) return 'var(--signal-alert)';
  if (v > 60) return 'var(--signal-warn)';
  return '#b07a10';
}

function Divider() {
  return (
    <span
      aria-hidden
      className="block self-center"
      style={{ width: 1, height: 16, background: 'var(--line-default)' }}
    />
  );
}

interface SensorChipProps {
  icon: string;
  value: string;
  unit?: string;
  accent?: string;
  title?: string;
}

function SensorChip({ icon, value, unit, accent, title }: SensorChipProps) {
  return (
    <span
      title={title}
      className="inline-flex items-center"
      style={{
        gap: 6,
        padding: '0 8px',
        height: 26,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset',
      }}
    >
      <MSym name={icon} size={14} color={accent ?? 'var(--ink-muted)'} />
      <span
        className="tabular"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
      {unit && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            color: 'var(--ink-muted)',
          }}
        >
          {unit}
        </span>
      )}
    </span>
  );
}

function Esp32Pill({ status }: { status: 'disabled' | 'offline' | 'online' }) {
  const tone =
    status === 'online'
      ? 'green'
      : status === 'offline'
        ? 'amber'
        : 'amber';
  const label =
    status === 'online' ? 'ESP32' : status === 'offline' ? 'ESP32 off' : 'ESP32 ·';
  const title =
    status === 'online'
      ? 'Serial bridge connected; sensor batches incoming'
      : status === 'offline'
        ? 'Serial bridge enabled but no ESP32 device connected'
        : 'Serial bridge disabled (dev mode or no hardware)';
  const muted = status === 'disabled';
  return (
    <span
      className={`status-pill ${tone === 'green' ? 'green' : ''}`}
      style={{
        height: 22,
        opacity: muted ? 0.55 : 1,
        fontSize: 9,
        padding: '2px 8px',
      }}
      title={title}
    >
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}

function FaceChip() {
  const recognized = useFaceStore((s) => s.recognized);
  const unknownSince = useFaceStore((s) => s.unknownSince);
  const detection = useFaceStore((s) => s.lastDetection);

  // Render only when something has been seen recently — otherwise the chip
  // flickers every time the detector loses track for a frame.
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

  return (
    <>
      <Divider />
      <span
        className="inline-flex items-center"
        style={{
          gap: 6,
          padding: '0 8px',
          height: 22,
          borderRadius: 999,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
          color,
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
        title={
          matched
            ? `Recognized ${recognized.username} at ${(recognized.confidence * 100).toFixed(0)}%`
            : unknownSince
              ? 'Face detected but no enrolled user matched'
              : 'Face detector online'
        }
      >
        <MSym name={matched ? 'face_6' : 'face'} size={12} fill={matched ? 1 : 0} color={color} />
        {label}
      </span>
    </>
  );
}

/* ─── Provider badge ─────────────────────────────────────────────── */

import type { RouterStateSnapshot } from '../../services/agentApi';
import { deriveProviderSummary } from '../../utils/providerSummary';

function useRouterStatePolled(): RouterStateSnapshot | null {
  const [state, setState] = useState<RouterStateSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await agentApi.routerState();
        if (!cancelled) setState(snap);
      } catch {
        // 401 (logged-out) or backend down — silently keep last value.
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return state;
}

function ProviderBadge({
  provider,
  routerState,
}: {
  provider: string;
  routerState: RouterStateSnapshot | null;
}) {
  const summary = useMemo(
    () => deriveProviderSummary(provider, routerState),
    [provider, routerState],
  );
  return (
    <span
      className="inline-flex items-center"
      style={{ gap: 6 }}
      title={summary.tooltip}
    >
      <MSym name="auto_awesome" size={13} color="var(--ink-muted)" />
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: summary.color,
          boxShadow: `0 0 6px ${summary.color}`,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          color: 'var(--ink-primary)',
          textTransform: 'capitalize',
          fontWeight: 600,
        }}
      >
        {summary.label}
      </span>
      {summary.fallbackArrow && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            color: 'var(--ink-muted)',
          }}
        >
          →
        </span>
      )}
    </span>
  );
}

/* ─── Connectivity dots ──────────────────────────────────────────── */

function ConnectivityIcon({
  ok,
  iconOn,
  iconOff,
  label,
}: {
  ok: boolean;
  iconOn: string;
  iconOff: string;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center"
      title={ok ? `${label} online` : `${label} offline`}
      style={{ color: ok ? 'var(--signal-ok)' : 'var(--ink-muted)' }}
    >
      <MSym name={ok ? iconOn : iconOff} size={14} color="currentColor" />
    </span>
  );
}

/* ─── Background-track badge ─────────────────────────────────────── */

function useAgentStatusPolled(): import('../../services/agentApi').AgentStatusSnapshot | null {
  const [snap, setSnap] = useState<
    import('../../services/agentApi').AgentStatusSnapshot | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await agentApi.status();
        if (!cancelled) setSnap(s);
      } catch {
        // 401 / network — keep last value; the badge will dim until next tick.
      }
    };
    tick();
    const t = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return snap;
}

export interface BackgroundTrackView {
  total: number;        // active + queued
  active: number;       // 0 or 1 in this phase
  queued: number;
  color: string;
  title: string;
  visible: boolean;
}

export function deriveBackgroundTrackView(
  snap: import('../../services/agentApi').AgentStatusSnapshot | null,
): BackgroundTrackView {
  if (!snap) {
    return { total: 0, active: 0, queued: 0, color: 'var(--ink-muted)', title: '', visible: false };
  }
  const active = snap.background.active ? 1 : 0;
  const queued = Math.max(0, snap.background.queue_size || 0);
  const total = active + queued;
  const color = active > 0 ? 'var(--signal-ok)' : 'var(--ink-muted)';
  const origin = snap.background.origin ?? '—';
  const substate = snap.background.substate ?? '—';
  let title: string;
  if (active > 0 && queued > 0) {
    title = `Background: 1 active + ${queued} queued (${origin})`;
  } else if (active > 0) {
    title = `Background: ${origin} — ${substate}`;
  } else if (queued > 0) {
    title = `Background: ${queued} queued`;
  } else {
    title = 'Background: idle';
  }
  return { total, active, queued, color, title, visible: total > 0 };
}

function BackgroundTrackSection() {
  const snap = useAgentStatusPolled();
  const view = deriveBackgroundTrackView(snap);
  if (!view.visible) return null;
  return (
    <>
      <Divider />
      <span
        data-testid="background-track-badge"
        data-count={view.total}
        className="inline-flex items-center"
        style={{
          gap: 4,
          padding: '0 8px',
          height: 22,
          borderRadius: 999,
          background: `color-mix(in srgb, ${view.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${view.color} 40%, transparent)`,
          color: view.color,
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          letterSpacing: '0.10em',
          fontWeight: 700,
        }}
        title={view.title}
      >
        <MSym name="bedtime" size={11} color="currentColor" />
        <span className="tabular">BG: {view.total}</span>
      </span>
    </>
  );
}

/* ─── Proactive breathing indicator ─────────────────────────────── */

function ProactiveIndicator() {
  const proactive = useAgentStore((s) => s.proactive);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const lastCycleMs = proactive.lastCycleAt ? Date.parse(proactive.lastCycleAt) : null;
  const recent = lastCycleMs != null && now - lastCycleMs < 5 * 60 * 1000;
  const status: 'active' | 'cooling' | 'idle' =
    !proactive.enabled && lastCycleMs == null
      ? 'idle'
      : recent
        ? 'active'
        : 'cooling';
  const color =
    status === 'active'
      ? 'var(--signal-ok)'
      : status === 'cooling'
        ? 'var(--ink-muted)'
        : 'var(--ink-faint)';
  const pulse = status === 'active' && proactive.hasTriggers;
  const title =
    status === 'active'
      ? `Proactive: active${proactive.hasTriggers ? ' (triggers pending)' : ''}`
      : status === 'cooling'
        ? 'Proactive: cooling'
        : 'Proactive: idle';
  return (
    <span
      data-testid="proactive-indicator"
      data-status={status}
      className="inline-flex items-center select-none"
      style={{
        color,
        animation: pulse ? 'pulse-state 2s ease-in-out infinite' : undefined,
        opacity: status === 'idle' ? 0.45 : 1,
      }}
      title={title}
    >
      <MSym name="psychology_alt" size={14} color="currentColor" />
    </span>
  );
}
