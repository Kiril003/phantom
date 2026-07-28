/**
 * AgentRoster — 5-section chip row showing all active agent processes.
 *
 * Sections: Foreground · Background · Standing Orders · Proactive · Council
 *
 * Each chip:
 *   Full mode  (chrome.roster=false): h=36px, min-w=168px, dot + name + status text
 *   Compact mode (chrome.roster=true): h=28px, min-w=120px, dot + icon only, no labels
 *
 * Touch target: guaranteed ≥44px via ::before pseudo element (handled by
 * the `chip-touch-target` CSS class in the style block below) or via padding.
 *
 * Deps:
 *   useAgentStore  — task / bg / proactive / council state
 *   useUIStore     — focusedAgent / setFocusedAgent
 *   useChromeCollapse('roster') — compact/full toggle
 *   ChromeHandle   — collapse toggle button
 *   useStandingOrdersHeartbeat — polled `{enabled,totalFired,lastFireAt,loading}`
 */
import { useAgentStore } from '../../../stores/agentStore';
import { useUIStore, type FocusedAgent } from '../../../stores/uiStore';
import { useChromeCollapse } from '../../../hooks/useChromeCollapse';
import { useStandingOrdersHeartbeat } from '../../../hooks/useStandingOrdersHeartbeat';
import { ChromeHandle } from '../../core/ChromeHandle';
import { Zap, Hourglass, ClipboardList, Sparkles, Scale, Layers, Users } from 'lucide-react';

// ─── Active-status derivation ─────────────────────────────────────────────────

const INACTIVE_STATUSES = new Set(['idle', 'done', 'failed', 'stopped']);

function isForegroundActive(
  status: string,
  currentTask: unknown,
): boolean {
  if (!currentTask) return false;
  return !INACTIVE_STATUSES.has(status);
}

function isBackgroundActive(
  promotedToBackgroundAt: Record<string, number>,
): boolean {
  return Object.keys(promotedToBackgroundAt).length > 0;
}

function isProactiveActive(enabled: boolean): boolean {
  return enabled;
}

function isCouncilActive(councilActive: boolean): boolean {
  return councilActive;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Returns the inline style for a chip button */
function chipStyle(focused: boolean, compact: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: compact ? 4 : 6,
    height: compact ? 28 : 36,
    minWidth: compact ? 120 : 168,
    paddingLeft: compact ? 8 : 10,
    paddingRight: compact ? 8 : 10,
    paddingTop: 0,
    paddingBottom: 0,
    borderRadius: 12,
    border: focused
      ? '1.5px solid var(--primary, #6366f1)'
      : '1px solid rgba(255,255,255,0.5)',
    background: focused
      ? 'var(--primary, #6366f1)'
      : 'rgba(255,255,255,0.4)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: focused ? '#fff' : 'var(--ink, rgba(0,0,0,0.8))',
    cursor: 'pointer',
    flexShrink: 0,
    // Extend touch target via padding when compact (44px effective via minHeight trick)
    minHeight: compact ? 44 : 44,
    boxSizing: 'border-box',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

/** Pulse-dot for active state */
function Dot({ active, focused }: { active: boolean; focused: boolean }) {
  const color = active
    ? focused
      ? 'rgba(255,255,255,0.9)'
      : 'var(--primary, #6366f1)'
    : focused
      ? 'rgba(255,255,255,0.4)'
      : 'rgba(0,0,0,0.2)';

  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        animation: active ? 'agentRosterPulse 2s ease-in-out infinite' : undefined,
      }}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AgentRoster() {
  // Agent store selectors
  const currentTask = useAgentStore((s) => s.currentTask);
  const status = useAgentStore((s) => s.status);
  const promotedToBackgroundAt = useAgentStore((s) => s.promotedToBackgroundAt);
  const bgTaskGoals = useAgentStore((s) => s.bgTaskGoals);
  const progressByTaskId = useAgentStore((s) => s.progressByTaskId);
  const proactive = useAgentStore((s) => s.proactive);
  const councilActive = useAgentStore((s) => s.councilActive);
  const councilStatements = useAgentStore((s) => s.councilStatements);

  // UI store
  const focusedAgent = useUIStore((s) => s.focusedAgent);
  const setFocusedAgent = useUIStore((s) => s.setFocusedAgent);

  // Chrome collapse
  const [compact, toggleRoster] = useChromeCollapse('roster');

  // Standing orders heartbeat (fallback until Task 8 lands)
  const soData = useStandingOrdersHeartbeat();

  // ── Derived chip activity ──────────────────────────────────────────────────

  const fgActive = isForegroundActive(status, currentTask);
  const bgActive = isBackgroundActive(promotedToBackgroundAt);
  const soActive = soData.enabled > 0;
  const proactiveActive = isProactiveActive(proactive.enabled);
  const councilIsActive = isCouncilActive(councilActive);

  // ── Status text builders ───────────────────────────────────────────────────

  function fgStatusText(): string {
    if (!currentTask) return 'Немає задачі';
    const goal = currentTask.task.goal;
    const short = goal.length > 28 ? goal.slice(0, 26) + '…' : goal;
    return `${status} · ${short}`;
  }

  function bgStatusText(): string {
    const count = Object.keys(promotedToBackgroundAt).length;
    if (count === 0) return 'Немає фону';
    const ids = Object.keys(progressByTaskId);
    const pct = ids.length > 0
      ? progressByTaskId[ids[0]]?.slice(-1)[0]?.percent
      : null;
    const pctStr = typeof pct === 'number' ? ` · ${Math.round(pct)}%` : '';
    const goalText = bgTaskGoals[Object.keys(bgTaskGoals)[0]] ?? '';
    const short = goalText.length > 22 ? goalText.slice(0, 20) + '…' : goalText;
    return `${count} фон${pctStr}${short ? ' · ' + short : ''}`;
  }

  function soStatusText(): string {
    if (soData.enabled === 0) return 'Неактивно';
    return `${soData.enabled} активних · ${soData.totalFired} fires`;
  }

  function proactiveStatusText(): string {
    if (!proactive.enabled) return 'Вимкнено';
    const hasTriggers = proactive.hasTriggers;
    const last = proactive.lastCycleAt
      ? new Date(proactive.lastCycleAt).toLocaleTimeString('uk-UA', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
    return hasTriggers
      ? `Тригери · ${last ?? '…'}`
      : `Цикл · ${last ?? '…'}`;
  }

  function councilStatusText(): string {
    if (!councilActive) return 'Неактивна';
    const count = councilStatements.length;
    return count > 0 ? `Нарада · ${count} реплік` : 'Нарада…';
  }

  // ── Chip definitions ───────────────────────────────────────────────────────

  const chips: Array<{
    id: FocusedAgent;
    label: string;
    icon: React.ReactNode;
    active: boolean;
    statusText: string;
  }> = [
    {
      id: 'foreground',
      label: 'ОСНОВНИЙ',
      icon: <Zap size={13} className="text-amber-500" />,
      active: fgActive,
      statusText: fgStatusText(),
    },
    {
      id: 'background',
      label: 'ФОНОВИЙ',
      icon: <Hourglass size={13} className="text-cyan-500" />,
      active: bgActive,
      statusText: bgStatusText(),
    },
    {
      id: 'standing_orders',
      label: 'ДОРУЧЕННЯ',
      icon: <ClipboardList size={13} className="text-emerald-500" />,
      active: soActive,
      statusText: soStatusText(),
    },
    {
      id: 'proactive',
      label: 'АВТОНОМІЯ',
      icon: <Sparkles size={13} className="text-purple-500" />,
      active: proactiveActive,
      statusText: proactiveStatusText(),
    },
    {
      id: 'council',
      label: 'РАДА',
      icon: <Scale size={13} className="text-indigo-500" />,
      active: councilIsActive,
      statusText: councilStatusText(),
    },
    {
      id: 'horizons',
      label: 'ПЛАНУВАННЯ',
      icon: <Layers size={13} className="text-amber-600" />,
      active: true,
      statusText: 'Стратегія',
    },
    {
      id: 'org_chart',
      label: 'КОМАНДА',
      icon: <Users size={13} className="text-blue-500" />,
      active: true,
      statusText: 'Орг-схема',
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe animation injected once via a style tag */}
      <style>{`
        @keyframes agentRosterPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.25); }
        }
      `}</style>

      <div
        data-testid="agent-roster"
        className="glass-panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 16,
          height: compact ? 36 : 44,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {chips.map((chip) => {
          const focused = focusedAgent === chip.id;
          const isCouncilChip = chip.id === 'council';

          return (
            <button
              key={chip.id}
              data-testid={`roster-chip-${chip.id}`}
              type="button"
              aria-pressed={focused}
              onClick={() => setFocusedAgent(chip.id)}
              style={chipStyle(focused, compact)}
            >
              <Dot active={chip.active} focused={focused} />

              {compact ? (
                /* Compact: icon only, no text */
                <span
                  style={{ fontSize: isCouncilChip ? 14 : 12, lineHeight: 1 }}
                  aria-hidden="true"
                >
                  {chip.icon}
                </span>
              ) : (
                /* Full: name + status text */
                <>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {chip.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      opacity: 0.75,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 120,
                    }}
                  >
                    {chip.statusText}
                  </span>
                </>
              )}
            </button>
          );
        })}

        {/* Chrome collapse toggle — right side */}
        <ChromeHandle
          position="top"
          collapsed={compact}
          onToggle={toggleRoster}
          label="Roster"
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        />
      </div>
    </>
  );
}
