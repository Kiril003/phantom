import { motion } from 'framer-motion';
import { EASE_PHANTOM } from '../../styles/motion';

export interface DefinitionData {
  term: string;
  category?: string;
  pronunciation?: string;
  definition: string;
  examples?: string[];
}

interface Props {
  data: DefinitionData;
}

export function DefinitionResponse({ data }: Props) {
  if (!data.term && !data.definition) return null;
  const examples = data.examples ?? [];

  return (
    <motion.div
      className="rounded-md px-4 py-3"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-subtle)',
        borderLeft: '3px solid var(--signal-ok)',
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-lg)', fontWeight: 700, lineHeight: 1.1 }}>
          {data.term}
        </span>
        {data.pronunciation && (
          <span className="font-mono" style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}>
            /{data.pronunciation}/
          </span>
        )}
        {data.category && (
          <span
            className="px-1.5 py-0.5 rounded tracking-wide uppercase"
            style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--fs-micro)',
              border: '1px solid var(--line-subtle)',
            }}
          >
            {data.category}
          </span>
        )}
      </div>

      <div style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-sm, var(--fs-xs))', marginTop: 6, lineHeight: 1.5 }}>
        {data.definition}
      </div>

      {examples.length > 0 && (
        <div className="flex flex-col gap-1" style={{ marginTop: 8 }}>
          {examples.map((ex, i) => (
            <motion.div
              key={i}
              className="italic"
              style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)', paddingLeft: 10, borderLeft: '1px solid var(--line-subtle)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.06 * (i + 1), ease: EASE_PHANTOM as unknown as number[] }}
            >
              «{ex}»
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
