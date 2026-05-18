/**
 * Phase 16 — AgentSessionDetail.
 *
 * Detail view embedded inside AgentSessionHistory. Tabs:
 *   • Звіт — TaskReport rendered compactly (re-uses sections from AgentReportScreen layout)
 *   • Хронологія — slim audit + observation timeline
 *   • Рішення — list of KeyDecisions with verdict / confidence / objection
 *   • Аудит — raw audit table (last N entries)
 *
 * Loads its own data (report + audit) lazily when this view opens. The parent
 * (AgentSessionHistory) handles the modal chrome; we only render the inner
 * content.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  X,
  ArrowRightCircle,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Scale,
  ListTree,
  Activity,
  ScrollText,
} from 'lucide-react';
import type {
  AgentAuditEntry,
  AgentKeyDecision,
  AgentTaskReport,
  AgentTaskSummary,
} from '@shared/types';
import { agentApi } from '../../../services/agentApi';
import { useAgentStore } from '../../../stores/agentStore';

type Tab = 'report' | 'timeline' | 'decisions' | 'audit';

interface Props {
  task: AgentTaskSummary;
  onBack: () => void;
  onClose: () => void;
  onContinueAsConversation?: (taskId: string) => void;
}

const TAB_DEFS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'report', label: 'Звіт', icon: <ListTree size={14} /> },
  { id: 'timeline', label: 'Хронологія', icon: <Activity size={14} /> },
  { id: 'decisions', label: 'Рішення', icon: <Scale size={14} /> },
  { id: 'audit', label: 'Аудит', icon: <ScrollText size={14} /> },
];

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ReportTab({ report }: { report: AgentTaskReport | null }) {
  if (!report) return <Loading label="Готую звіт…" />;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
    >
      <DetailCard title="Досягнуто" icon={<CheckCircle2 size={14} />} accent="#0E6A2A">
        {bullets(report.achievements)}
      </DetailCard>
      <DetailCard title="Перешкоди" icon={<AlertTriangle size={14} />} accent="#A36F1F">
        {bullets(report.obstacles)}
      </DetailCard>
      <DetailCard title="Ключові рішення" icon={<Scale size={14} />} accent="var(--ink-muted)">
        {report.key_decisions.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {report.key_decisions.map((d, i) => (
              <DecisionRowMini key={i} d={d} />
            ))}
          </div>
        )}
      </DetailCard>
      <DetailCard title="Що далі" icon={<Compass size={14} />} accent="#A36F1F">
        {bullets(report.next_steps)}
      </DetailCard>
    </div>
  );
}

function TimelineTab({ report }: { report: AgentTaskReport | null }) {
  if (!report) return <Loading label="Завантажую хронологію…" />;
  if (report.audit_trail_compact.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        Без записаних дій.
      </span>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      {report.audit_trail_compact.map((row) => (
        <div
          key={row.audit_id}
          style={{
            display: 'grid',
            gridTemplateColumns: '46px 110px 1fr auto',
            gap: 8,
            alignItems: 'center',
            padding: '4px 8px',
            background: row.ok ? 'rgba(34,197,94,0.06)' : 'rgba(185,32,31,0.08)',
            border: '1px solid rgba(180,150,90,0.16)',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--ink-muted)' }}
          >
            #{row.step_idx}
          </span>
          <span
            style={{
              fontWeight: 600,
              color: row.ok ? '#0E6A2A' : '#B9201F',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 11,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.action}
          </span>
          <span
            style={{
              color: 'var(--ink-strong)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.intent || '—'}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 10, color: 'var(--ink-muted)' }}
          >
            {row.elapsed_ms}ms
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionsTab({ report }: { report: AgentTaskReport | null }) {
  if (!report) return <Loading label="Збираю рішення…" />;
  if (report.key_decisions.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        Цей прогон обійшовся без рефлексій-розгалужень.
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
      {report.key_decisions.map((d, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(180,150,90,0.20)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: '#A36F1F',
              }}
            >
              крок #{d.step_idx} · {d.verdict}
            </span>
            <span
              className="font-mono"
              style={{ fontSize: 11, color: 'var(--ink-muted)' }}
            >
              cf {d.confidence.toFixed(2)} · {fmtTime(d.ts)}
            </span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--ink-strong)', lineHeight: 1.35 }}>
            {d.summary}
          </span>
          {d.objection && (
            <span style={{ fontSize: 12, color: '#A36F1F', fontStyle: 'italic', lineHeight: 1.3 }}>
              ↪ {d.objection}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTab({ rows, loading }: { rows: AgentAuditEntry[]; loading: boolean }) {
  if (loading) return <Loading label="Підтягую аудит…" />;
  if (rows.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        Аудит-лог порожній (можливо, прогін не дійшов до виконання дій).
      </span>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflowY: 'auto',
        flex: 1,
        minHeight: 0,
      }}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.50)',
            border: '1px solid rgba(180,150,90,0.16)',
            borderRadius: 8,
            display: 'grid',
            gridTemplateColumns: '50px 1fr auto',
            gap: 10,
            fontSize: 11,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <span style={{ color: 'var(--ink-muted)' }}>#{row.step_idx}</span>
          <span
            style={{
              color: row.result.ok ? 'var(--ink-strong)' : '#B9201F',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.action_name}
            {row.intent ? ` · ${row.intent}` : ''}
          </span>
          <span style={{ color: 'var(--ink-muted)' }}>
            {row.elapsed_ms}ms · {fmtTime(row.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

function bullets(items: string[]) {
  if (!items || items.length === 0)
    return <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>;
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {items.map((it, i) => (
        <li
          key={i}
          style={{ fontSize: 12, color: 'var(--ink-strong)', lineHeight: 1.35 }}
        >
          • {it}
        </li>
      ))}
    </ul>
  );
}

function DetailCard({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="glass-card"
      style={{
        borderRadius: 12,
        border: '1px solid rgba(180,150,90,0.20)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: accent,
          fontSize: 11,
          letterSpacing: '0.06em',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {icon}
        {title}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}

function DecisionRowMini({ d }: { d: AgentKeyDecision }) {
  return (
    <div
      style={{
        padding: '4px 6px',
        background: 'rgba(244,175,37,0.08)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--ink-strong)',
        lineHeight: 1.3,
      }}
    >
      <span style={{ fontWeight: 600, marginRight: 4 }}>{d.verdict}:</span>
      {d.summary}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ padding: 20, color: 'var(--ink-muted)', textAlign: 'center' }}>
      {label}
    </div>
  );
}

export function AgentSessionDetail({
  task,
  onBack,
  onClose,
  onContinueAsConversation,
}: Props) {
  const [tab, setTab] = useState<Tab>('report');
  const [report, setReport] = useState<AgentTaskReport | null>(null);
  const [audit, setAudit] = useState<AgentAuditEntry[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const setConversationSeed = useAgentStore((s) => s.setConversationSeed);

  useEffect(() => {
    let cancelled = false;
    setLoadingReport(true);
    setError(null);
    agentApi
      .getReport(task.id, true)
      .then((resp) => {
        if (!cancelled) setReport(resp.report);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    if (tab !== 'audit' || audit.length > 0) return;
    let cancelled = false;
    setLoadingAudit(true);
    agentApi
      .audit(task.id, 200)
      .then((resp) => {
        if (!cancelled) setAudit(resp.audit);
      })
      .catch(() => {
        /* surfaced via error if needed */
      })
      .finally(() => {
        if (!cancelled) setLoadingAudit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, task.id, audit.length]);

  const subtitle = useMemo(() => {
    const ts = task.created_at
      ? new Date(task.created_at).toLocaleString('uk-UA', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
    return `${ts} · ${task.track} · ${task.status}`;
  }, [task]);

  const handleResume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const seed = await agentApi.resumeAsConversation(task.id);
      setConversationSeed(seed);
      onContinueAsConversation?.(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to resume');
    } finally {
      setResuming(false);
    }
  };

  return (
    <motion.div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
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
          aria-label="Назад до списку"
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow-amber" style={{ fontSize: 11 }}>
            СЕСІЯ
          </span>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--ink-strong)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {task.goal || '(без назви)'}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-muted)',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          style={{
            minHeight: 44,
            padding: '0 12px',
            borderRadius: 12,
            background:
              'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)',
            border: '1px solid rgba(168,118,18,0.45)',
            color: '#1F1308',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: resuming ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
          aria-label="Продовжити як розмову"
        >
          <ArrowRightCircle size={14} />
          Продовжити
        </button>
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {TAB_DEFS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(180,150,90,0.25)',
              background:
                tab === t.id ? 'rgba(244,175,37,0.18)' : 'transparent',
              color: tab === t.id ? '#A36F1F' : 'var(--ink-muted)',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              minHeight: 36,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        {error && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#B9201F' }}>
            <RotateCcw
              size={11}
              style={{ marginRight: 4, verticalAlign: 'middle' }}
            />
            {error}
          </span>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {tab === 'report' && (
          <>{loadingReport ? <Loading label="Готую звіт…" /> : <ReportTab report={report} />}</>
        )}
        {tab === 'timeline' && <TimelineTab report={report} />}
        {tab === 'decisions' && <DecisionsTab report={report} />}
        {tab === 'audit' && <AuditTab rows={audit} loading={loadingAudit} />}
      </div>
    </motion.div>
  );
}
