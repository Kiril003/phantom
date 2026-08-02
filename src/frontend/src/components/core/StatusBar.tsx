import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useAgentStore } from '../../stores/agentStore';
import { agentApi } from '../../services/agentApi';
import { SystemState } from '@shared/types';
import { OledEyePreview } from './OledEyePreview';
import { ChromeHandle } from './ChromeHandle';
import { useChromeCollapse } from '../../hooks/useChromeCollapse';
import { PhantomIcon } from './PhantomIcon';

import { useSettingsStore } from '../../stores/settingsStore';

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
  [SystemState.SHADOW]: 'Тінь',
  [SystemState.FOCUS]: 'Фокус',
  [SystemState.DIALOGUE]: 'Діалог',
  [SystemState.SENTINEL]: 'Вартовий',
  [SystemState.GHOST]: 'Привид',
  [SystemState.DREAM]: 'Сон',
  [SystemState.OPERATOR]: 'Оператор',
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
    <PhantomIcon name={name} size={size} weight={weight} filled={fill === 1} color={color} aria-hidden />
  );
}

export function StatusBar() {
  const { state, wsConnected, context, esp32 } = useSystemStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
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

  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const [collapsed, toggleCollapsed] = useChromeCollapse('statusBar');
  if (state === SystemState.GHOST || state === SystemState.DREAM) return null;

  const bpm = context?.body.breathing_bpm;
  const tempC = context?.env.temp_c;
  const cpu = context?.system.cpu_percent;
  const ram = context?.system.ram_percent;
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
  const operatorName = user?.username ?? 'оператор';


  if (collapsed) {
    return (
      <div
        data-testid="status-bar"
        data-compact="true"
        className={`${isPro ? 'bg-black border-b border-white/5' : 'glass'} w-full flex items-center shrink-0 relative overflow-x-auto no-scrollbar`}
        style={{
          height: 24,
          padding: '0 10px',
          gap: 8,
          borderRadius: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          opacity: 'var(--ui-opacity)',
        }}
      >
        <span
          className={`status-pill ${tone === 'coral' ? 'coral' : tone === 'green' ? 'green' : ''} ${isPro ? 'rounded-none' : ''}`}
          style={{ height: 18, fontSize: 9, padding: '1px 6px' }}
          title={`Стан: ${STATE_LABELS[state]}`}
        >
          <span className="dot" aria-hidden />
          {STATE_LABELS[state].toUpperCase()}
        </span>
        <span
          className="tabular"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-primary)',
          }}
        >
          {timeStr}
        </span>
        <span style={{ flex: 1 }} />
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
          label="Інтернет"
        />
        <span
          aria-hidden
          title={wsConnected ? 'Підключено в реальному часі' : 'Офлайн режим'}
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: wsConnected ? 'var(--signal-ok)' : 'var(--signal-alert)',
            boxShadow: (wsConnected && !isPro)
              ? '0 0 6px var(--signal-ok)'
              : 'none',
          }}
        />
        <ChromeHandle
          position="top"
          collapsed={true}
          onToggle={toggleCollapsed}
          label="верхній рядок"
        />
      </div>
    );
  }

  return (
    <div
      data-testid="status-bar"
      className={`${isPro ? 'bg-black border-b border-white/5' : 'glass'} w-full flex items-center shrink-0 relative`}
      style={{
        height: 'var(--status-bar-h)',
        padding: '0 14px',
        gap: 10,
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        opacity: 'var(--ui-opacity)',
      }}
    >
      <span
        className={`status-pill ${tone === 'coral' ? 'coral' : tone === 'green' ? 'green' : ''} ${isPro ? 'rounded-none border border-white/10' : ''}`}
        style={{ height: 26 }}
        title={`Стан: ${STATE_LABELS[state]}`}
      >
        <span className="dot" aria-hidden />
        {STATE_LABELS[state].toUpperCase()}
      </span>

      <Divider />

      <span 
        className="inline-flex items-center cursor-pointer hover:opacity-80 transition-opacity active:scale-[0.98]" 
        style={{ gap: 8 }}
        onClick={() => navigate('/settings/profile')}
        title="Відкрити налаштування профілю"
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: isPro ? 2 : 999,
            background: isPro ? 'var(--ink-faint)' : 'linear-gradient(135deg,#f4af25,#fb923c)',
            boxShadow: isPro ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 8px rgba(244,175,37,0.35)',
            border: isPro ? '1px solid var(--white/10)' : 'none'
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-primary)',
          }}
        >
          {operatorName.toUpperCase()}
        </span>
      </span>

      <Divider />

      {/* Мертвий датчик — не «—» на 80 пікселів, а порожнє місце. */}
      {bpm != null && (
        <SensorChip
          icon="favorite"
          value={`${bpm}`}
          unit="вд/хв"
          accent={isPro ? 'var(--primary)' : '#b07a10'}
        />
      )}
      {tempC != null && (
        <SensorChip
          icon="device_thermostat"
          value={tempC.toFixed(1)}
          unit="°C"
          accent={isPro ? 'var(--primary)' : '#b07a10'}
        />
      )}
      <SensorChip
        icon="memory"
        value={ram != null ? `${Math.round(ram)}` : '—'}
        unit="%"
        accent={pctTone(ram)}
      />
      <SensorChip
        icon="developer_board"
        value={cpu != null ? `${Math.round(cpu)}` : '—'}
        unit="%"
        accent={pctTone(cpu)}
      />

      {esp32Effective !== 'unknown' && (
        <>
          <Divider />
          <Esp32Pill status={esp32Effective} />
        </>
      )}

      <Divider />
      <ProviderBadge provider={provider} routerState={routerState} />
      <Divider />
      <ProactiveIndicator />
      <BackgroundTrackSection />
      <OledEyePreview />

      <span style={{ flex: 1 }} />

      <ConnectivityIcon ok={!!context?.system.wifi_connected} iconOn="wifi" iconOff="wifi_off" label="WiFi" />
      <ConnectivityIcon ok={!!context?.system.internet_available} iconOn="cloud_done" iconOff="cloud_off" label="Інтернет" />
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: wsConnected ? 'var(--signal-ok)' : 'var(--signal-alert)',
        }}
      />

      <Divider />

      <span
        className="tabular"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink-primary)',
        }}
      >
        {timeStr}
      </span>
      <ChromeHandle
        position="top"
        collapsed={false}
        onToggle={toggleCollapsed}
        label="верхній рядок"
        style={{ marginLeft: 4 }}
      />
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function pctTone(v: number | null | undefined): string {
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
  // Крапка проти тире — шифр, який ніхто не прочитає, а на тачскріні
  // підказки не буває. Стан називаємо словом.
  const label =
    status === 'online' ? 'ESP32' : status === 'offline' ? 'ESP32 нема' : 'ESP32 вимк.';
  const title =
    status === 'online'
      ? 'Плата підключена, дані з датчиків надходять'
      : status === 'offline'
        ? 'Канал увімкнено, але плату ESP32 не знайдено'
        : 'Канал до плати вимкнено — заліза немає';
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
          whiteSpace: 'nowrap',
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
      title={ok ? `${label}: є звʼязок` : `${label}: звʼязку немає`}
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
  // Підказка була англійською — і саме тому лишалась непоміченою: сито
  // англіцизмів читало innerText, а не title.
  let title: string;
  if (active > 0 && queued > 0) {
    title = `У фоні: 1 в роботі + ${queued} у черзі (${origin})`;
  } else if (active > 0) {
    title = `У фоні: ${origin} — ${substate}`;
  } else if (queued > 0) {
    title = `У фоні: ${queued} у черзі`;
  } else {
    title = 'У фоні: тиша';
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
        <span className="tabular">Фон: {view.total}</span>
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
      ? `Ініціатива: активна${proactive.hasTriggers ? ' (є привід озватись)' : ''}`
      : status === 'cooling'
        ? 'Ініціатива: перепочинок'
        : 'Ініціатива: спокій';
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
