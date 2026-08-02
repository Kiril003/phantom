import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore, type OverlayName } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { settingsApi } from '../../services/api';
import { SystemState } from '@shared/types';
import { EASE_PHANTOM } from '../../styles/motion';
import { ChromeHandle } from './ChromeHandle';
import { useChromeCollapse } from '../../hooks/useChromeCollapse';
import { PhantomIcon } from './PhantomIcon';

/**
 * FloatingToolbar (sunrise build).
 *
 * Bottom-center .glass-strong rounded pill with 7 primary buttons:
 *   home (wb_sunny) · chat (forum) · apps · terminal · map · settings (tune) · more (more_horiz)
 *
 * Each button is 44×44 (.toolbar-btn shape), Material Symbols Outlined glyph,
 * amber tint when active. Long-press on Home opens the More-menu (a glass-strong
 * column with secondary actions: Agent / Agent History / Studio / Eyes / Sentinel / 
 * Ghost (ROOT) / System / Sign out).
 *
 * Audit fix H-MM-2 — SentinelLayout *does* render this component, so secondary
 * routing (Sentinel ↔ previous state) keeps working from any layout.
 *
 * Every existing onclick handler, Zustand selector, and store flow is preserved.
 */

export interface ToolbarAction {
  id: string;
  /** Material Symbols Outlined name. */
  icon: string;
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
  // Phase 28 — Will Engine.
  const willOpen = useUIStore((s) => s.willOpen);
  const setWillOpen = useUIStore((s) => s.setWillOpen);

  const voiceMode = useSettingsStore(
    (s) => (s.values.voice_mode as 'off' | 'continuous' | 'wake_word' | undefined) ?? 'off',
  );
  const applyRemote = useSettingsStore((s) => s.applyRemote);

  const cycleVoiceMode = () => {
    const next: 'off' | 'continuous' | 'wake_word' =
      voiceMode === 'off'
        ? 'continuous'
        : voiceMode === 'continuous'
          ? 'wake_word'
          : 'off';
    const previous = voiceMode;
    applyRemote('voice_mode', next);
    void settingsApi
      .set('voice_mode', next)
      .catch(() => applyRemote('voice_mode', previous));
  };

  const voiceModeActive = voiceMode === 'continuous' || voiceMode === 'wake_word';
  const voiceModeTooltip =
    voiceMode === 'continuous'
      ? 'Голос: постійний (тап → wake-фраза)'
      : voiceMode === 'wake_word'
        ? 'Голос: wake-фраза (тап → вимкнути)'
        : 'Голос: вимкнено (тап → постійний)';

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
  const signOut = () => {
    clearAuth();
    setAuthenticated(false);
    useUIStore.getState().closeAll();
    navigate('/');
  };

  // Sentinel/Ghost states are dramatic — let the dock recede so it doesn't
  // compete with the threat-mode UI (audit fix Phase-21 follow-up).
  const dockRecede = state === SystemState.SENTINEL || state === SystemState.GHOST;

  // First-run discovery hint for the long-press-on-Home → More gesture.
  // Cleared the first time long-press fires; persisted in localStorage so
  // returning sessions don't re-pulse.
  const [showMoreHint, setShowMoreHint] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.localStorage.getItem('phantom_more_hint_seen') !== '1',
  );

  const primary: ToolbarAction[] = [
    {
      id: 'home',
      icon: 'wb_sunny',
      label: 'Головна',
      active: state === SystemState.SHADOW && location.pathname === '/',
      onClick: goHome,
    },
    {
      id: 'chat',
      icon: 'forum',
      label: 'Діалог',
      active: state === SystemState.DIALOGUE,
      onClick: goDialogue,
    },
    {
      id: 'apps',
      icon: 'apps',
      label: 'Додатки',
      active: isOverlayOpen('apps'),
      onClick: () => toggleOverlay('apps'),
    },
    {
      id: 'settings',
      icon: 'tune',
      label: 'Налаштування',
      active: location.pathname.startsWith('/settings'),
      onClick: () => navigate('/settings'),
    },
  ];

  const secondaryAll: ToolbarAction[] = [
    {
      id: 'polis',
      icon: 'location_city',
      label: 'Поліс',
      tooltip: 'Агентство — місії як чат, документи, воркери, громадяни, ключі',
      active: location.pathname === '/polis',
      onClick: () => {
        navigate('/polis');
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'will',
      icon: 'psychology',
      label: 'Воля',
      tooltip: 'Двигун Волі — драйви та цілі автономності',
      active: willOpen,
      onClick: () => {
        setWillOpen(!willOpen);
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'always-on',
      icon: 'settings_voice',
      label: 'Голосовий режим',
      tooltip: voiceModeTooltip,
      active: voiceModeActive,
      onClick: () => {
        cycleVoiceMode();
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'sentinel',
      icon: 'radar',
      label: 'Вартовий',
      active: state === SystemState.SENTINEL,
      tone: state === SystemState.SENTINEL ? 'alert' : 'default',
      onClick: () => {
        goSentinel();
        setMoreMenuOpen(false);
      },
    },
    // Phase 9.5 — Ghost is ROOT-only and filtered out for non-ROOT below
    // so the option does not leak into the menu (CLAUDE.md rule #6).
    {
      id: 'ghost',
      icon: 'shield_moon',
      label: 'Режим Привид',
      active: state === SystemState.GHOST,
      onClick: () => {
        goGhost();
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'grid',
      icon: 'grid_view',
      label: 'Система',
      tooltip: 'Система — навантаження ЦП / ОЗП / ресурси',
      active: state === SystemState.FOCUS && location.pathname === '/',
      onClick: () => {
        goFocus();
        setMoreMenuOpen(false);
      },
    },
    {
      id: 'power',
      icon: 'power_settings_new',
      label: 'Вийти з сеансу',
      tone: 'alert',
      onClick: () => {
        setMoreMenuOpen(false);
        signOut();
      },
    },
  ];
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
      if (showMoreHint) {
        try {
          window.localStorage.setItem('phantom_more_hint_seen', '1');
        } catch {
          /* private mode / storage disabled — best-effort */
        }
        setShowMoreHint(false);
      }
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

  // Другорядні дії жили в меню «Більше», тож Поліс, Воля, Голос, Вартовий,
  // Привид і Система були невидимі — саме це читалось як «розділи не
  // відкриваються». У доку є місце: показуємо все.
  const list = items ?? [...primary, ...secondary];

  // OperatorLayout v3 chrome-collapse: when `collapsed=true` the toolbar
  // hides into a small handle at the bottom centre, freeing ~60px of
  // content height. Default is collapsed so first-run lands without the
  // dock competing for attention. Tap handle to expand.
  const [toolbarCollapsed, toggleToolbar] = useChromeCollapse('toolbar');

  if (toolbarCollapsed) {
    return (
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto"
        style={{ zIndex: 30 }}
      >
        <ChromeHandle
          position="bottom"
          collapsed={true}
          onToggle={toggleToolbar}
          label="Toolbar"
          style={{
            background: 'rgba(255,255,255,0.55)',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
            boxShadow: '0 2px 8px rgba(40,30,15,0.10)',
            backdropFilter: 'blur(6px)',
          }}
        />
      </div>
    );
  }

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
            style={{ bottom: 64, zIndex: 40 }}
          >
            <div
              className="glass-strong"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))',
                gap: 4,
                padding: 8,
                minWidth: 320,
                maxHeight: 480,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                borderRadius: 18,
              }}
            >
              {secondary.map((it) => (
                <MoreMenuItem key={it.id} action={it} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="glass-strong flex items-center"
        animate={{
          opacity: dockRecede ? 0.62 : 1,
          scale: dockRecede ? 0.96 : 1,
        }}
        transition={{ duration: 0.24, ease: EASE_PHANTOM as unknown as number[] }}
        style={{
          gap: 2,
          padding: '2px 4px',
          borderRadius: 999,
          boxShadow:
            '0 6px 18px rgba(0,0,0,0.25), 0 0 0 1px var(--glass-border), inset 0 1px 0 var(--glass-highlight)',
        }}
      >
        {list.map((item) => {
          if (item.id === 'home') {
            return (
              <div key={item.id} className="relative inline-flex">
                <ToolbarIcon
                  item={item}
                  onPointerDown={onHomePointerDown}
                  onPointerUp={onHomePointerUp}
                  onPointerLeave={onHomePointerUp}
                  onClick={onHomeClick}
                />
                {showMoreHint && !moreMenuOpen && (
                  <span
                    aria-hidden
                    className="animate-pulse"
                    style={{
                      position: 'absolute',
                      right: 4,
                      bottom: 4,
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: 'rgba(244,175,37,0.95)',
                      boxShadow: '0 0 6px rgba(244,175,37,0.85)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            );
          }
          return <ToolbarIcon key={item.id} item={item} />;
        })}
        <ToolbarIcon
          item={{
            id: 'more',
            icon: 'more_horiz',
            label: 'Більше',
            active: moreMenuOpen,
            onClick: () => setMoreMenuOpen(!moreMenuOpen),
          }}
        />
        <ChromeHandle
          position="bottom"
          collapsed={false}
          onToggle={toggleToolbar}
          label="Toolbar"
          style={{ marginLeft: 4 }}
        />
      </motion.div>
    </div>
  );
}

/* ─── Single toolbar button (.toolbar-btn equivalent) ─────────────── */

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
  const fillIcon = item.active ? 1 : 0;
  const wghtIcon = item.active ? 500 : 400;
  return (
    <button
      type="button"
      disabled={item.disabled}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onClick={item.disabled ? undefined : handle}
      className="relative inline-flex items-center justify-center active:scale-95"
      style={{
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        borderRadius: 10,
        border: 'none',
        opacity: item.disabled ? 0.35 : 1,
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        color:
          item.tone === 'alert'
            ? 'var(--coral-deep)'
            : item.active
              ? '#8a5e0a'
              : 'var(--ink-secondary)',
        background: item.active
          ? 'linear-gradient(135deg, rgba(244,175,37,0.30), rgba(251,146,60,0.26))'
          : 'transparent',
        boxShadow: item.active
          ? 'inset 0 0 0 1px rgba(244,175,37,0.55)'
          : 'none',
        transition: 'background 200ms ease, color 200ms ease, box-shadow 200ms ease, transform 120ms ease',
      }}
      aria-label={item.label}
      aria-pressed={item.active}
      title={item.tooltip ?? item.label}
    >
      <PhantomIcon name={item.icon} size={18} weight={wghtIcon} filled={fillIcon === 1} />
    </button>
  );
}

/* ─── More-menu row ───────────────────────────────────────────────── */

function MoreMenuItem({ action }: { action: ToolbarAction }) {
  return (
    <button
      type="button"
      disabled={action.disabled}
      onClick={action.disabled ? undefined : action.onClick}
      className="flex items-center"
      style={{
        gap: 12,
        minHeight: 44,
        padding: '0 12px',
        borderRadius: 12,
        background: action.active
          ? 'linear-gradient(135deg, rgba(244,175,37,0.22), rgba(251,146,60,0.18))'
          : 'transparent',
        border: action.active
          ? '1px solid rgba(244,175,37,0.45)'
          : '1px solid transparent',
        color:
          action.tone === 'alert'
            ? 'var(--coral-deep)'
            : action.active
              ? '#8a5e0a'
              : 'var(--ink-primary)',
        opacity: action.disabled ? 0.35 : 1,
        cursor: action.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textAlign: 'left',
        transition: 'background 200ms ease, color 200ms ease',
      }}
      onMouseEnter={(e) => {
        if (action.disabled || action.active) return;
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.55)';
      }}
      onMouseLeave={(e) => {
        if (action.disabled || action.active) return;
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      aria-label={action.label}
      aria-pressed={action.active}
      title={action.tooltip ?? action.label}
    >
      <PhantomIcon
        name={action.icon}
        size={18}
        color="inherit"
        weight={action.active ? 500 : 400}
        filled={action.active}
        aria-hidden
      />
      <span className="flex-1">{action.label}</span>
      {action.active && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: 'currentColor',
            boxShadow: '0 0 6px currentColor',
          }}
        />
      )}
    </button>
  );
}
