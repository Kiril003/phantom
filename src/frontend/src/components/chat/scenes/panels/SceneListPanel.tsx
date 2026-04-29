/**
 * Day-4 W-2 — `list` scene panel.
 *
 * Compact two-column list (label / value) with optional trend glyph.
 * Used for metric snapshots, recall results, status enumerations.
 * Trend glyphs are non-decorative — `up` / `down` / `stable` are the
 * three states recognised by the closed enum in `chat.ts`.
 */
import type { ScenePanel } from '@shared/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

type ListPanelData = Extract<ScenePanel, { kind: 'list' }>['data'];

const TREND_GLYPH = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
} as const;

const TREND_COLOR = {
  up: 'var(--signal-ok)',
  down: 'var(--signal-warn)',
  stable: 'var(--ink-muted)',
} as const;

export function SceneListPanel({ data }: { data: ListPanelData }) {
  return (
    <ul
      className="flex flex-col gap-1.5"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--ink-primary)',
      }}
      data-testid="scene-list-panel"
    >
      {data.items.map((item, idx) => {
        const TrendIcon = item.trend ? TREND_GLYPH[item.trend] : null;
        return (
          <li
            key={`${item.label}-${idx}`}
            className="flex items-center justify-between gap-3"
          >
            <span style={{ color: 'var(--ink-secondary)' }}>{item.label}</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {item.value !== undefined && <span>{item.value}</span>}
              {TrendIcon && (
                <TrendIcon
                  size={12}
                  strokeWidth={1.75}
                  color={TREND_COLOR[item.trend!]}
                  aria-label={`trend: ${item.trend}`}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
