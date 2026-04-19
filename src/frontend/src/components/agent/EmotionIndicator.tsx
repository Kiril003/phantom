import type { AgentEmotionVector } from '@shared/types';

interface Props {
  emotion: AgentEmotionVector | null;
}

/**
 * Phase 9.3a — subtle four-axis emotion indicator.
 *
 * Not a gauge, not a dashboard — a row of thin bars next to the substate
 * chip so the operator can glance and see "tired / concerned / curious"
 * without the emotion dominating the panel. Returns null when no task is
 * active so an idle panel stays clean.
 */
const AXES: { key: keyof AgentEmotionVector; label: string; color: string }[] = [
  { key: 'focus',     label: 'F', color: 'var(--signal-info)' },
  { key: 'curiosity', label: 'C', color: 'var(--chart-2)' },
  { key: 'concern',   label: '!', color: 'var(--signal-warn)' },
  { key: 'fatigue',   label: 'z', color: 'var(--ink-muted)' },
];

export function EmotionIndicator({ emotion }: Props) {
  if (!emotion) return null;
  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="emotion-indicator"
      aria-label="Emotion vector"
      title={
        `focus ${emotion.focus.toFixed(2)} · ` +
        `curiosity ${emotion.curiosity.toFixed(2)} · ` +
        `concern ${emotion.concern.toFixed(2)} · ` +
        `fatigue ${emotion.fatigue.toFixed(2)}`
      }
    >
      {AXES.map((axis) => {
        const value = Number(emotion[axis.key] ?? 0);
        const height = Math.max(2, Math.min(16, Math.round(value * 16)));
        return (
          <div
            key={axis.key}
            className="flex flex-col items-center gap-0.5"
            data-testid={`emotion-axis-${axis.key}`}
          >
            <div
              style={{
                width: 3,
                height: 16,
                background: 'color-mix(in srgb, var(--ink-muted) 25%, transparent)',
                borderRadius: 1,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  width: '100%',
                  height,
                  background: axis.color,
                  transition: 'height 400ms ease-out',
                }}
              />
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 8,
                color: 'var(--ink-faint)',
                lineHeight: 1,
              }}
            >
              {axis.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
