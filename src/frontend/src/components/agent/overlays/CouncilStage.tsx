/**
 * Phase 17a — CouncilStage.
 *
 * Visualises a multi-agent debate (Council) live. Layout:
 *
 *   ┌──────────────────── Verdict strip ────────────────────┐
 *   │ kind · summary · consensus pill · close [×]           │
 *   ├──────────────────── Roles grid (3×N) ─────────────────┤
 *   │ [Planner] [Critic] [Executor] [Risk] [Skeptic]…       │
 *   │ each card: emoji, name, statement (typewriter),       │
 *   │ confidence bar, status pill. When a role objects to   │
 *   │ another, a connecting blink line is rendered.         │
 *   └───────────────────────────────────────────────────────┘
 *
 * Reads:  useAgentStore.councilStatements / councilDecision
 * Writes: dismissCouncil() — operator closes the stage.
 *
 * Sized to fit 1024×600 with no main-screen scroll. Each role card uses
 * padded glass surfaces so the debate reads as a small theatre, not a list.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Check,
  AlertOctagon,
  HelpCircle,
  Compass,
} from 'lucide-react';
import type {
  AgentCouncilDecision,
  AgentRoleName,
  AgentRoleStatement,
} from '@shared/types';

interface Props {
  open: boolean;
  situationKind: string | null;
  summary: string | null;
  statements: AgentRoleStatement[];
  decision: AgentCouncilDecision | null;
  onClose: () => void;
}

const ROLE_META: Record<
  AgentRoleName,
  { emoji: string; label: string; tint: string }
> = {
  planner: { emoji: '🗺', label: 'Planner', tint: 'rgba(244,175,37,0.18)' },
  critic: { emoji: '🔎', label: 'Critic', tint: 'rgba(185,32,31,0.14)' },
  executor: { emoji: '🛠', label: 'Executor', tint: 'rgba(34,197,94,0.14)' },
  researcher: { emoji: '📚', label: 'Researcher', tint: 'rgba(99,102,241,0.14)' },
  risk_assessor: { emoji: '⚠', label: 'Risk', tint: 'rgba(244,175,37,0.22)' },
  aesthete: { emoji: '🎨', label: 'Aesthete', tint: 'rgba(236,72,153,0.14)' },
  skeptic: { emoji: '🜂', label: 'Skeptic', tint: 'rgba(120,113,108,0.18)' },
  moderator: { emoji: '⚖', label: 'Moderator', tint: 'rgba(244,175,37,0.30)' },
  verifier: { emoji: '✓', label: 'Verifier', tint: 'rgba(34,197,94,0.18)' },
};

const VERDICT_META: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  proceed: {
    label: 'ВПЕРЕД',
    color: '#0E6A2A',
    bg: 'rgba(34,197,94,0.18)',
    icon: <Check size={14} />,
  },
  revise: {
    label: 'РЕВІЗІЯ',
    color: '#A36F1F',
    bg: 'rgba(244,175,37,0.20)',
    icon: <Compass size={14} />,
  },
  abort: {
    label: 'ВІДМОВА',
    color: '#B9201F',
    bg: 'rgba(185,32,31,0.18)',
    icon: <AlertOctagon size={14} />,
  },
  ask_user: {
    label: 'ПИТАЄМО',
    color: '#5B4A2E',
    bg: 'rgba(180,150,90,0.22)',
    icon: <HelpCircle size={14} />,
  },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      style={{
        height: 4,
        width: '100%',
        background: 'rgba(120,90,40,0.16)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
      aria-label={`confidence ${pct}%`}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background:
            'linear-gradient(90deg, var(--primary, #F4AF25) 0%, #FFC961 100%)',
        }}
      />
    </div>
  );
}

function Typewriter({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!text) return;
    const id = window.setInterval(() => {
      setShown((s) => (s >= text.length ? s : s + 2));
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);
  return <span>{text.slice(0, shown)}</span>;
}

function RoleCard({
  role,
  statement,
  active,
  spoken,
}: {
  role: AgentRoleName;
  statement: AgentRoleStatement | null;
  active: boolean;
  spoken: boolean;
}) {
  const meta = ROLE_META[role] ?? {
    emoji: '·',
    label: role,
    tint: 'rgba(180,150,90,0.10)',
  };
  return (
    <motion.div
      layout
      initial={{ y: 8, opacity: 0 }}
      animate={{
        y: active ? -3 : 0,
        opacity: 1,
        boxShadow: active
          ? '0 14px 36px rgba(244,175,37,0.30)'
          : '0 4px 14px rgba(120,90,40,0.10)',
      }}
      transition={{ duration: 0.22 }}
      style={{
        padding: '10px 12px',
        borderRadius: 14,
        border: `1px solid ${
          active ? 'rgba(244,175,37,0.55)' : 'rgba(180,150,90,0.20)'
        }`,
        background: spoken
          ? `linear-gradient(180deg, ${meta.tint} 0%, rgba(255,255,255,0.55) 100%)`
          : 'rgba(255,255,255,0.50)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 96,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(180,150,90,0.20)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
          }}
        >
          {meta.emoji}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink-strong)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {meta.label}
        </span>
        {!spoken && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--ink-faint)',
              fontStyle: 'italic',
            }}
          >
            думає…
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-strong)',
          lineHeight: 1.35,
          minHeight: 36,
        }}
      >
        {statement ? <Typewriter text={statement.text} /> : (
          <span style={{ color: 'var(--ink-faint)' }}>—</span>
        )}
      </div>
      {statement && (
        <>
          {statement.objection_to.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: '#B9201F',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              ↪ заперечує: {statement.objection_to.join(', ')}
            </span>
          )}
          <ConfidenceBar value={statement.confidence} />
        </>
      )}
    </motion.div>
  );
}

export function CouncilStage({
  open,
  situationKind,
  summary,
  statements,
  decision,
  onClose,
}: Props) {
  const lastSpeaker = statements.length
    ? statements[statements.length - 1].role
    : null;

  // Build a stable role list — every role we've seen at least one statement
  // for, in their order of first appearance. Falls back to a default cast.
  const roles = useMemo<AgentRoleName[]>(() => {
    const seen: AgentRoleName[] = [];
    for (const s of statements) {
      if (!seen.includes(s.role)) seen.push(s.role);
    }
    if (decision) {
      for (const s of decision.statements) {
        if (!seen.includes(s.role)) seen.push(s.role);
      }
    }
    if (seen.length === 0) {
      return ['planner', 'critic', 'executor', 'risk_assessor', 'skeptic', 'moderator'];
    }
    return seen;
  }, [statements, decision]);

  const statementsByRole = useMemo(() => {
    const map = new Map<AgentRoleName, AgentRoleStatement>();
    for (const s of statements) {
      map.set(s.role, s);
    }
    if (decision) {
      for (const s of decision.statements) {
        if (!map.has(s.role)) map.set(s.role, s);
      }
    }
    return map;
  }, [statements, decision]);

  const verdictMeta = decision ? VERDICT_META[decision.verdict] : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 66,
            background: 'rgba(28,22,14,0.50)',
            backdropFilter: 'blur(10px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="presentation"
          onClick={onClose}
        >
          <motion.div
            className="glass-strong"
            style={{
              position: 'absolute',
              top: 24,
              left: 40,
              right: 40,
              bottom: 24,
              borderRadius: 22,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow:
                '0 30px 70px rgba(120,70,10,0.36), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.97, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 10 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Рада агентів"
          >
            {/* Verdict strip */}
            <header
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                paddingBottom: 8,
                borderBottom: '1px solid var(--glass-border, rgba(180,150,90,0.20))',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span className="eyebrow-amber" style={{ fontSize: 11 }}>
                  РАДА АГЕНТІВ
                </span>
                <h2
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: 18,
                    color: 'var(--ink-strong)',
                    fontFamily: 'Manrope, sans-serif',
                  }}
                >
                  {situationKind ? `${situationKind} · ` : ''}
                  {summary || 'дискусія…'}
                </h2>
                {decision && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: 4,
                      fontSize: 11,
                      color: 'var(--ink-muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    {decision.consensus_summary}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                {verdictMeta && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 999,
                      background: verdictMeta.bg,
                      color: verdictMeta.color,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                    }}
                  >
                    {verdictMeta.icon}
                    {verdictMeta.label}
                  </span>
                )}
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
                  aria-label="Закрити раду"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* Roles grid */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns:
                  roles.length <= 3
                    ? `repeat(${roles.length}, minmax(0, 1fr))`
                    : 'repeat(3, minmax(0, 1fr))',
                gridAutoRows: 'minmax(110px, 1fr)',
                gap: 10,
                overflowY: 'auto',
              }}
            >
              {roles.map((r) => (
                <RoleCard
                  key={r}
                  role={r}
                  statement={statementsByRole.get(r) ?? null}
                  active={r === lastSpeaker && !decision}
                  spoken={statementsByRole.has(r)}
                />
              ))}
            </div>

            {decision?.generation_strategy === 'deterministic' && (
              <div
                style={{
                  fontSize: 11,
                  color: '#A36F1F',
                  background: 'rgba(244,175,37,0.10)',
                  border: '1px dashed rgba(244,175,37,0.35)',
                  padding: '6px 10px',
                  borderRadius: 10,
                  textAlign: 'center',
                }}
              >
                🜂 Skeleton mode — нейронка офлайн, рада говорить шаблонами.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
