/**
 * Phase-5 R1 — LocationScene (closes audit-2026-04-30-verifier P0).
 *
 * Inline glass card rendered when `tools.location_history.query` returns.
 * Pulls from `src/backend/tools/location_history_service.py`. Surfaces a
 * privacy nudge when `unknowns > 0` so the operator can label or seal
 * unrecognised stops.
 */
import type { LocationSceneData, LocationStopKind } from '@shared/types';
import { PhantomIcon } from '../../core/PhantomIcon';

interface LocationSceneProps {
  data: LocationSceneData;
}

const KIND_DISPLAY: Record<LocationStopKind, { label: string; icon: string; tint: string }> = {
  home: { label: 'home', icon: 'home', tint: 'var(--primary)' },
  work: { label: 'work', icon: 'business_center', tint: 'var(--orange)' },
  food: { label: 'food', icon: 'restaurant', tint: 'var(--primary-deep)' },
  transit: { label: 'transit', icon: 'directions_walk', tint: 'var(--ink-muted)' },
  other: { label: 'other', icon: 'place', tint: 'var(--coral)' },
};

function fmtClock(ts_ms: number): string {
  if (!Number.isFinite(ts_ms) || ts_ms <= 0) return '--:--';
  const d = new Date(ts_ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function LocationScene({ data }: LocationSceneProps) {
  return (
    <div
      className="glass lift"
      style={{ width: 504, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-location"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhantomIcon name="map" size={14} color="var(--primary-deep)" aria-hidden />
          <span className="eyebrow-amber">LOCATION · {data.window_display.toUpperCase()}</span>
        </div>
        <span
          className="tabular"
          style={{ fontSize: 11, color: 'var(--ink-secondary)', fontWeight: 600 }}
        >
          {data.total_distance_display} · {data.walking_display}
        </span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.stops.slice(0, 6).map((stop, i) => {
          const k = KIND_DISPLAY[stop.kind] ?? KIND_DISPLAY.other;
          return (
            <div
              key={`${stop.ts_ms}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.45)',
                border: '1px solid rgba(0,0,0,0.04)',
              }}
            >
              <PhantomIcon name={k.icon} size={16} color={k.tint} style={{ flexShrink: 0 }} aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stop.label}
                </div>
                <div style={{ fontSize: 9, color: 'var(--ink-muted)', letterSpacing: '0.06em' }}>
                  {k.label.toUpperCase()}
                </div>
              </div>
              <span className="tabular" style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>
                {fmtClock(stop.ts_ms)}
              </span>
            </div>
          );
        })}
      </div>

      {data.unknowns > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: '7px 10px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhantomIcon name="visibility_off" size={14} color="var(--coral)" aria-hidden />
          <span style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>
            {data.unknowns} unrecognised stop{data.unknowns === 1 ? '' : 's'} — label or seal?
          </span>
        </div>
      )}

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
