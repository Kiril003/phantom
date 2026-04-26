import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Map,
  Mic,
  Home,
  Settings,
  MessageSquare,
  MoreHorizontal,
  Terminal,
  Radar,
  Radio,
  Shield,
  Grid3x3,
  Camera,
  Wifi,
  Power,
  Cpu,
} from 'lucide-react';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore, type OverlayName } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { settingsApi } from '../../services/api';
import { SystemState } from '@shared/types';
import { EASE_PHANTOM } from '../../styles/motion';

export interface ToolbarAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  /** Optional hover/long-press tooltip; falls back to `label` when absent. */
  tooltip?: string;
  active?: boolean;
  onClick?: () => void;
  tone?: 'default' | 'alert';
  disabled?: boolean;
}

interface FloatingToolbarProps {
  items?: ToolbarAction[];
}

const LONG_PRESS_MS = 500;

/**
 * FloatingToolbar — bottom-centre glass pill.
 *
 * Primary (always visible): Home, Dialogue, Map, Voice, Settings, More
 * Secondary (opens via More or long-press on Home): Terminal, Sentinel,
 *   Ghost, Grid/SystemCore, Camera, Networks, Power.
 */
export function FloatingToolbar({ items }: FloatingToolbarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const state = useSystemStore((s) => s.state);
  const previousState = useSystemStore((s) => s.previousState);
  const setState = useSystemStore((s) => s.setState);
  const setAuthenticated = useSystemStore((s) => s.setAuthenticated);

  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const windows = useUIStore((s) => s.windows);
  const toggleOverlay = useUIStore((s) => s.toggleOverlay);
  const moreMenuOpen = useUIStore((s) => s.moreMenuOpen);
  const setMoreMenuOpen = useUIStore((s) => s.setMoreMenuOpen);
  const setPendingVoiceActivation = useUIStore((s) => s.setPendingVoiceActivation);

  const alwaysOnEnabled = useSettingsStore(
    (s) => Boolean(s.values.voice_always_on_enabled ?? false),
  );
  const applyRemote = useSettingsStore((s) => s.applyRemote);

  const isOverlayOpen = (name: OverlayName) => windows[name].open && !windows[name].minimized;
  const isRoot = user?.role === 'ROOT';

  const toolbarTransition = (to: SystemState) =>
    setState(to, { trigger: 'toolbar', timestamp: Date.now(), auto: false });

  const goHome = () => {
    if (location.pathname !== '/') navigate('/');
    if (state !== SystemState.SHADOW) toolbarTransition(SystemState.SHADOW);
  };
  const goDialogue = () => {
    if (location.pathname !== '/') navigate('/');
    toolbarTransition(SystemState.DIALOGUE);
  };
  const goMap = () => {
    if (!location.pathname.startsWith('/map')) navigate('/map');
    if (state !== SystemState.FOCUS) toolbarTransition(SystemState.FOCUS);
  };
  const goFocus = () => {
    if (location.pathname !== '/') navigate('/');
    toolbarTransition(SystemState.FOCUS);
  };
  const goSentinel = () => {
    if (location.pathname !== '/') navigate('/');
    if (state === SystemState.SENTINEL) toolbarTransition(previousState ?? SystemState.SHADOW);
    else toolbarTransition(SystemState.SENTINEL);
  };
  const goGhost = () => {
    if (!isRoot) return;
    if (location.pathname !== '/') navigate('/');
    if (state === SystemState.GHOST) toolbarTransition(previousState ?? SystemState.SHADOW);
    else toolbarTransition(SystemState.GHOST);
  };
  const goOperator = () => {
    // OPERATOR layout shows the AgentPanel; if no task is active the panel
    // exposes the goal input. Pressing again exits if currently OPERATOR.
    if (location.pathname !== '/') navigate('/');
    if (state === SystemState.OPERATOR) toolbarTransition(previousState ?? SystemState.SHADOW);
    else toolbarTransition(SystemState.OPERATOR);
  };
  const signOut = () => {
    clearAuth();
    setAuthenticated(false);
    useUIStore.getState().closeAll();
    navigate('/');
  };
  /** Voice entry point: route user to DIALOGUE and signal ChatWindow to
   *  auto-fire its mic toggle on mount. The chat pill's mic is still the
   *  single, authoritative voice control; this is just a shortcut.
   *  Phase 9.5 — previously Voice just switched state and did nothing else,
   *  which duplicated Dialogue exactly. Now clicking Voice = "open chat and
   *  start listening" in one gesture. */
  const openVoice = () => {
    setPendingVoiceActivation(true);
    if (state !== SystemState.DIALOGUE) goDialogue();
  };

  /** Phase 11c.2 — toggle voice_always_on_enabled without changing route or
   *  state. Optimistic local flip + persist via settingsApi.set; on failure
   *  we revert so the button reflects backend truth. The VoiceAlwaysOnGate
   *  reacts to settingsStore.values.voice_always_on_enabled changes and
   *  starts/stops the AudioWorklet + WS independently.
   *
   *  Phase 11c.5 — feature is frozen pending a future Phase 12; the toolbar
   *  button is rendered disabled so toggleAlwaysOn never runs. Kept here
   *  (instead of deleted) so re-enabling in Phase 12 is a single-line
   *  change to ALWAYS_ON_DISABLED below. */
  const toggleAlwaysOn = () => {
    const next = !alwaysOnEnabled;
    applyRemote('voice_always_on_enabled', next);
    void settingsApi
      .set('voice_always_on_enabled', next)
      .catch(() => applyRemote('voice_always_on_enabled', !next));
  };

  // Phase 11c.5 — single point of truth for the freeze. Set to false in a
  // future Phase 12 once the bugs in docs/phase-11c.5/known-issues.md are
  // addressed.
  const ALWAYS_ON_DISABLED = true;

  const primary: ToolbarAction[] = [
    {
      id: 'home',
      icon: <Home size={18} strokeWidth={1.75} />,
      label: 'Home',
      active: state === SystemState.SHADOW && location.pathname === '/',
      onClick: goHome,
    },
    {
      id: 'dialogue',
      icon: <MessageSquare size={18} strokeWidth={1.75} />,
      label: 'Dialogue',
      active: state === SystemState.DIALOGUE,
      onClick: goDialogue,
    },
    {
      id: 'map',
      icon: <Map size={18} strokeWidth={1.75} />,
      label: 'Map',
      tooltip: 'Tactical map',
      active: location.pathname.startsWith('/map'),
      onClick: goMap,
    },
    {
      id: 'voice',
      icon: <Mic size={18} strokeWidth={1.75} />,
      label: 'Voice',
      active: state === SystemState.DIALOGUE,
      onClick: openVoice,
    },
    {
      id: 'always-on',
      icon: <Radio size={18} strokeWidth={1.75} />,
      label: 'Always-On',
      tooltip: ALWAYS_ON_DISABLED
        ? 'Always-on голос — у розробці (Phase 11c.5)'
        : alwaysOnEnabled
          ? 'Always-on listening: ON (tap to disable)'
          : 'Always-on listening: OFF (tap to enable)',
      active: ALWAYS_ON_DISABLED ? false : alwaysOnEnabled,
      disabled: ALWAYS_ON_DISABLED,
      onClick: ALWAYS_ON_DISABLED ? undefined : toggleAlwaysOn,
    },
    {
      id: 'settings',
      icon: <Settings size={18} strokeWidth={1.75} />,
      label: 'Settings',
      active: location.pathname.startsWith('/settings'),
      onClick: () => navigate('/settings'),
    },
  ];

  const secondaryAll: ToolbarAction[] = [
    {
      id: 'agent',
      icon: <Cpu size={16} strokeWidth={1.75} />,
      label: 'Agent',
      active: state === SystemState.OPERATOR,
      onClick: () => {
        goOperator();
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'terminal',
      icon: <Terminal size={16} strokeWidth={1.75} />,
      label: 'Terminal',
      active: isOverlayOpen('terminal'),
      onClick: () => {
        toggleOverlay('terminal');
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'sentinel',
      icon: <Radar size={16} strokeWidth={1.75} />,
      label: 'Sentinel',
      active: state === SystemState.SENTINEL,
      tone: state === SystemState.SENTINEL ? 'alert' : 'default',
      onClick: () => {
        goSentinel();
        setMoreMenuOpen(false);
      },
    },
    // Phase 9.5 — Ghost is ROOT-only. Previously the menu item rendered as
    // disabled with label "Ghost (root only)" for non-ROOT, which leaked the
    // feature's existence (violates CLAUDE.md rule #6 — secret features stay
    // native). It is now filtered out below for non-ROOT users so they see
    // nothing at all.
    {
      id: 'ghost',
      icon: <Shield size={16} strokeWidth={1.75} />,
      label: 'Ghost',
      active: state === SystemState.GHOST,
      onClick: () => {
        goGhost();
        setMoreMenuOpen(false);
      },
    },
    {
      // Phase 9.5 — renamed from "System core" to "System" + explicit tooltip
      // to disambiguate from the Map button (both route through FOCUS state
      // but target different surfaces).
      id: 'grid',
      icon: <Grid3x3 size={16} strokeWidth={1.75} />,
      label: 'System',
      tooltip: 'System — CPU / RAM / processes',
      active: state === SystemState.FOCUS && location.pathname === '/',
      onClick: () => {
        goFocus();
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'camera',
      icon: <Camera size={16} strokeWidth={1.75} />,
      label: 'Camera',
      active: isOverlayOpen('camera'),
      onClick: () => {
        toggleOverlay('camera');
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'wifi',
      icon: <Wifi size={16} strokeWidth={1.75} />,
      label: 'Networks',
      active: isOverlayOpen('wardriving'),
      onClick: () => {
        toggleOverlay('wardriving');
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'power',
      icon: <Power size={16} strokeWidth={1.75} />,
      label: 'Sign out',
      tone: 'alert',
      onClick: () => {
        setMoreMenuOpen(false);
        signOut();
      },
    },
  ];
  // Phase 9.5 — filter Ghost out entirely for non-ROOT. Prior code rendered it
  // disabled with label "Ghost (root only)" which leaked the feature.
  const secondary: ToolbarAction[] = secondaryAll.filter(
    (item) => item.id !== 'ghost' || isRoot,
  );

  /* Long-press on Home opens secondary menu too. */
  const homePressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const onHomePointerDown = () => {
    didLongPress.current = false;
    homePressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setMoreMenuOpen(true);
    }, LONG_PRESS_MS);
  };
  const onHomePointerUp = () => {
    if (homePressTimer.current) {
      clearTimeout(homePressTimer.current);
      homePressTimer.current = null;
    }
  };
  const onHomeClick = () => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    goHome();
  };

  /* Close More on outside click */
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [moreMenuOpen, setMoreMenuOpen]);

  const list = items ?? primary;

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto"
      style={{ zIndex: 30 }}
      ref={moreRef}
    >
      <AnimatePresence>
        {moreMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: EASE_PHANTOM as unknown as number[] }}
            className="absolute left-1/2 -translate-x-1/2"
            style={{ bottom: 60, zIndex: 40 }}
          >
            <div
              className="glass-elevated flex flex-col gap-1 px-2 py-2"
              style={{
                borderRadius: 18,
                minWidth: 220,
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow:
                  '0 24px 48px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--glass-border), inset 0 1px 0 var(--glass-highlight)',
              }}
            >
              {secondary.map((it) => (
                <MoreMenuItem key={it.id} action={it} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="glass-card rounded-full px-3 py-1.5 flex items-center gap-1"
        style={{
          transition: 'all 200ms ease',
          boxShadow:
            '0 18px 40px -14px rgba(0,0,0,0.55), 0 0 0 1px var(--glass-border), inset 0 1px 0 var(--glass-highlight)',
        }}
      >
        {list.map((item) => {
          if (item.id === 'home') {
            return (
              <ToolbarIcon
                key={item.id}
                item={item}
                onPointerDown={onHomePointerDown}
                onPointerUp={onHomePointerUp}
                onPointerLeave={onHomePointerUp}
                onClick={onHomeClick}
              />
            );
          }
          return <ToolbarIcon key={item.id} item={item} />;
        })}
        <ToolbarIcon
          item={{
            id: 'more',
            icon: <MoreHorizontal size={18} strokeWidth={1.75} />,
            label: 'More',
            active: moreMenuOpen,
            onClick: () => setMoreMenuOpen(!moreMenuOpen),
          }}
        />
      </div>
    </div>
  );
}

function ToolbarIcon({
  item,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onClick,
}: {
  item: ToolbarAction;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  onClick?: () => void;
}) {
  const handle = onClick ?? item.onClick;
  return (
    <button
      type="button"
      disabled={item.disabled}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onClick={item.disabled ? undefined : handle}
      className="relative flex items-center justify-center active:scale-95"
      style={{
        width: 44,
        height: 44,
        borderRadius: 9999,
        opacity: item.disabled ? 0.35 : 1,
        cursor: item.disabled ? 'not-allowed' : 'pointer',
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
        transition: 'all 200ms ease',
      }}
      aria-label={item.label}
      aria-pressed={item.active}
      title={item.tooltip ?? item.label}
    >
      {item.icon}
    </button>
  );
}

function MoreMenuItem({ action }: { action: ToolbarAction }) {
  return (
    <button
      type="button"
      disabled={action.disabled}
      onClick={action.disabled ? undefined : action.onClick}
      className="flex items-center gap-3 px-3"
      style={{
        minHeight: 44,
        borderRadius: 12,
        background: action.active
          ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
          : 'transparent',
        border: action.active
          ? '1px solid color-mix(in srgb, var(--accent) 34%, transparent)'
          : '1px solid transparent',
        color:
          action.tone === 'alert'
            ? 'var(--signal-alert)'
            : action.active
              ? 'var(--accent)'
              : 'var(--ink-primary)',
        opacity: action.disabled ? 0.35 : 1,
        cursor: action.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-xs)',
        letterSpacing: 'var(--tracking-wide)',
        textAlign: 'left',
        transition: 'all 200ms ease',
      }}
      onMouseEnter={(e) => {
        if (action.disabled || action.active) return;
        (e.currentTarget as HTMLElement).style.background = 'var(--glass-border)';
      }}
      onMouseLeave={(e) => {
        if (action.disabled || action.active) return;
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      aria-label={action.label}
      title={action.tooltip ?? action.label}
    >
      <span style={{ display: 'inline-flex', color: 'inherit' }}>{action.icon}</span>
      <span className="flex-1">{action.label}</span>
      {action.active && (
        <span
          className="rounded-full"
          style={{
            width: 6,
            height: 6,
            background: 'currentColor',
            boxShadow: '0 0 6px currentColor',
          }}
        />
      )}
    </button>
  );
}
