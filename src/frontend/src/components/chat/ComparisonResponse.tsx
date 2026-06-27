import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { EASE_PHANTOM } from '../../styles/motion';

export interface ComparisonRow {
  criterion: string;
  values: string[];
  winner?: number;
}

export interface ComparisonData {
  title?: string;
  options: string[];
  rows: ComparisonRow[];
  recommendation?: string;
}

interface Props {
  data: ComparisonData;
}

export function ComparisonResponse({ data }: Props) {
  const options = data.options ?? [];
  const rows = data.rows ?? [];
  if (options.length === 0 || rows.length === 0) return null;

  const cols = options.length;

  return (
    <motion.div
      className="rounded-md overflow-hidden"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--line-subtle)' }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_PHANTOM as unknown as number[] }}
    >
      {data.title && (
        <div
          className="px-3 py-2 tracking-wider uppercase"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)', borderBottom: '1px solid var(--line-subtle)' }}
        >
          {data.title}
        </div>
      )}

      {/* Header row — option names */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `minmax(96px, 1.2fr) repeat(${cols}, minmax(0, 1fr))`,
          borderBottom: '1px solid var(--line-subtle)',
        }}
      >
        <div className="px-3 py-2" />
        {options.map((opt, i) => (
          <div
            key={i}
            className="px-3 py-2 text-center font-medium truncate"
            style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-xs)' }}
          >
            {opt}
          </div>
        ))}
      </div>

      {/* Criterion rows */}
      {rows.map((row, ri) => (
        <motion.div
          key={ri}
          className="grid items-center"
          style={{
            gridTemplateColumns: `minmax(96px, 1.2fr) repeat(${cols}, minmax(0, 1fr))`,
            borderBottom: ri < rows.length - 1 ? '1px solid var(--line-subtle)' : 'none',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.04 * ri, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <div
            className="px-3 py-2 tracking-wide uppercase"
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
          >
            {row.criterion}
          </div>
          {(row.values ?? []).slice(0, cols).map((val, ci) => {
            const win = row.winner === ci;
            return (
              <div
                key={ci}
                className="px-3 py-2 text-center flex items-center justify-center gap-1"
                style={{
                  color: win ? 'var(--signal-ok)' : 'var(--ink-secondary)',
                  fontSize: 'var(--fs-xs)',
                  background: win ? 'color-mix(in srgb, var(--signal-ok) 8%, transparent)' : 'transparent',
                  fontWeight: win ? 600 : 400,
                }}
              >
                {win && <Crown size={11} strokeWidth={2} />}
                <span className="truncate">{val}</span>
              </div>
            );
          })}
        </motion.div>
      ))}

      {data.recommendation && (
        <div
          className="px-3 py-2"
          style={{
            color: 'var(--ink-secondary)',
            fontSize: 'var(--fs-xs)',
            borderTop: '1px solid var(--line-subtle)',
            background: 'color-mix(in srgb, var(--signal-ok) 6%, transparent)',
          }}
        >
          <span style={{ color: 'var(--signal-ok)' }}>▸ </span>
          {data.recommendation}
        </div>
      )}
    </motion.div>
  );
}
