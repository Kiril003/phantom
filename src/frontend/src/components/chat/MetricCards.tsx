import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { EASE_PHANTOM } from '../../styles/motion';

export interface MetricEntry {
  label: string;
  value: number;
  unit?: string;
  trend: 'up' | 'down' | 'stable';
  delta?: number;
  hint?: string;
}

export interface MetricCardData {
  metrics: MetricEntry[];
}

interface MetricCardsProps {
  data: MetricCardData;
}

function trendIcon(trend: MetricEntry['trend']) {
  if (trend === 'up') return ArrowUp;
  if (trend === 'down') return ArrowDown;
  return Minus;
}

function trendColor(trend: MetricEntry['trend']) {
  if (trend === 'up') return 'var(--signal-ok)';
  if (trend === 'down') return 'var(--signal-alert)';
  return 'var(--ink-muted)';
}

function formatValue(v: number): string {
  if (Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '∞';
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(abs < 10 ? 2 : 1);
}

export function MetricCards({ data }: MetricCardsProps) {
  const metrics = data.metrics ?? [];
  if (metrics.length === 0) {
    return (
      <div
        className="px-3 py-2 rounded-md font-mono"
        style={{
          background: 'var(--surface-raised)',
          border: '1px dashed var(--line-subtle)',
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-micro)',
        }}
      >
        NO METRICS
      </div>
    );
  }

  const cols = Math.min(metrics.length, 4);

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {metrics.map((m, idx) => {
        const Icon = trendIcon(m.trend);
        return (
          <motion.div
            key={`${m.label}-${idx}`}
            className="p-3 flex flex-col rounded-md"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--line-subtle)',
              minHeight: 72,
            }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: idx * 0.05, ease: EASE_PHANTOM as unknown as number[] }}
          >
            <div className="flex items-center justify-between">
              <span
                className="tracking-wider uppercase truncate"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
              >
                {m.label}
              </span>
              <div
                className="flex items-center gap-0.5"
                style={{ color: trendColor(m.trend) }}
              >
                <Icon size={11} strokeWidth={2} />
                {m.delta != null && (
                  <span className="font-mono tabular-nums" style={{ fontSize: 'var(--fs-micro)' }}>
                    {m.delta > 0 ? '+' : ''}
                    {formatValue(m.delta)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-baseline gap-1 mt-auto pt-1">
              <span
                className="font-mono tabular-nums"
                style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-lg)', lineHeight: 1 }}
              >
                {formatValue(m.value)}
              </span>
              {m.unit && (
                <span
                  style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-xs)' }}
                >
                  {m.unit}
                </span>
              )}
            </div>
            {m.hint && (
              <span
                className="truncate"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
              >
                {m.hint}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
