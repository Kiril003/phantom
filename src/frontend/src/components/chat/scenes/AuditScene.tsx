/**
 * Phase-5 R1 — AuditScene (B-17).
 *
 * Inline glass card returned from `audit.replay`. Mirrors the design DNA
 * from `docs/design-handoff/project/screen-8-inline.jsx` → `SceneAudit`:
 * vertical timeline with status-coloured ring dots, mono tool badges,
 * Playfair italic for `reflect` events, header status counters, and
 * Replay / Export footer buttons with a trace-id mono tag.
 *
 * Pure render. The buttons emit `data-audit-action` for parent wiring.
 */
import type { AuditEvent, AuditEventStatus, AuditSceneData } from '@shared/types';
import { PhantomIcon } from '../../core/PhantomIcon';

interface AuditSceneProps {
  data: AuditSceneData;
}

const STATUS_COLOURS: Record<AuditEventStatus, { dot: string; ring: string; text: string }> = {
  ok: { dot: 'var(--signal-ok)', ring: 'rgba(34,197,94,0.3)', text: 'var(--ink-secondary)' },
  retry: { dot: 'var(--primary)', ring: 'rgba(244,175,37,0.3)', text: 'var(--primary-shadow)' },
  fail: { dot: 'var(--signal-alert)', ring: 'rgba(239,68,68,0.3)', text: 'var(--coral-deep)' },
};

function isReflective(ev: AuditEvent): boolean {
  return ev.tool === 'reflect' || ev.tool.endsWith('.reflect');
}

export function AuditScene({ data }: AuditSceneProps) {
  return (
    <div
      className="glass lift"
      style={{ width: 540, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-audit"
      data-audit-trace={data.trace_id}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhantomIcon name="schedule" size={14} color="var(--primary-deep)" aria-hidden />
          <span className="eyebrow-amber">
            AUDIT · {data.window_display.toUpperCase()} · {data.total_actions} ACTIONS
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CountChip colour="var(--signal-ok)" value={data.counts.ok} />
          <CountChip colour="var(--primary)" value={data.counts.retry} />
          <CountChip colour="var(--signal-alert)" value={data.counts.fail} />
        </div>
      </div>

      <div style={{ marginTop: 10, position: 'relative' }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 6,
            top: 5,
            bottom: 5,
            width: 1.5,
            background: 'rgba(176,122,16,0.18)',
          }}
        />
        {data.events.map((ev) => {
          const c = STATUS_COLOURS[ev.status];
          const reflective = isReflective(ev);
          return (
            <div
              key={ev.event_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                position: 'relative',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 'var(--radius-pill)',
                  background: 'white',
                  border: `2px solid ${c.dot}`,
                  boxShadow: `0 0 0 3px ${c.ring}`,
                  flexShrink: 0,
                  zIndex: 1,
                }}
              />
              <span
                className="tabular"
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: 'var(--ink-muted)',
                  flexShrink: 0,
                  width: 30,
                }}
              >
                {ev.time_display}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 8.5,
                  padding: '1.5px 6px',
                  borderRadius: 4,
                  background: 'rgba(244,175,37,0.15)',
                  color: 'var(--primary-shadow)',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {ev.tool}
              </span>
              <span
                className={reflective ? 'playfair' : undefined}
                style={{
                  fontSize: 10,
                  color: c.text,
                  flex: 1,
                  fontStyle: reflective ? 'italic' : 'normal',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {ev.text}
              </span>
              <span
                className="tabular"
                style={{ fontSize: 8, color: 'var(--ink-muted)', flexShrink: 0 }}
              >
                {ev.duration_display}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          data-audit-action="replay"
          data-audit-trace={data.trace_id}
          style={{
            minHeight: 44,
            padding: '6px 14px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--ink-secondary)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--font-display)',
          }}
        >
          <PhantomIcon name="replay" size={12} aria-hidden />
          Replay
        </button>
        <button
          type="button"
          data-audit-action="export"
          data-audit-trace={data.trace_id}
          style={{
            minHeight: 44,
            padding: '6px 14px',
            borderRadius: 'var(--radius-pill)',
            background: 'transparent',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--ink-muted)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--font-display)',
          }}
        >
          <PhantomIcon name="download" size={12} aria-hidden />
          Export
        </button>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-muted)' }}>
          trace · {data.trace_id}
        </span>
      </div>
    </div>
  );
}

function CountChip({ colour, value }: { colour: string; value: number }) {
  return (
    <span
      style={{
        fontSize: 9,
        color: 'var(--ink-muted)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: 'var(--radius-pill)', background: colour }}
      />
      {value}
    </span>
  );
}
