/**
 * Phase-5 R1 — AlarmScene (B-17).
 *
 * Inline glass card returned from `alarm.create` / `alarm.update`. Mirrors
 * the design DNA from `docs/design-handoff/batch-2/project/screen-14-inline-batch2.jsx`
 * → `SceneAlarm`: amber spine on the left, big tabular `HH:MM`, side
 * weekday/date stack, sound chip with miniature waveform + play button,
 * "repeat daily" toggle, three action buttons, Playfair italic
 * commentary line.
 *
 * Pure render. The toggle is visual-only; emit `data-alarm-action` for
 * a parent listener to wire.
 */
import { useEffect, useState } from 'react';
import type { AlarmSceneData } from '@shared/types';

interface AlarmSceneProps {
  data: AlarmSceneData;
}

const DEFAULT_WAVEFORM = [3, 6, 4, 8, 5, 9, 5, 7, 4, 6, 3];

function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) return `${hours}г ${mins}хв`;
  return `${mins}хв`;
}

export function AlarmScene({ data }: AlarmSceneProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (data.fire_at_ms <= now) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [data.fire_at_ms, now]);

  const currentFiresInMs = Math.max(0, data.fire_at_ms - now);

  const waveform = (data.sound_waveform && data.sound_waveform.length > 0
    ? data.sound_waveform
    : DEFAULT_WAVEFORM
  ).slice(0, 16);

  return (
    <div
      className="glass lift"
      style={{ width: 504, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}
      data-testid="scene-alarm"
      data-alarm-id={data.alarm_id}
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
          alarm
        </span>
        <span className="eyebrow-amber" style={{ fontSize: 10 }}>
          БУДИЛЬНИК · {data.repeat_daily ? 'ЩОДНЯ' : 'ОДНОРАЗОВО'}
        </span>
        <span style={{ flex: 1 }} />
        <span className="micro-label">{data.weekday}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginLeft: 8, marginTop: 10 }}>
        <span
          className="tabular"
          style={{
            fontSize: 52,
            fontWeight: 200,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            color: 'var(--ink-primary)',
          }}
        >
          {data.display_time}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            {data.display_weekday_short}
          </span>
          <span
            className="tabular"
            style={{ fontSize: 11, color: 'var(--ink-muted)' }}
          >
            {data.display_date}
          </span>
        </div>
      </div>

      <div
        className="sub-glass"
        style={{
          padding: '6px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          borderRadius: 'var(--radius-pill)',
          alignSelf: 'flex-start',
          marginLeft: 8,
          marginTop: 10,
        }}
      >
        <span className="msym" aria-hidden style={{ fontSize: 12, color: 'var(--primary-deep)' }}>
          music_note
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-primary)' }}>{data.sound}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, height: 12 }} aria-hidden>
          {waveform.map((h, i) => (
            <span
              key={i}
              style={{
                width: 1.5,
                height: Math.max(2, Math.round(h * (h > 1 ? 1 : 12))),
                background: 'var(--primary)',
                borderRadius: 1,
              }}
            />
          ))}
        </span>
        <button
          type="button"
          aria-label="Preview sound"
          data-alarm-action="preview-sound"
          data-alarm-id={data.alarm_id}
          style={{
            width: 24,
            height: 24,
            minWidth: 24,
            minHeight: 24,
            borderRadius: 'var(--radius-pill)',
            marginLeft: 4,
            background: 'rgba(244,175,37,0.2)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary-deep)',
          }}
        >
          <span className="msym" aria-hidden style={{ fontSize: 12 }}>
            play_arrow
          </span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, marginTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>повторювати щодня</span>
        <span style={{ flex: 1 }} />
        <span
          aria-hidden
          style={{
            width: 30,
            height: 16,
            borderRadius: 'var(--radius-pill)',
            background: data.repeat_daily ? 'var(--primary)' : 'rgba(0,0,0,0.10)',
            position: 'relative',
            transition: 'background 0.2s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: data.repeat_daily ? 16 : 2,
              top: 2,
              width: 12,
              height: 12,
              borderRadius: 'var(--radius-pill)',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              transition: 'left 0.2s',
            }}
          />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginLeft: 8, marginTop: 12 }}>
        <button
          type="button"
          data-alarm-action="save"
          data-alarm-id={data.alarm_id}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg,var(--primary),var(--orange))',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            fontFamily: 'var(--font-display)',
          }}
        >
          ЗБЕРЕГТИ
        </button>
        <button
          type="button"
          className="sub-glass"
          data-alarm-action="edit"
          data-alarm-id={data.alarm_id}
          style={{
            minHeight: 44,
            padding: '0 12px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--ink-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          Edit
        </button>
        <button
          type="button"
          data-alarm-action="cancel"
          data-alarm-id={data.alarm_id}
          style={{
            minHeight: 44,
            padding: '0 12px',
            borderRadius: 8,
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            fontSize: 11,
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font-display)',
          }}
        >
          Cancel
        </button>
      </div>

      {data.ai_note && (
        <div
          className="playfair"
          style={{
            marginLeft: 8,
            marginTop: 10,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--ink-muted)',
            lineHeight: 1.4,
          }}
        >
          “{data.ai_note}”
        </div>
      )}
      {!data.ai_note && currentFiresInMs > 0 && (
        <div
          className="playfair"
          style={{
            marginLeft: 8,
            marginTop: 10,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--ink-muted)',
            lineHeight: 1.4,
          }}
        >
          Через {formatCountdown(currentFiresInMs)}.
        </div>
      )}
    </div>
  );
}
