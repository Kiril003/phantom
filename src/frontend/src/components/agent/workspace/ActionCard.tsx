import { useState } from 'react';
import { Check, X, RotateCw, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentPlanStep } from '@shared/types';
import { InnerMonologueTab } from '../status/InnerMonologueTab';
import { FeedbackButtons } from './FeedbackButtons';

interface Props {
  step: AgentPlanStep;
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
  auditEntryId?: number;
}

const RISK_COLORS: Record<number, string> = {
  1: 'var(--signal-ok)',
  3: 'var(--signal-info)',
  5: 'var(--signal-warn)',
  7: 'var(--signal-alert)',
};

export function ActionCard({ step, result, auditEntryId }: Props) {
  const [expanded, setExpanded] = useState(false);

  const argsLine = Object.entries(step.args || {})
    .map(([k, v]) => `${k}=${truncate(JSON.stringify(v), 30)}`)
    .join(' ');

  return (
    <div
      className="flex flex-col"
      data-testid="action-card"
      style={{
        background: 'var(--glass-subtle)',
        border: '1px solid var(--glass-border)',
        borderRadius: 10,
        padding: 10,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
        style={{ minHeight: 28 }}
      >
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <ResultIcon result={result} retried={step.retried_from != null} />
        <span
          className="font-mono"
          style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)', minWidth: 110 }}
        >
          {step.action}
        </span>
        <span
          className="font-mono flex-1 truncate"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
          title={argsLine}
        >
          {argsLine || '—'}
        </span>
        {result?.elapsed_ms != null && (
          <span
            className="font-mono"
            style={{ color: 'var(--ink-faint)', fontSize: 'var(--fs-xxs)' }}
          >
            {result.elapsed_ms}ms
          </span>
        )}
        <span
          aria-label={`risk-${step.monologue?.confidence}`}
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: RISK_COLORS[5] || 'var(--ink-muted)',
            opacity: 0.6,
          }}
        />
      </button>
      {expanded && (
        <>
          {step.intent && (
            <div
              className="mt-2"
              style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-sm)' }}
            >
              <span
                className="font-mono"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xxs)' }}
              >
                INTENT:
              </span>{' '}
              {step.intent}
            </div>
          )}
          {step.monologue && <InnerMonologueTab monologue={step.monologue} />}
          {step.retried_from != null && (
            <div className="mt-2" style={{ color: 'var(--signal-warn)', fontSize: 'var(--fs-xs)' }}>
              ↻ retry of step {step.retried_from}
            </div>
          )}
          {result?.error && (
            <div
              className="mt-2 px-2 py-1.5"
              style={{
                background: 'color-mix(in srgb, var(--signal-alert) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--signal-alert) 24%, transparent)',
                borderRadius: 8,
                color: 'var(--ink-primary)',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {result.error}
            </div>
          )}
          {auditEntryId && (
            <div className="mt-3 flex justify-end">
              <FeedbackButtons auditId={auditEntryId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultIcon({
  result,
  retried,
}: {
  result?: { ok: boolean; error?: string | null };
  retried: boolean;
}) {
  if (!result) {
    return <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}>·</span>;
  }
  if (retried) return <RotateCw size={14} color="var(--signal-warn)" />;
  return result.ok ? (
    <Check size={14} color="var(--signal-ok)" />
  ) : (
    <X size={14} color="var(--signal-alert)" />
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
