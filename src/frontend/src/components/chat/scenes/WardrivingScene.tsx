/**
 * Phase-5 R1 — WardrivingScene (B-17).
 *
 * Inline glass card returned from `wardriving.peek`. Mirrors the design
 * DNA from `docs/design-handoff/batch-2/project/screen-14-inline-batch2.jsx`
 * → `SceneWardriving`: amber spine, RSSI heatmap grid (rows × cols of
 * amber→coral cells), pinned hotspots overlaid, top-3 BSSID side list,
 * security-pill counters, Playfair italic NEXUS commentary.
 *
 * Pure render. The full BSSID is never displayed — privacy guarded.
 */
import type { WardrivingSceneData, WardrivingSecurity } from '@shared/types';

interface WardrivingSceneProps {
  data: WardrivingSceneData;
}

const SECURITY_STYLES: Record<WardrivingSecurity, { glyph: string; tint: string }> = {
  open: { glyph: '🔓 open', tint: 'var(--signal-alert)' },
  wpa2: { glyph: '🔒 wpa2', tint: 'var(--orange)' },
  wpa3: { glyph: '🛡 wpa3', tint: 'var(--primary)' },
};

export function WardrivingScene({ data }: WardrivingSceneProps) {
  const grid = data.heatmap;
  return (
    <div
      className="glass lift"
      style={{
        width: 540,
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      data-testid="scene-wardriving"
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: 'linear-gradient(180deg,var(--primary),var(--orange))',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
        <span className="msym" aria-hidden style={{ fontSize: 16, color: 'var(--primary-deep)' }}>
          cell_tower
        </span>
        <span className="eyebrow-amber" style={{ fontSize: 10 }}>
          WARDRIVING · {data.window_display.toUpperCase()} · {data.area_display.toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 180, marginLeft: 8 }}>
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minHeight: 140,
          }}
        >
          {grid.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: 2, flex: 1 }}>
              {row.map((v, ci) => {
                const safe = Math.max(0, Math.min(1, v));
                return (
                  <div
                    key={ci}
                    style={{
                      flex: 1,
                      borderRadius: 3,
                      background: `linear-gradient(135deg,
                        rgba(244,175,37,${0.2 * safe}) 0%,
                        rgba(251,146,60,${0.6 * safe}) 60%,
                        rgba(239,68,68,${0.9 * safe}) 100%)`,
                      border: '1px solid rgba(255,255,255,0.4)',
                    }}
                  />
                );
              })}
            </div>
          ))}
          {data.hotspots.map((pin, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${Math.max(0, Math.min(100, pin.x_pct))}%`,
                top: `${Math.max(0, Math.min(100, pin.y_pct))}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--ink-primary)',
                background: 'rgba(255,255,255,0.85)',
                padding: '1px 5px',
                borderRadius: 3,
                fontFamily: 'var(--font-display)',
              }}
            >
              ● {pin.label}
            </span>
          ))}
        </div>

        <div style={{ width: 138, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="micro-label">TOP RSSI</div>
          {data.top_aps.slice(0, 3).map((ap, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>
                {ap.bssid_prefix}
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="tabular"
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-deep)' }}
              >
                {ap.best_rssi}
              </span>
              <span style={{ fontSize: 9, color: 'var(--ink-muted)' }}>×{ap.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
        {(['open', 'wpa2', 'wpa3'] as WardrivingSecurity[]).map((sec) => {
          const styles = SECURITY_STYLES[sec];
          const count = data.security_counts[sec] ?? 0;
          return (
            <span
              key={sec}
              className="sub-glass"
              style={{
                padding: '3px 8px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--ink-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {styles.glyph}{' '}
              <span className="tabular" style={{ color: styles.tint, fontWeight: 700 }}>
                {count}
              </span>
            </span>
          );
        })}
      </div>

      {data.ai_note && (
        <div
          className="playfair"
          style={{
            marginLeft: 8,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--ink-muted)',
            lineHeight: 1.4,
          }}
        >
          “{data.ai_note}”
        </div>
      )}
    </div>
  );
}
