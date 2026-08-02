import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
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
      ? 'Голос: постійний (тап → на слово)'
      : voiceMode === 'wake_word'
        ? 'Голос: на слово (тап → вимкнути)'
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
      },
    },
    {
      id: 'power',
      icon: 'power_settings_new',
      label: 'Вийти з сеансу',
      tone: 'alert',
      onClick: () => {
        signOut();
      },
    },
  ];
  const secondary: ToolbarAction[] = secondaryAll.filter(
    (item) => item.id !== 'ghost' || isRoot,
  );

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
    >
      <motion.div
        data-testid="phantom-dock"
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
        {list.map((item) => (
          <ToolbarIcon key={item.id} item={item} />
        ))}
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

