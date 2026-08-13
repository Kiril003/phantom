/**
 * MissionReportScreen — engineering postmortem for a completed mission.
 *
 * No markdown rendering — ledger.md and report text are plain postmortem
 * prose; the operator opens the .md file for formatted reading.
 * No confetti, no superlative copy. Engineering voice throughout.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronDown,
  ChevronRight,
  FileText,
  BookOpen,
  Scale,
  Loader2,
} from 'lucide-react';
import type { MissionReport, MissionReportPhase } from '@shared/types/mission';
import type { ExportMissionRequest } from '../../services/missionApi';

interface Props {
  report: MissionReport;
  onClose: () => void;
  onExport: (format: ExportMissionRequest['format']) => void;
  exportBusy?: boolean;
}

const STATUS_COLOR: Record<string, { color: string; bg: string; label: string }> = {
  done: { label: 'DONE', color: '#0E6A2A', bg: 'rgba(34,197,94,0.16)' },
  failed: { label: 'FAILED', color: '#B9201F', bg: 'rgba(185,32,31,0.14)' },
  stopped: { label: 'STOPPED', color: '#8A6B3F', bg: 'rgba(180,140,80,0.14)' },
  abandoned: { label: 'ABANDONED', color: '#6B5C42', bg: 'rgba(120,90,50,0.14)' },
  running: { label: 'RUNNING', color: '#A36F1F', bg: 'rgba(244,175,37,0.18)' },
};

function formatH(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function BulletList({
  items,
  color = 'var(--ink-strong, #1F1A11)',
}: {
  items: string[];
  color?: string;
}) {
  if (items.length === 0) {
    return <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 12, color, lineHeight: 1.4 }}>
          • {item}
        </li>
      ))}
    </ul>
  );
}

function PhaseCard({ phase }: { phase: MissionReportPhase }) {
  const [expanded, setExpanded] = useState(false);
  const statusMeta =
    STATUS_COLOR[phase.status] ?? { label: phase.status.toUpperCase(), color: 'var(--ink-muted)', bg: 'rgba(180,150,90,0.12)' };

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid rgba(180,150,90,0.18)',
        background: 'rgba(255,255,255,0.42)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 44,
        }}
        aria-expanded={expanded}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            color: 'var(--ink-muted)',
            flexShrink: 0,
          }}
        >
          {String(phase.idx + 1).padStart(2, '0')}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-strong, #1F1A11)', lineHeight: 1.3 }}>
          {phase.description}
        </span>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 999,
            background: statusMeta.bg,
            color: statusMeta.color,
            fontSize: 9,
            letterSpacing: '0.08em',
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace',
            flexShrink: 0,
          }}
        >
          {statusMeta.label}
        </span>
        {phase.duration_h !== null && (
          <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
            {formatH(phase.duration_h)}
          </span>
        )}
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '0 14px 14px 14px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              {/* Achievements */}
              {phase.achievements.length > 0 && (
                <div>
                  <div style={sectionLabel}>Achievements</div>
                  <BulletList items={phase.achievements} color="#0E6A2A" />
                </div>
              )}

              {/* Failure modes */}
              {phase.failure_modes.length > 0 && (
                <div>
                  <div style={sectionLabel}>Failure modes</div>
                  <BulletList items={phase.failure_modes} color="#B9201F" />
                </div>
              )}

              {/* Key decisions */}
              {phase.decisions.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={sectionLabel}>Key decisions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {phase.decisions.map((d, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 8,
                          background: 'rgba(255,255,255,0.45)',
                          border: '1px solid rgba(180,150,90,0.16)',
                          fontSize: 11,
                          lineHeight: 1.4,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--ink-muted)', marginRight: 6 }}>
                          [{d.verdict}]
                        </span>
                        <span style={{ color: 'var(--ink-strong)' }}>{d.summary}</span>
                        {d.objection && (
                          <div style={{ fontSize: 10, color: '#A36F1F', fontStyle: 'italic', marginTop: 3 }}>
                            ↪ {d.objection}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Artifacts */}
              {phase.artifacts.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={sectionLabel}>Artifacts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {phase.artifacts.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => navigator.clipboard.writeText(a.path).catch(() => undefined)}
                        title="Click to copy path"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 0',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <FileText size={11} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 10,
                            color: 'var(--ink-strong)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {a.path}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--ink-muted)', flexShrink: 0 }}>
                          {a.kind}
                        </span>
                        {a.size_bytes !== undefined && (
                          <span
                            style={{
                              fontFamily: 'JetBrains Mono, monospace',
                              fontSize: 9,
                              color: 'var(--ink-muted)',
                              flexShrink: 0,
                            }}
                          >
                            {(Number(a.size_bytes) / 1024).toFixed(0)}KB
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Lessons */}
              {phase.lessons.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={sectionLabel}>Lessons</div>
                  <BulletList items={phase.lessons} />
                </div>
              )}

              {/* Visual snapshot */}
              {phase.visual_snapshot_b64 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={sectionLabel}>Visual snapshot</div>
                  <img
                    src={`data:image/png;base64,${phase.visual_snapshot_b64}`}
                    alt={`Phase ${phase.idx + 1} snapshot`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: 160,
                      borderRadius: 8,
                      border: '1px solid rgba(180,150,90,0.20)',
                      objectFit: 'contain',
                    }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MissionReportScreen({ report, onClose, onExport, exportBusy = false }: Props) {
  const statusMeta =
    STATUS_COLOR[report.status] ??
    { label: report.status.toUpperCase(), color: 'var(--ink-muted)', bg: 'rgba(180,150,90,0.12)' };

  const resourceEntries = Object.entries(report.resource_summary ?? {}).slice(0, 6);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0"
        style={{ zIndex: 72, background: 'rgba(28,22,14,0.65)', backdropFilter: 'blur(12px)' }}
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
            top: 14,
            left: 14,
            right: 14,
            bottom: 14,
            borderRadius: 20,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: '0 28px 65px rgba(120,70,10,0.30), 0 0 0 1px var(--glass-border)',
            overflow: 'hidden',
          }}
          initial={{ scale: 0.97, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 10 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-label="Mission report"
        >
          {/* Header */}
          <header
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              borderBottom: '1px solid var(--glass-border, rgba(180,150,90,0.20))',
              paddingBottom: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                className="eyebrow-amber"
                style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}
              >
                MISSION REPORT
              </span>
              <h1
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontSize: 17,
                  fontWeight: 700,
                  color: 'var(--ink-strong, #1F1A11)',
                  margin: '4px 0 0 0',
                  wordBreak: 'break-word',
                }}
              >
                {report.brief.slice(0, 140)}
                {report.brief.length > 140 ? '…' : ''}
              </h1>
              {report.success_criteria && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--ink-muted)',
                    lineHeight: 1.4,
                  }}
                >
                  {report.success_criteria}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: statusMeta.bg,
                  color: statusMeta.color,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {statusMeta.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {formatH(report.wall_duration_h)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {formatDate(report.started_at)} — {formatDate(report.finished_at)}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                minWidth: 44,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                background: 'rgba(180,150,90,0.10)',
                border: '1px solid rgba(180,150,90,0.20)',
                color: 'var(--ink-muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              aria-label="Close report"
            >
              <X size={18} />
            </button>
          </header>

          {/* Scrollable body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Overall summary */}
            {report.overall_summary && (
              <section
                className="glass-card"
                style={{
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '1px solid rgba(180,150,90,0.18)',
                  flexShrink: 0,
                }}
              >
                <div style={{ ...sectionLabel, marginBottom: 6 }}>Summary</div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--ink-strong, #1F1A11)',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {report.overall_summary}
                </p>
              </section>
            )}

            {/* Phase cards */}
            {report.phases.length > 0 && (
              <section style={{ flexShrink: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 8,
                    ...sectionLabel,
                  }}
                >
                  <Scale size={12} />
                  Phases ({report.phases.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {report.phases.map((phase) => (
                    <PhaseCard key={phase.idx} phase={phase} />
                  ))}
                </div>
              </section>
            )}

            {/* Aggregate lessons */}
            {report.aggregate_lessons.length > 0 && (
              <section
                className="glass-card"
                style={{
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '1px solid rgba(180,150,90,0.16)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 8,
                    ...sectionLabel,
                  }}
                >
                  <BookOpen size={12} />
                  Aggregate lessons
                </div>
                <BulletList items={report.aggregate_lessons} />
              </section>
            )}

            {/* Stats row */}
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                flexShrink: 0,
              }}
            >
              {[
                { label: 'Artifacts', value: String(report.total_artifacts) },
                { label: 'Decisions', value: String(report.total_decisions) },
                { label: 'Council', value: String(report.council_engagements) },
                {
                  label: 'Budget',
                  value:
                    report.budget_spent_usd !== null
                      ? `$${report.budget_spent_usd.toFixed(4)}`
                      : '—',
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.40)',
                    border: '1px solid rgba(180,150,90,0.16)',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 18,
                      fontWeight: 700,
                      color: 'var(--ink-strong, #1F1A11)',
                    }}
                  >
                    {value}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
                    {label}
                  </div>
                </div>
              ))}
            </section>

            {/* Resource summary */}
            {resourceEntries.length > 0 && (
              <section
                className="glass-card"
                style={{
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '1px solid rgba(180,150,90,0.16)',
                  flexShrink: 0,
                }}
              >
                <div style={{ ...sectionLabel, marginBottom: 8 }}>Resource summary</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                  }}
                >
                  {resourceEntries.map(([key, val]) => (
                    <div
                      key={key}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.40)',
                        border: '1px solid rgba(180,150,90,0.14)',
                      }}
                    >
                      <div
                        style={{ fontSize: 9, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
                      >
                        {key}
                      </div>
                      <div
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 11,
                          color: 'var(--ink-strong)',
                          marginTop: 2,
                        }}
                      >
                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-muted)',
                fontFamily: 'JetBrains Mono, monospace',
                paddingBottom: 4,
                flexShrink: 0,
              }}
            >
              Composed {formatDate(report.composed_at)} · Generated by PHANTOM mission engine
            </div>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              paddingTop: 6,
              borderTop: '1px solid var(--glass-border, rgba(180,150,90,0.18))',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => onExport('pdf')}
              disabled={exportBusy}
              style={exportBtnStyle}
            >
              {exportBusy && <Loader2 size={12} className="animate-spin" />}
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => onExport('dashboard')}
              disabled={exportBusy}
              style={exportBtnStyle}
            >
              Export dashboard
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                marginLeft: 'auto',
                minHeight: 44,
                padding: '0 18px',
                borderRadius: 12,
                background: 'rgba(180,150,90,0.10)',
                border: '1px solid rgba(180,150,90,0.25)',
                color: 'var(--ink-strong)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <X size={14} />
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
};

const exportBtnStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  background: 'rgba(180,150,90,0.10)',
  border: '1px solid rgba(180,150,90,0.22)',
  color: 'var(--ink-strong)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
