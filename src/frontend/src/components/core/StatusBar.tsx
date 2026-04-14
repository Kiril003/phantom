import React from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { SystemState } from '@shared/types';

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
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // State color driven by CSS variable --state-color set via data-state on <body>
  const stateColorStyle = { color: 'var(--state-color)' };
  const stateGlowStyle = {
    background: 'var(--state-color)',
    boxShadow: '0 0 4px var(--state-glow)',
  };

  return (
    <div
      className="w-[1024px] flex items-center px-3 gap-3 shrink-0 border-b border-phantom-border bg-phantom-surface"
      style={{ height: '28px', fontSize: '11px' }}
    >
      {/* State indicator */}
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full status-indicator" style={stateGlowStyle} />
        <span className="tracking-widest" style={stateColorStyle}>
          {STATE_LABELS[state]}
        </span>
      </div>

      <div className="h-3 w-px bg-phantom-border" />

      {/* User */}
      <span className="text-phantom-text-dim">{user ? user.username : '—'}</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* System info from context */}
      {context && (
        <>
          <span className="text-phantom-text-dim">
            CPU {context.system.cpu_percent.toFixed(0)}%
          </span>
          <div className="h-3 w-px bg-phantom-border" />
          <span className="text-phantom-text-dim">
            RAM {context.system.ram_percent.toFixed(0)}%
          </span>
          <div className="h-3 w-px bg-phantom-border" />
          <span className="text-phantom-text-dim capitalize">{context.system.ai_provider}</span>
          <div className="h-3 w-px bg-phantom-border" />
        </>
      )}

      {/* WS connection — success/danger CSS variables */}
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={
          wsConnected
            ? {
                background: 'var(--phantom-success, #39FF14)',
                boxShadow: '0 0 4px color-mix(in srgb, var(--phantom-success, #39FF14) 40%, transparent)',
              }
            : {
                background: 'var(--phantom-danger, #FF073A)',
                boxShadow: '0 0 4px color-mix(in srgb, var(--phantom-danger, #FF073A) 40%, transparent)',
              }
        }
        title={wsConnected ? 'Connected' : 'Disconnected'}
      />

      <div className="h-3 w-px bg-phantom-border" />

      {/* Time */}
      <span className="text-phantom-text font-mono tabular-nums">{timeStr}</span>
    </div>
  );
}
