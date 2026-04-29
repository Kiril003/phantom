/**
 * Phase-5 R1 — TimerScene (B-17).
 *
 * Inline glass card rendered in the chat transcript when a tool call to
 * `timer.create` / `timer.update` returns. Fully implements the design
 * DNA from `docs/design-handoff/project/screen-8-inline.jsx` →
 * `SceneTimer`: sweeping ring with 60-tick crown, big `mm:ss` digit
 * cluster, side stats, NEXUS note, and three touch-friendly action
 * buttons (Pause / +1m / Cancel).
 *
 * Pure render — never mutates `data`. Buttons emit DOM events with the
 * scene-stable `data-timer-action` attribute so a parent toolbar can
 * intercept; clicks without a parent listener are no-ops (no console
 * noise, no state mutation).
 */
import { useMemo } from 'react';
import type { TimerSceneData } from '@shared/types';

const RING_RADIUS = 56;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface TimerSceneProps {
  data: TimerSceneData;
}

function formatHHMM(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--';
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatMMSS(secs: number): string {
  const safe = Math.max(0, Math.floor(secs));
  const mm = Math.floor(safe / 60).toString().padStart(2, '0');
  const ss = (safe % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

const STATUS_DISPLAY: Record<TimerSceneData['status'], { label: string; live: boolean }> = {
  active: { label: 'ACTIVE', live: true },
  paused: { label: 'PAUSED', live: false },
  done: { label: 'DONE', live: false },
  cancelled: { label: 'CANCELLED', live: false },
};

export function TimerScene({ data }: TimerSceneProps) {
  const total = Math.max(1, data.duration_sec);
  const remaining = Math.max(0, Math.min(data.remaining_sec, total));
  const progress = 1 - remaining / total;
  const statusInfo = STATUS_DISPLAY[data.status];

  const tickMarks = useMemo(() => {
    const minutes = Math.max(1, Math.min(60, Math.round(total / 60)));
    return Array.from({ length: minutes }, (_, i) => {
      const a = (i / minutes) * Math.PI * 2 - Math.PI / 2;
      return {
        x1: 70 + Math.cos(a) * 64,
        y1: 70 + Math.sin(a) * 64,
        x2: 70 + Math.cos(a) * 67,
        y2: 70 + Math.sin(a) * 67,
      };
    });
  }, [total]);

  return (
    <div
      className="glass lift"
      style={{ width: 504, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-timer"
      data-timer-id={data.timer_id}
      data-timer-status={data.status}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="msym" aria-hidden style={{ fontSize: 14, color: 'var(--primary-deep)' }}>
            timer
          </span>
          <span className="eyebrow-amber">TIMER · {data.label.toUpperCase()}</span>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(244,175,37,0.18)',
            border: '1px solid rgba(244,175,37,0.4)',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--primary-shadow)',
            letterSpacing: '0.12em',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--primary)',
              animation: statusInfo.live ? 'phantom-status-pulse 1.6s ease-in-out infinite' : 'none',
            }}
          />
          {statusInfo.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12 }}>
        <div style={{ position: 'relative', width: 134, height: 134, flexShrink: 0 }}>
          <svg viewBox="0 0 140 140" style={{ position: 'absolute', inset: 0 }} aria-hidden>
            <defs>
              <linearGradient id={`timer-ring-${data.timer_id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--primary)" />
                <stop offset="100%" stopColor="var(--orange)" />
              </linearGradient>
            </defs>
            <circle
              cx="70"
              cy="70"
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(244,175,37,0.16)"
              strokeWidth="8"
            />
            <circle
              cx="70"
              cy="70"
              r={RING_RADIUS}
              fill="none"
              stroke={`url(#timer-ring-${data.timer_id})`}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRCUMFERENCE * progress} ${RING_CIRCUMFERENCE}`}
              transform="rotate(-90 70 70)"
              style={{ filter: 'drop-shadow(0 2px 6px rgba(244,175,37,0.4))' }}
            />
            {tickMarks.map((m, i) => (
              <line
                key={i}
                x1={m.x1}
                y1={m.y1}
                x2={m.x2}
                y2={m.y2}
                stroke="rgba(176,122,16,0.35)"
                strokeWidth="0.8"
              />
            ))}
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              className="tabular"
              style={{
                fontSize: 32,
                fontWeight: 200,
                color: 'var(--ink-primary)',
                lineHeight: 1,
              }}
            >
              {formatMMSS(remaining)}
            </span>
            <span
              className="playfair"
              style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}
            >
              remaining
            </span>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Stat label="started" value={formatHHMM(data.started_at_ms)} mono />
          <Stat label="ends" value={formatHHMM(data.ends_at_ms)} mono />
          {data.preset && <Stat label="preset" value={data.preset} />}
          {data.ai_note && (
            <div
              style={{
                marginTop: 4,
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(244,175,37,0.06)',
                border: '1px solid rgba(244,175,37,0.18)',
              }}
            >
              <div className="micro-label" style={{ fontSize: 8, marginBottom: 2 }}>
                NEXUS NOTE
              </div>
              <div
                className="playfair"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-secondary)',
                  fontStyle: 'italic',
                  lineHeight: 1.3,
                }}
              >
                “{data.ai_note}”
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <ActionButton timerId={data.timer_id} action="pause-toggle" icon={data.status === 'paused' ? 'play_arrow' : 'pause'}>
          {data.status === 'paused' ? 'Resume' : 'Pause'}
        </ActionButton>
        <ActionButton timerId={data.timer_id} action="extend-1m" icon="add">
          +1m
        </ActionButton>
        <ActionButton timerId={data.timer_id} action="cancel" icon="close" muted>
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--ink-muted)',
        display: 'flex',
        justifyContent: 'space-between',
      }}
    >
      <span>{label}</span>
      <span className={mono ? 'tabular' : undefined} style={{ color: 'var(--ink-secondary)' }}>
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  action,
  timerId,
  muted = false,
}: {
  children: React.ReactNode;
  icon: string;
  action: 'pause-toggle' | 'extend-1m' | 'cancel';
  timerId: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      data-timer-action={action}
      data-timer-id={timerId}
      style={{
        flex: 1,
        minHeight: 44,
        padding: '8px',
        borderRadius: 10,
        background: muted ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(0,0,0,0.06)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color: muted ? 'var(--ink-muted)' : 'var(--ink-secondary)',
        fontFamily: 'var(--font-display)',
      }}
    >
      <span className="msym" aria-hidden style={{ fontSize: 12 }}>
        {icon}
      </span>
      {children}
    </button>
  );
}
