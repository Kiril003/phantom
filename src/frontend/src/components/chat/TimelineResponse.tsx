import { motion } from 'framer-motion';
import { EASE_PHANTOM } from '../../styles/motion';

export interface TimelineEvent {
  time?: string;
  title: string;
  detail?: string;
  status?: 'done' | 'active' | 'future';
}

export interface TimelineData {
  title?: string;
  events: TimelineEvent[];
}

interface Props {
  data: TimelineData;
}

function dotColor(status: TimelineEvent['status']) {
  if (status === 'done') return 'var(--signal-ok)';
  if (status === 'active') return 'var(--accent, var(--signal-ok))';
  return 'var(--ink-muted)';
}

export function TimelineResponse({ data }: Props) {
  const events = data.events ?? [];
  if (events.length === 0) return null;

  return (
    <div
      className="rounded-md px-3 py-3"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--line-subtle)' }}
    >
      {data.title && (
        <div
          className="tracking-wider uppercase mb-3"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
        >
          {data.title}
        </div>
      )}
      <div className="flex flex-col">
        {events.map((ev, i) => {
          const last = i === events.length - 1;
          const active = ev.status === 'active';
          return (
            <motion.div
              key={i}
              className="grid"
              style={{ gridTemplateColumns: 'auto 1fr', columnGap: 12 }}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: 0.05 * i, ease: EASE_PHANTOM as unknown as number[] }}
            >
              {/* Rail + dot */}
              <div className="flex flex-col items-center">
                <span
                  className="rounded-full"
                  style={{
                    width: active ? 11 : 9,
                    height: active ? 11 : 9,
                    marginTop: 3,
                    background: dotColor(ev.status),
                    boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${dotColor('active')} 22%, transparent)` : 'none',
                  }}
                />
                {!last && (
                  <span
                    className="flex-1"
                    style={{ width: 1, minHeight: 18, background: 'var(--line-subtle)', marginTop: 2 }}
                  />
                )}
              </div>
              {/* Content */}
              <div className="pb-3">
                <div className="flex items-baseline gap-2">
                  <span style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
                    {ev.title}
                  </span>
                  {ev.time && (
                    <span className="font-mono tabular-nums" style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>
                      {ev.time}
                    </span>
                  )}
                </div>
                {ev.detail && (
                  <div style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-xs)', marginTop: 2 }}>
                    {ev.detail}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
