/**
 * Phase 18-COMPLETE — LongRunningTaskCard.
 *
 * Top-right glass card that surfaces a long-running action that has been
 * promoted onto the background track. Shows the goal, ETA, the last
 * progress heartbeat, and a small action surface.
 *
 * The card is purely a status mirror — it never drives runtime state.
 * "Stop task" hits the existing `agentApi.stopTask` path; cancellation
 * flows through the standard runtime contract. We deliberately do NOT
 * try to demote the task back to the foreground here: that's a future
 * runtime capability and would risk colliding with whatever the operator
 * is now doing on the freed slot.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, X } from 'lucide-react';

import { agentApi } from '../../../services/agentApi';
import { useAgentStore } from '../../../stores/agentStore';

interface Props {
  taskId: string;
  goal: string;
  onDismiss?: () => void;
}

function formatRelativeSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—';
  if (s <= 0) return 'майже готово';
  if (s < 60) return `${Math.round(s)}c`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return r > 5 ? `${m}хв ${r}c` : `${m}хв`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  return m > 0 ? `${h}год ${m}хв` : `${h}год`;
}

function formatClock(epochS: number | null | undefined): string {
  if (epochS == null || !Number.isFinite(epochS)) return '—';
  const d = new Date(epochS * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function LongRunningTaskCard({ taskId, goal, onDismiss }: Props) {
  const updates = useAgentStore((s) => s.progressByTaskId[taskId] ?? []);
  const eta = useAgentStore((s) => s.progressEtaByTaskId[taskId] ?? null);
  const promotedAt = useAgentStore(
    (s) => s.promotedToBackgroundAt[taskId] ?? null,
  );
  const loading = useAgentStore((s) => s.progressLoading[taskId] ?? false);
  const loadProgress = useAgentStore((s) => s.loadProgress);
  const [stopping, setStopping] = useState(false);

  // Hydrate once on mount + every time the WS reconnects (driven by
  // wsConnected flips elsewhere). One-shot here is fine because incoming
  // task.progress events keep the in-memory ring fresh on their own.
  useEffect(() => {
    void loadProgress(taskId);
  }, [taskId, loadProgress]);

  const last = updates[updates.length - 1];
  const elapsedS = (last?.extra?.elapsed_s as number | undefined) ?? null;
  const actionName = (last?.extra?.action as string | undefined) ?? '—';
  const percent =
    typeof last?.percent === 'number' && last.percent >= 0 && last.percent <= 100
      ? last.percent
      : null;

  const goalShort = useMemo(
    () => (goal.length > 64 ? `${goal.slice(0, 60)}…` : goal),
    [goal],
  );

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await agentApi.stop(taskId);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="long-running-task-card"
      style={{
        position: 'absolute',
        right: 24,
        top: 80,
        zIndex: 45,
        width: 296,
        padding: '14px 14px 12px',
        borderRadius: 16,
        background:
          'linear-gradient(180deg, rgba(248,243,232,0.92) 0%, rgba(243,230,200,0.85) 100%)',
        border: '1px solid color-mix(in srgb, var(--ink-soft, #c8b07a) 50%, transparent)',
        boxShadow: '0 22px 48px rgba(75,40,8,0.18)',
        backdropFilter: 'blur(10px)',
        color: 'var(--ink-primary, #2A1B07)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 8,
            background: 'rgba(244,175,37,0.32)',
            color: '#7A4A0D',
          }}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={2.2} />
          ) : (
            <Activity size={14} strokeWidth={2.4} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--fs-xxs, 11px)',
              fontWeight: 700,
              letterSpacing: 'var(--tracking-wider, 0.05em)',
              color: 'var(--signal-info, #b8731e)',
              textTransform: 'uppercase',
            }}
          >
            На фоні
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ink-primary, #2A1B07)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={goal}
          >
            {goalShort}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Сховати картку"
            style={{
              minWidth: 32,
              minHeight: 32,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-soft, #6e5630)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div
        style={{
          height: 6,
          width: '100%',
          background: 'rgba(123,76,18,0.14)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: percent !== null ? `${Math.max(2, Math.min(100, percent))}%` : '40%',
            background:
              percent !== null
                ? 'linear-gradient(90deg, #f4af25, #d97a09)'
                : 'linear-gradient(90deg, rgba(244,175,37,0.55), rgba(217,122,9,0.55))',
            transition: 'width 240ms ease-out',
            animation: percent !== null ? undefined : 'phantom-pulse 1.6s ease-in-out infinite',
          }}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          fontSize: 11,
          color: 'var(--ink-soft, #6e5630)',
        }}
      >
        <div>
          <div style={{ opacity: 0.7 }}>Залишилось</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary, #2A1B07)' }}>
            {formatRelativeSeconds(eta)}
          </div>
        </div>
        <div>
          <div style={{ opacity: 0.7 }}>Перенесено</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary, #2A1B07)' }}>
            {formatClock(promotedAt)}
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-soft, #6e5630)',
          fontFamily: 'var(--font-mono, ui-monospace)',
          opacity: 0.85,
          minHeight: 14,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={`${actionName} · ${elapsedS != null ? `${elapsedS}c` : 'no signal'}`}
      >
        {last
          ? `${actionName} · ${last.label || 'progress'}`
          : 'Очікую перший heartbeat…'}
      </div>

      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        style={{
          minHeight: 44,
          marginTop: 4,
          borderRadius: 12,
          border: '1px solid rgba(125,40,40,0.35)',
          background: stopping
            ? 'rgba(168,55,55,0.6)'
            : 'linear-gradient(180deg, rgba(168,55,55,0.92), rgba(125,30,30,0.92))',
          color: '#FFF1E5',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: 0.4,
          cursor: stopping ? 'progress' : 'pointer',
        }}
      >
        {stopping ? 'Зупиняю…' : 'Зупинити фонову задачу'}
      </button>
    </div>
  );
}
