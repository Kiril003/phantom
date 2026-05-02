/**
 * Phase 16 — AgentSessionHistory.
 *
 * Modal-style overlay that lets the operator browse past task runs and dive
 * into one for the full report / timeline / decisions / audit. Reads from
 * agentStore.historyTasks (populated via agentApi.listTasks). The detail view
 * is rendered inline (composes AgentSessionDetail) instead of routing — the
 * project's UI shell is layout-state-driven, not URL-driven.
 *
 * Filters: status (all / done / failed / stopped / blocked_quota / paused),
 * track (all / foreground / background), and a debounced text query against
 * the goal field.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Filter,
  Clock,
  Check,
  AlertTriangle,
  CircleSlash,
  Pause,
  Hourglass,
  Search,
} from 'lucide-react';
import type { AgentTaskStatus, AgentTaskSummary } from '@shared/types';
import { useAgentStore } from '../../stores/agentStore';
import { AgentSessionDetail } from './AgentSessionDetail';

interface Props {
  open: boolean;
  onClose: () => void;
  onContinueAsConversation?: (taskId: string) => void;
}

const STATUS_FILTERS: Array<{ id: AgentTaskStatus | 'all'; label: string }> = [
  { id: 'all', label: 'Усі' },
  { id: 'done', label: 'Готово' },
  { id: 'failed', label: 'Провал' },
  { id: 'stopped', label: 'Зупинено' },
  { id: 'paused', label: 'На паузі' },
  { id: 'blocked_quota', label: 'Квота' },
];

function StatusIcon({ status }: { status: AgentTaskStatus }) {
  const props = { size: 14 };
  switch (status) {
    case 'done':
      return <Check {...props} color="#0E6A2A" />;
    case 'failed':
      return <AlertTriangle {...props} color="#B9201F" />;
    case 'stopped':
      return <CircleSlash {...props} color="#A36F1F" />;
    case 'paused':
      return <Pause {...props} color="#5B4A2E" />;
    case 'blocked_quota':
      return <Hourglass {...props} color="#A36F1F" />;
    default:
      return <Clock {...props} color="var(--ink-muted)" />;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRelDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ds = new Date(start).getTime();
  const de = new Date(end).getTime();
  if (!Number.isFinite(ds) || !Number.isFinite(de)) return '—';
  const s = Math.max(0, Math.round((de - ds) / 1000));
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}хв ${rs}с` : `${m}хв`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}год ${rm}хв` : `${h}год`;
}

function HistoryRow({
  task,
  onOpen,
}: {
  task: AgentTaskSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: 'left',
        background: 'rgba(255,255,255,0.50)',
        border: '1px solid rgba(180,150,90,0.18)',
        borderRadius: 12,
        padding: '10px 14px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 12,
        alignItems: 'center',
        minHeight: 56,
        cursor: 'pointer',
        transition: 'transform 0.12s ease, background 0.12s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'rgba(244,175,37,0.10)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'rgba(255,255,255,0.50)';
      }}
      aria-label={`Відкрити сесію: ${task.goal}`}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: 'rgba(244,175,37,0.16)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <StatusIcon status={task.status} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: 'var(--ink-strong)',
            fontWeight: 500,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {task.goal || '(без назви)'}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 2,
            fontSize: 11,
            color: 'var(--ink-muted)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <span>{fmtDate(task.created_at)}</span>
          <span>· {fmtRelDuration(task.created_at, task.finished_at)}</span>
          <span>· {task.track}</span>
          {task.error && (
            <span style={{ color: '#B9201F' }}>· {task.error.slice(0, 40)}</span>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {task.status}
      </span>
    </button>
  );
}

export function AgentSessionHistory({
  open,
  onClose,
  onContinueAsConversation,
}: Props) {
  const tasks = useAgentStore((s) => s.historyTasks);
  const loading = useAgentStore((s) => s.historyLoading);
  const error = useAgentStore((s) => s.historyError);
  const loadHistory = useAgentStore((s) => s.loadHistory);

  const [statusFilter, setStatusFilter] = useState<AgentTaskStatus | 'all'>('all');
  const [trackFilter, setTrackFilter] = useState<'all' | 'foreground' | 'background'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    loadHistory(undefined, 100).catch(() => {
      /* error already captured in store */
    });
  }, [open, loadHistory]);

  const filtered = useMemo(() => {
    return tasks
      .filter((t) => statusFilter === 'all' || t.status === statusFilter)
      .filter((t) => trackFilter === 'all' || t.track === trackFilter)
      .filter((t) => !query || t.goal.toLowerCase().includes(query.toLowerCase()));
  }, [tasks, statusFilter, trackFilter, query]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 64,
            background: 'rgba(28,22,14,0.55)',
            backdropFilter: 'blur(10px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="glass-strong"
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              right: 24,
              bottom: 24,
              borderRadius: 20,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow:
                '0 24px 60px rgba(120,70,10,0.32), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Історія агента"
          >
            {selected ? (
              <AgentSessionDetail
                task={selected}
                onBack={() => setSelectedId(null)}
                onClose={onClose}
                onContinueAsConversation={onContinueAsConversation}
              />
            ) : (
              <>
                <header
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <span className="eyebrow-amber" style={{ fontSize: 11 }}>
                      ІСТОРІЯ АГЕНТА
                    </span>
                    <h2
                      style={{
                        margin: '4px 0 0 0',
                        fontSize: 18,
                        color: 'var(--ink-strong)',
                      }}
                    >
                      Минулі прогони
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      border: '1px solid rgba(180,150,90,0.30)',
                      background: 'transparent',
                      color: 'var(--ink-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    aria-label="Закрити історію"
                  >
                    <X size={18} />
                  </button>
                </header>

                {/* Filters */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <Filter size={14} color="var(--ink-muted)" />
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setStatusFilter(f.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        border: '1px solid rgba(180,150,90,0.25)',
                        background:
                          statusFilter === f.id
                            ? 'rgba(244,175,37,0.22)'
                            : 'transparent',
                        color:
                          statusFilter === f.id
                            ? '#A36F1F'
                            : 'var(--ink-muted)',
                        cursor: 'pointer',
                        minHeight: 32,
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                  <span style={{ width: 12 }} />
                  {(['all', 'foreground', 'background'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTrackFilter(t)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        border: '1px solid rgba(180,150,90,0.25)',
                        background:
                          trackFilter === t
                            ? 'rgba(244,175,37,0.22)'
                            : 'transparent',
                        color:
                          trackFilter === t ? '#A36F1F' : 'var(--ink-muted)',
                        cursor: 'pointer',
                        minHeight: 32,
                      }}
                    >
                      {t === 'all' ? 'Усі шляхи' : t}
                    </button>
                  ))}
                  <div
                    style={{
                      marginLeft: 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid rgba(180,150,90,0.25)',
                      minHeight: 32,
                    }}
                  >
                    <Search size={12} color="var(--ink-muted)" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Пошук цілі"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontSize: 12,
                        color: 'var(--ink-strong)',
                        width: 180,
                      }}
                    />
                  </div>
                </div>

                {/* List */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    paddingRight: 6,
                  }}
                >
                  {loading && (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 24,
                        color: 'var(--ink-muted)',
                      }}
                    >
                      Завантажую…
                    </div>
                  )}
                  {error && (
                    <div
                      style={{
                        padding: 12,
                        color: '#B9201F',
                        background: 'rgba(185,32,31,0.08)',
                        borderRadius: 12,
                      }}
                    >
                      Помилка: {error}
                    </div>
                  )}
                  {!loading && filtered.length === 0 && !error && (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 28,
                        color: 'var(--ink-muted)',
                        fontStyle: 'italic',
                      }}
                    >
                      Немає прогонів за цими фільтрами.
                    </div>
                  )}
                  {filtered.map((t) => (
                    <HistoryRow key={t.id} task={t} onOpen={() => setSelectedId(t.id)} />
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
