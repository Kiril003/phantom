import { useEffect, useState } from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { SystemState } from '@shared/types';
import { Wifi, WifiOff, Cloud, CloudOff } from 'lucide-react';

const STATE_LABELS: Record<SystemState, string> = {
  [SystemState.SHADOW]: 'SHADOW',
  [SystemState.FOCUS]: 'FOCUS',
  [SystemState.DIALOGUE]: 'DIALOGUE',
  [SystemState.SENTINEL]: 'SENTINEL',
  [SystemState.GHOST]: 'GHOST',
  [SystemState.DREAM]: 'DREAM',
};

export function StatusBar() {
  const { state, wsConnected, context } = useSystemStore();
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

  // GHOST mode — minimal status bar
  if (state === SystemState.GHOST) return null;

  // DREAM mode — no status bar
  if (state === SystemState.DREAM) return null;

  return (
    <div
      className="w-[1024px] flex items-center px-3 gap-2 shrink-0"
      style={{
        height: 'var(--status-bar-h)',
        fontSize: 'var(--fs-micro)',
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--line-subtle)',
        opacity: 'var(--ui-opacity)',
      }}
    >
      {/* State indicator dot + label */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center" style={{ width: 10, height: 10 }}>
          <div
            className="absolute rounded-full"
            style={{
              width: 10,
              height: 10,
              background: 'var(--accent)',
              opacity: 0.3,
              animation: state === SystemState.SENTINEL
                ? 'pulse-state 0.6s ease-in-out infinite'
                : 'pulse-state 2s ease-in-out infinite',
            }}
          />
          <div
            className="rounded-full relative"
            style={{
              width: 6,
              height: 6,
              background: 'var(--accent)',
              boxShadow: '0 0 4px var(--accent-glow)',
            }}
          />
        </div>
        <span className="tracking-widest font-mono" style={{ color: 'var(--accent)' }}>
          {STATE_LABELS[state]}
        </span>
      </div>

      <Divider />

      {/* User */}
      <span style={{ color: 'var(--ink-muted)' }}>{user ? user.username : '—'}</span>

      <Divider />

      {/* Breathing BPM */}
      {context?.body.breathing_bpm != null && (
        <>
          <span style={{ color: 'var(--ink-secondary)' }}>
            {context.body.breathing_bpm} bpm
          </span>
          <Divider />
        </>
      )}

      {/* Environment */}
      {context?.env.temp_c != null && (
        <>
          <span style={{ color: 'var(--ink-secondary)' }}>
            {context.env.temp_c.toFixed(1)}°C
          </span>
          <Divider />
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* System info */}
      {context && (
        <>
          <span style={{ color: 'var(--ink-muted)' }}>
            CPU {context.system.cpu_percent.toFixed(0)}%
          </span>
          <Divider />
          <span style={{ color: 'var(--ink-muted)' }}>
            RAM {context.system.ram_percent.toFixed(0)}%
          </span>
          <Divider />
          <span className="capitalize" style={{ color: 'var(--ink-muted)' }}>
            {context.system.ai_provider}
          </span>
          <Divider />
        </>
      )}

      {/* WiFi */}
      {context?.system.wifi_connected ? (
        <Wifi size={12} strokeWidth={1.5} style={{ color: 'var(--signal-ok)' }} />
      ) : (
        <WifiOff size={12} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
      )}

      {/* Internet */}
      {context?.system.internet_available ? (
        <Cloud size={12} strokeWidth={1.5} style={{ color: 'var(--signal-ok)' }} />
      ) : (
        <CloudOff size={12} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
      )}

      <Divider />

      {/* WS connection */}
      <div
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: wsConnected ? 'var(--signal-ok)' : 'var(--signal-alert)',
          boxShadow: wsConnected
            ? '0 0 4px rgba(126,231,135,0.4)'
            : '0 0 4px rgba(255,107,107,0.4)',
        }}
        title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
      />

      <Divider />

      {/* Time */}
      <span className="font-mono tabular-nums" style={{ color: 'var(--ink-primary)' }}>
        {timeStr}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-3" style={{ background: 'var(--line-subtle)' }} />;
}
