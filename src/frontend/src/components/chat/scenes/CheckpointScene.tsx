/**
 * Phase-5 R1 — CheckpointScene (closes audit-2026-04-30-verifier P0).
 *
 * Inline glass card rendered when `tools.checkpoint.create` returns.
 * Pulls from `src/backend/tools/checkpoint_service.py`. Surfaces an
 * inclusion list (which subsystems are bundled) and a housekeeping
 * nudge when `ripe_for_cleanup > 0`.
 */
import type { CheckpointSceneData } from '@shared/types';
import { PhantomIcon } from '../../core/PhantomIcon';

interface CheckpointSceneProps {
  data: CheckpointSceneData;
}

function fmtCreatedAt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const mon = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}.${mon} · ${hh}:${mm}`;
}

export function CheckpointScene({ data }: CheckpointSceneProps) {
  return (
    <div
      className="glass lift"
      style={{ width: 504, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-checkpoint"
      data-checkpoint-id={data.checkpoint_id}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhantomIcon name="save" size={14} color="var(--primary-deep)" aria-hidden />
          <span className="eyebrow-amber">CHECKPOINT · {data.checkpoint_id}</span>
        </div>
        <span
          className="tabular"
          style={{ fontSize: 11, color: 'var(--ink-secondary)', fontWeight: 600 }}
        >
          {data.size_mb.toFixed(1)} MB
        </span>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.45)',
          border: '1px solid rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="micro-label" style={{ fontSize: 8 }}>STACK</span>
          <span className="tabular" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
            {fmtCreatedAt(data.created_at_iso)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-primary)',
            marginTop: 2,
            fontWeight: 500,
          }}
        >
          {data.stack_summary}
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.inclusions.map((inc) => (
          <div
            key={inc.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              fontSize: 11,
            }}
          >
            <PhantomIcon
              name={inc.included ? 'check_circle' : 'remove_circle_outline'}
              size={14}
              color={inc.included ? 'var(--primary)' : 'var(--ink-muted)'}
              style={{ opacity: inc.included ? 1 : 0.5 }}
              aria-hidden
            />
            <span
              style={{
                color: inc.included ? 'var(--ink-secondary)' : 'var(--ink-muted)',
                flex: 1,
              }}
            >
              {inc.name}
            </span>
            {inc.reason && (
              <span
                className="playfair"
                style={{
                  fontSize: 10,
                  color: 'var(--ink-muted)',
                  fontStyle: 'italic',
                }}
              >
                {inc.reason}
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--ink-muted)',
        }}
      >
        <span>{data.total_checkpoints} stored</span>
        {data.ripe_for_cleanup > 0 && (
          <span style={{ color: 'var(--coral)', fontWeight: 600 }}>
            {data.ripe_for_cleanup} ripe for cleanup
          </span>
        )}
      </div>

      {data.ai_note && (
        <div
          style={{
            marginTop: 8,
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
  );
}
