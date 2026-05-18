/**
 * Phase 9.2.1 — per-task LLM-call budget strip.
 * Sits beside ThoughtBudget on the AgentPanel header.
 *
 * Colors track free-tier reality: green under 20 (≤ 1 day's worth on the
 * Gemini 2.5-flash 20-call free quota), amber 20-35, red 35+.
 */
const HARD_CAP_FALLBACK = 50;
const WARN_THRESHOLD = 20;
const ALERT_THRESHOLD = 35;

export function LLMCallBudget({ used, cap }: { used: number; cap?: number }) {
  const limit = cap ?? HARD_CAP_FALLBACK;
  const color =
    used >= ALERT_THRESHOLD
      ? 'var(--signal-alert)'
      : used >= WARN_THRESHOLD
        ? 'var(--signal-warn)'
        : 'var(--signal-ok)';
  const fillPct = Math.min(100, (used / Math.max(1, limit)) * 100);

  return (
    <div className="flex flex-col gap-0.5" data-testid="llm-call-budget">
      <div
        className="flex justify-between font-mono"
        style={{ fontSize: 'var(--fs-xxs, 10px)', color: 'var(--ink-muted)' }}
      >
        <span>Compute</span>
        <span title="LLM calls used this task">
          {used} / {limit}
        </span>
      </div>
      <div
        style={{
          height: 4,
          width: '100%',
          background: 'var(--glass-border)',
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: color,
            transition: 'all 300ms ease',
            boxShadow: `0 0 8px ${color}`,
          }}
          data-testid="llm-call-budget-fill"
        />
      </div>
    </div>
  );
}
