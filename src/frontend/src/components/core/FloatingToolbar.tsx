import { useNavigate, useLocation } from 'react-router-dom';
import {
  Terminal,
  Map,
  Mic,
  Radar,
  Home,
  Grid3x3,
  Settings,
  Camera,
  Shield,
  Wifi,
  Power,
} from 'lucide-react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { SystemState } from '@shared/types';

export interface FloatingToolbarItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  tone?: 'default' | 'alert';
}

interface FloatingToolbarProps {
  /** Override default items (e.g., context-specific). */
  items?: FloatingToolbarItem[];
}

/**
 * FloatingToolbar — bottom-centre glass pill with quick actions.
 * Default: terminal / map / voice / radar / home / menu / settings / camera / security / wifi / power.
 * Active state uses accent color + subtle glow; others muted.
 */
export function FloatingToolbar({ items }: FloatingToolbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useSystemStore((s) => s.state);
  const setState = useSystemStore((s) => s.setState);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const setAuthenticated = useSystemStore((s) => s.setAuthenticated);

  const defaultItems: FloatingToolbarItem[] = [
    {
      id: 'home',
      icon: <Home size={18} strokeWidth={1.75} />,
      label: 'Home',
      active: location.pathname === '/',
      onClick: () => navigate('/'),
    },
    {
      id: 'terminal',
      icon: <Terminal size={18} strokeWidth={1.75} />,
      label: 'Dialogue',
      active: state === SystemState.DIALOGUE,
      onClick: () => setState(SystemState.DIALOGUE, { trigger: 'toolbar', timestamp: Date.now(), auto: false }),
    },
    {
      id: 'map',
      icon: <Map size={18} strokeWidth={1.75} />,
      label: 'Map',
      active: location.pathname.startsWith('/map'),
      onClick: () => navigate('/map'),
    },
    {
      id: 'voice',
      icon: <Mic size={18} strokeWidth={1.75} />,
      label: 'Voice',
    },
    {
      id: 'radar',
      icon: <Radar size={18} strokeWidth={1.75} />,
      label: 'Sentinel',
      active: state === SystemState.SENTINEL,
      tone: state === SystemState.SENTINEL ? 'alert' : 'default',
      onClick: () => setState(SystemState.SENTINEL, { trigger: 'toolbar', timestamp: Date.now(), auto: false }),
    },
    {
      id: 'ghost',
      icon: <Shield size={18} strokeWidth={1.75} />,
      label: 'Ghost',
      active: state === SystemState.GHOST,
      onClick: () => setState(SystemState.GHOST, { trigger: 'toolbar', timestamp: Date.now(), auto: false }),
    },
    {
      id: 'grid',
      icon: <Grid3x3 size={18} strokeWidth={1.75} />,
      label: 'Apps',
    },
    {
      id: 'camera',
      icon: <Camera size={18} strokeWidth={1.75} />,
      label: 'Camera',
    },
    {
      id: 'wifi',
      icon: <Wifi size={18} strokeWidth={1.75} />,
      label: 'WiFi',
    },
    {
      id: 'settings',
      icon: <Settings size={18} strokeWidth={1.75} />,
      label: 'Settings',
      active: location.pathname.startsWith('/settings'),
      onClick: () => navigate('/settings'),
    },
    {
      id: 'power',
      icon: <Power size={18} strokeWidth={1.75} />,
      label: 'Sign out',
      onClick: () => {
        clearAuth();
        setAuthenticated(false);
      },
    },
  ];

  const list = items ?? defaultItems;

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto"
      style={{ zIndex: 30 }}
    >
      <div className="glass-card rounded-full px-3 py-1.5 flex items-center gap-1">
        {list.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className="relative flex items-center justify-center transition-all active:scale-95"
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              color:
                item.tone === 'alert'
                  ? 'var(--signal-alert)'
                  : item.active
                    ? 'var(--accent)'
                    : 'var(--ink-secondary)',
              background: item.active
                ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                : 'transparent',
              boxShadow: item.active
                ? '0 0 16px var(--accent-glow), inset 0 0 0 1px var(--glass-border-hover)'
                : 'none',
            }}
            aria-label={item.label}
            aria-pressed={item.active}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
