import type { AgentObservation } from '@shared/types';

const TYPE_COLOR: Record<AgentObservation['type'], string> = {
  result:      'var(--signal-ok)',
  error:       'var(--signal-alert)',
  reflection:  'var(--signal-info)',
  user_input:  'var(--accent)',
  env_change:  'var(--signal-warn)',
  system:      'var(--ink-muted)',
};

export function ObservationCard({ observation }: { observation: AgentObservation }) {
  const color = TYPE_COLOR[observation.type] ?? 'var(--ink-muted)';
  return (
    <div
      className="flex flex-col gap-1 px-2 py-1.5"
      style={{
        background: 'var(--glass-subtle)',
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
        borderRadius: 8,
      }}
    >
      <div className="flex items-center gap-2 font-mono" style={{ fontSize: 'var(--fs-xxs)' }}>
        <span style={{ color, letterSpacing: 'var(--tracking-wider)' }}>
          {observation.type.toUpperCase()}
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>·</span>
        <span style={{ color: 'var(--ink-muted)' }}>{observation.source}</span>
      </div>
      <span style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}>{observation.content}</span>
      {observation.entities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {observation.entities.map((e) => (
            <span
              key={e}
              className="font-mono"
              style={{
                fontSize: 'var(--fs-xxs)',
                color: 'var(--ink-muted)',
                background: 'var(--glass-border)',
                padding: '1px 6px',
                borderRadius: 6,
              }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
