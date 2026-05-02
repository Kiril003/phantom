/**
 * Phase 16 — AgentReportScreen.
 *
 * Full-frame modal that surfaces the structured TaskReport at the moment a
 * task finalizes. The OPERATOR state is intentionally NOT exited until the
 * operator picks a CTA here (close / continue-as-conversation), so the
 * narrative isn't lost the way it was before this phase. Sized to fit the
 * 1024×600 frame with no main-screen scroll: only the audit-trail rail uses
 * an internal scrollbar.
 */
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  Compass,
  Scale,
  X,
  ArrowRightCircle,
  History,
  Link2,
  FileText,
  ChevronRight,
} from 'lucide-react';
import type {
  AgentEvidenceLink,
  AgentKeyDecision,
  AgentTaskReport,
} from '@shared/types';

interface Props {
  report: AgentTaskReport;
  onClose: () => void;
  onContinueAsConversation: () => void;
  onOpenHistory?: () => void;
  busy?: boolean;
}

const STATUS_LABEL: Record<string, { label: string; tone: string; bg: string }> = {
  done: { label: 'ГОТОВО', tone: '#0E6A2A', bg: 'rgba(34,197,94,0.18)' },
  failed: { label: 'ПРОВАЛ', tone: '#B9201F', bg: 'rgba(185,32,31,0.16)' },
  stopped: { label: 'ЗУПИНЕНО', tone: '#A36F1F', bg: 'rgba(244,175,37,0.20)' },
  timeout: { label: 'ТАЙМАУТ', tone: '#A36F1F', bg: 'rgba(244,175,37,0.20)' },
  blocked_quota: { label: 'КВОТА', tone: '#5B4A2E', bg: 'rgba(180,140,80,0.18)' },
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0с';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}хв ${rs}с` : `${m}хв`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}год ${rm}хв` : `${h}год`;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      style={{
        width: '100%',
        height: 8,
        borderRadius: 4,
        background: 'rgba(120,90,40,0.14)',
        overflow: 'hidden',
      }}
      aria-label={`${done}/${total} під-цілей виконано`}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{
          height: '100%',
          background:
            'linear-gradient(90deg, var(--primary, #F4AF25) 0%, #FFC961 100%)',
        }}
      />
    </div>
  );
}

function HeroStrip({ report }: { report: AgentTaskReport }) {
  const statusMeta = STATUS_LABEL[report.status] ?? STATUS_LABEL.done;
  return (
    <header
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto',
        gap: 16,
        alignItems: 'flex-start',
        padding: '4px 4px 12px 4px',
        borderBottom: '1px solid var(--glass-border, rgba(180,150,90,0.20))',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <span className="eyebrow-amber" style={{ fontSize: 11 }}>
          ЗВІТ ПРО ВИКОНАННЯ
        </span>
        <h1
          style={{
            fontFamily: 'Manrope, "Space Grotesk", sans-serif',
            fontSize: 22,
            lineHeight: 1.15,
            margin: '6px 0 0 0',
            color: 'var(--ink-strong, #1F1A11)',
            wordBreak: 'break-word',
          }}
        >
          {report.goal || 'Без назви'}
        </h1>
        {report.llm_narrative && (
          <p
            style={{
              margin: '8px 0 0 0',
              fontFamily: 'Playfair Display, Georgia, serif',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--ink-muted, #6B5C42)',
              lineHeight: 1.4,
              maxHeight: 56,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            «{report.llm_narrative}»
          </p>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          minWidth: 180,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 999,
            background: statusMeta.bg,
            color: statusMeta.tone,
            fontSize: 11,
            letterSpacing: '0.08em',
            fontWeight: 600,
          }}
        >
          {statusMeta.label}
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: 'var(--ink-muted)' }}
          >
            {formatDuration(report.duration_ms)}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: 'var(--ink-muted)' }}
          >
            {report.actions_total}
            {report.actions_failed > 0 ? `·×${report.actions_failed}` : ''} дій
          </span>
        </div>
        <div style={{ width: 180 }}>
          <ProgressBar
            done={report.sub_goals_done}
            total={Math.max(report.sub_goals_total, 1)}
          />
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: 'var(--ink-muted)',
              textAlign: 'right',
            }}
            className="font-mono"
          >
            {report.sub_goals_done}/{report.sub_goals_total} під-цілей
          </div>
        </div>
      </div>
    </header>
  );
}

function SectionCard({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'good' | 'warn' | 'neutral';
  children: React.ReactNode;
}) {
  const palette = {
    good: { ring: 'rgba(34,197,94,0.22)', accent: '#0E6A2A' },
    warn: { ring: 'rgba(244,175,37,0.32)', accent: '#A36F1F' },
    neutral: { ring: 'rgba(180,150,90,0.20)', accent: 'var(--ink-muted)' },
  }[tone];
  return (
    <section
      className="glass-card"
      style={{
        flex: 1,
        minHeight: 0,
        borderRadius: 14,
        padding: '10px 12px',
        border: `1px solid ${palette.ring}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: palette.accent as string,
        }}
      >
        {icon}
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.06em',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
    </section>
  );
}

function bulletList(items: string[]): React.ReactNode {
  if (items.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>
    );
  }
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
      {items.map((item, i) => (
        <li
          key={i}
          style={{
            fontSize: 13,
            color: 'var(--ink-strong, #1F1A11)',
            lineHeight: 1.35,
          }}
        >
          • {item}
        </li>
      ))}
    </ul>
  );
}

function DecisionRow({ d }: { d: AgentKeyDecision }) {
  const verdictTone: Record<string, string> = {
    revise_subgoal: '#A36F1F',
    revise_strategy: '#B9201F',
    abandon_task: '#B9201F',
    wait_user: '#0E6A2A',
    continue: 'var(--ink-muted)',
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.45)',
        border: '1px solid rgba(180,150,90,0.18)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.06em',
            fontWeight: 600,
            textTransform: 'uppercase',
            color: verdictTone[d.verdict] ?? 'var(--ink-muted)',
          }}
        >
          {d.verdict}
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 10, color: 'var(--ink-muted)' }}
        >
          cf {d.confidence.toFixed(2)}
        </span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--ink-strong)', lineHeight: 1.35 }}>
        {d.summary}
      </span>
      {d.objection && (
        <span
          style={{
            fontSize: 11,
            color: '#A36F1F',
            fontStyle: 'italic',
            lineHeight: 1.3,
          }}
        >
          ↪ {d.objection}
        </span>
      )}
    </div>
  );
}

function EvidencePill({ link }: { link: AgentEvidenceLink }) {
  const Icon = link.kind === 'url' ? Link2 : FileText;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        background: 'rgba(244,175,37,0.12)',
        border: '1px solid rgba(244,175,37,0.28)',
        fontSize: 11,
        color: 'var(--ink-strong)',
        maxWidth: 220,
      }}
      title={link.ref}
    >
      <Icon size={10} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {link.label || link.ref || link.kind}
      </span>
    </span>
  );
}

export function AgentReportScreen({
  report,
  onClose,
  onContinueAsConversation,
  onOpenHistory,
  busy = false,
}: Props) {
  const achievements = useMemo(() => report.achievements ?? [], [report]);
  const obstacles = useMemo(() => report.obstacles ?? [], [report]);
  const nextSteps = useMemo(() => report.next_steps ?? [], [report]);
  const decisions = useMemo(() => report.key_decisions ?? [], [report]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0"
        style={{
          zIndex: 65,
          background: 'rgba(28,22,14,0.62)',
          backdropFilter: 'blur(12px)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        role="presentation"
      >
        <motion.div
          className="glass-strong"
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            right: 18,
            bottom: 18,
            borderRadius: 22,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow:
              '0 30px 70px rgba(120,70,10,0.36), 0 0 0 1px var(--glass-border)',
          }}
          initial={{ scale: 0.97, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 12 }}
          transition={{ duration: 0.24 }}
          role="dialog"
          aria-label="Підсумковий звіт"
        >
          {/* Hero */}
          <HeroStrip report={report} />

          {/* Body — 4-column grid that fits within the frame */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <SectionCard
              title="Досягнуто"
              tone="good"
              icon={<CheckCircle2 size={14} />}
            >
              {bulletList(achievements)}
            </SectionCard>
            <SectionCard
              title="Перешкоди"
              tone={obstacles.length > 0 ? 'warn' : 'neutral'}
              icon={<AlertTriangle size={14} />}
            >
              {bulletList(obstacles)}
            </SectionCard>
            <SectionCard
              title="Ключові рішення"
              tone="neutral"
              icon={<Scale size={14} />}
            >
              {decisions.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Без помітних розгалужень — агент тримався початкової стратегії.
                </span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {decisions.map((d, i) => (
                    <DecisionRow key={`${d.step_idx}-${i}`} d={d} />
                  ))}
                </div>
              )}
            </SectionCard>
            <SectionCard
              title="Що далі"
              tone={nextSteps.length > 0 ? 'good' : 'neutral'}
              icon={<Compass size={14} />}
            >
              {nextSteps.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Жодних явних відкритих кроків.
                </span>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {nextSteps.map((step, i) => (
                    <li
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        fontSize: 12,
                        color: 'var(--ink-strong)',
                        lineHeight: 1.35,
                      }}
                    >
                      <ChevronRight
                        size={12}
                        style={{ marginTop: 2, color: 'var(--primary, #F4AF25)' }}
                      />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Evidence row */}
          {report.evidence_links.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                paddingTop: 4,
                borderTop: '1px solid var(--glass-border, rgba(180,150,90,0.20))',
              }}
            >
              <span
                className="eyebrow-amber"
                style={{ fontSize: 10, marginRight: 8 }}
              >
                ДОКАЗИ
              </span>
              {report.evidence_links.slice(0, 8).map((link, i) => (
                <EvidencePill key={`${link.kind}-${i}`} link={link} />
              ))}
            </div>
          )}

          {/* CTA bar */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6,
            }}
          >
            <button
              type="button"
              onClick={onOpenHistory}
              disabled={busy || !onOpenHistory}
              style={{
                minHeight: 44,
                padding: '0 14px',
                borderRadius: 12,
                background: 'transparent',
                border: '1px solid rgba(180,150,90,0.30)',
                color: 'var(--ink-muted)',
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                cursor: onOpenHistory ? 'pointer' : 'not-allowed',
                fontSize: 13,
              }}
              aria-label="Відкрити історію агента"
            >
              <History size={16} />
              Історія
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                style={{
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: 12,
                  background: 'rgba(180,150,90,0.10)',
                  border: '1px solid rgba(180,150,90,0.25)',
                  color: 'var(--ink-strong)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: busy ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
                aria-label="Закрити звіт"
              >
                <X size={16} />
                Закрити
              </button>
              <button
                type="button"
                onClick={onContinueAsConversation}
                disabled={busy}
                style={{
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: 12,
                  background:
                    'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)',
                  border: '1px solid rgba(168,118,18,0.45)',
                  color: '#1F1308',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: busy ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 700,
                  boxShadow: '0 8px 22px rgba(244,175,37,0.30)',
                }}
                aria-label="Продовжити як розмову"
              >
                <ArrowRightCircle size={16} />
                Продовжити як розмову
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
