import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { EASE_PHANTOM } from '../../styles/motion';

export interface StatData {
  value: string;
  label: string;
  unit?: string;
  delta?: string;
  trend?: 'up' | 'down' | 'stable';
  source?: string;
}

interface Props {
  data: StatData;
}

function trendIcon(trend: StatData['trend']) {
  if (trend === 'up') return ArrowUp;
  if (trend === 'down') return ArrowDown;
  return Minus;
}

function trendColor(trend: StatData['trend']) {
  if (trend === 'up') return 'var(--signal-ok)';
  if (trend === 'down') return 'var(--signal-alert)';
  return 'var(--ink-muted)';
}

export function StatHighlightResponse({ data }: Props) {
  if (!data.value) return null;
  const Icon = trendIcon(data.trend);

  return (
    <motion.div
      className="rounded-md px-4 py-3 flex flex-col items-center text-center"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--line-subtle)' }}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <span
        className="tracking-wider uppercase"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
      >
        {data.label}
      </span>
      <div className="flex items-baseline gap-1.5" style={{ marginTop: 4 }}>
        <motion.span
          className="font-mono tabular-nums"
          style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-xl, var(--fs-lg))', fontWeight: 700, lineHeight: 1 }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.06, ease: EASE_PHANTOM as unknown as number[] }}
        >
          {data.value}
        </motion.span>
        {data.unit && (
          <span style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-sm, var(--fs-xs))' }}>
            {data.unit}
          </span>
        )}
      </div>
      {data.delta && (
        <div className="flex items-center gap-1" style={{ color: trendColor(data.trend), marginTop: 4 }}>
          <Icon size={12} strokeWidth={2} />
          <span className="font-mono tabular-nums" style={{ fontSize: 'var(--fs-xs)' }}>
            {data.delta}
          </span>
        </div>
      )}
      {data.source && (
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)', marginTop: 4 }}>
          {data.source}
        </span>
      )}
    </motion.div>
  );
}
