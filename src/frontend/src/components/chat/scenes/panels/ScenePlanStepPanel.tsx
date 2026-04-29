/**
 * Day-4 W-2 — `plan-step` scene panel.
 *
 * Single step inside a `plan` scene: title + state badge + ETA + note.
 * State maps to a colour vocabulary anchored on the existing CSS
 * variables (`--signal-ok`, `--signal-warn`, `--accent`,
 * `--ink-muted`) so dashboards stay coherent across SHADOW / FOCUS /
 * DIALOGUE state transitions.
 *
 * NOTE: until T-3 (Wave-2) wires the standing-orders runner's
 * `event_bus.standing_order.tick/fired/skipped` events through to the
 * WS hub, plan-scenes will only fill on manual-interval orders that
 * happen to tick during a chat session. D-1 in
 * `docs/DAY4_BACKLOG_EXTENSIONS.md` flags this — the renderer here
 * is ready; the upstream feeder is not.
 */
import type { ScenePanel } from '@shared/types';
import { Clock, CheckCircle2, AlertTriangle, CircleDot } from 'lucide-react';

type PlanStepPanelData = Extract<ScenePanel, { kind: 'plan-step' }>['data'];

const STATE_GLYPH = {
  pending: Clock,
  active: CircleDot,
  done: CheckCircle2,
  error: AlertTriangle,
} as const;

const STATE_COLOR = {
  pending: 'var(--ink-muted)',
  active: 'var(--accent)',
  done: 'var(--signal-ok)',
  error: 'var(--signal-warn)',
} as const;

function formatEta(eta_ms: number | undefined): string {
  if (eta_ms === undefined || eta_ms < 0) return '';
  if (eta_ms < 1000) return `${eta_ms}ms`;
  if (eta_ms < 60_000) return `${(eta_ms / 1000).toFixed(1)}s`;
  if (eta_ms < 3_600_000) return `${Math.round(eta_ms / 60_000)}m`;
  return `${Math.round(eta_ms / 3_600_000)}h`;
}

export function ScenePlanStepPanel({ data }: { data: PlanStepPanelData }) {
  const Glyph = STATE_GLYPH[data.state];
  const color = STATE_COLOR[data.state];
  const eta = formatEta(data.eta_ms);

  return (
    <div
      className="flex items-start gap-2 rounded glass-subtle px-3 py-2"
      data-testid="scene-plan-step-panel"
      data-step-state={data.state}
    >
      <Glyph
        size={14}
        strokeWidth={1.75}
        color={color}
        aria-label={`step state: ${data.state}`}
        className="mt-0.5 shrink-0"
      />
      <div className="flex flex-col min-w-0">
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-primary)',
          }}
        >
          {data.title}
        </span>
        {(eta || data.note) && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-wide)',
            }}
          >
            {eta && <span>{eta}</span>}
            {eta && data.note && <span>  ·  </span>}
            {data.note && <span>{data.note}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
