/**
 * Phase-5 R1 — SandboxScene (closes audit-2026-04-30-verifier P0).
 *
 * Inline glass card rendered when a sandbox subprocess (`linux/executor.py`)
 * starts streaming. Reflects the live plan/stdout/stderr from the
 * `sandbox.<session_id>` WS channel. ROOT sessions render with a coral
 * header tint to make privilege escalation impossible to miss.
 */
import type { SandboxSceneData, SandboxStepStatus } from '@shared/types';

interface SandboxSceneProps {
  data: SandboxSceneData;
}

const STEP_DISPLAY: Record<SandboxStepStatus, { icon: string; tint: string; spin: boolean }> = {
  pending: { icon: 'radio_button_unchecked', tint: 'var(--ink-muted)', spin: false },
  running: { icon: 'progress_activity', tint: 'var(--primary)', spin: true },
  done: { icon: 'check_circle', tint: 'var(--primary-deep)', spin: false },
  failed: { icon: 'error', tint: 'var(--coral)', spin: false },
};

function fmtMs(ms?: number): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SandboxScene({ data }: SandboxSceneProps) {
  const headerTint = data.root ? 'var(--coral)' : 'var(--primary-deep)';
  const headerLabel = data.root ? 'SANDBOX · ROOT' : 'SANDBOX';

  return (
    <div
      className="glass lift"
      style={{
        width: 504,
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: data.root ? '0 0 0 1px rgba(239,68,68,0.18)' : undefined,
      }}
      data-testid="scene-sandbox"
      data-sandbox-session={data.session_id}
      data-sandbox-root={data.root ? 'true' : 'false'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="msym" aria-hidden style={{ fontSize: 14, color: headerTint }}>
            {data.root ? 'shield_lock' : 'terminal'}
          </span>
          <span
            className="eyebrow-amber"
            style={{ color: data.root ? 'var(--coral)' : undefined }}
          >
            {headerLabel}
          </span>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            background: data.live ? 'rgba(244,175,37,0.18)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${data.live ? 'rgba(244,175,37,0.4)' : 'rgba(0,0,0,0.08)'}`,
            fontSize: 9,
            fontWeight: 700,
            color: data.live ? 'var(--primary-shadow)' : 'var(--ink-muted)',
            letterSpacing: '0.12em',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 'var(--radius-pill)',
              background: data.live ? 'var(--primary)' : 'var(--ink-muted)',
              animation: data.live ? 'phantom-status-pulse 1.6s ease-in-out infinite' : 'none',
            }}
          />
          {data.live ? 'LIVE' : data.exit_code === 0 ? 'DONE' : data.exit_code !== undefined ? 'FAILED' : 'IDLE'}
        </span>
      </div>

      {data.steps.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.steps.map((step) => {
            const s = STEP_DISPLAY[step.status];
            return (
              <div
                key={step.step_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  fontSize: 11,
                }}
              >
                <span
                  className="msym"
                  aria-hidden
                  style={{
                    fontSize: 14,
                    color: s.tint,
                    animation: s.spin ? 'phantom-spin 1.2s linear infinite' : 'none',
                  }}
                >
                  {s.icon}
                </span>
                <span
                  style={{
                    flex: 1,
                    color: step.status === 'pending' ? 'var(--ink-muted)' : 'var(--ink-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {step.text}
                </span>
                {step.duration_ms !== undefined && (
                  <span className="tabular" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    {fmtMs(step.duration_ms)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(data.recent_stdout.length > 0 || data.recent_stderr.length > 0) && (
        <pre
          className="tabular"
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: 'rgba(26,22,18,0.92)',
            color: 'rgba(255,255,255,0.86)',
            fontSize: 10,
            lineHeight: 1.4,
            maxHeight: 120,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            margin: '10px 0 0',
          }}
        >
          {data.recent_stdout.slice(-6).join('\n')}
          {data.recent_stderr.length > 0 && (
            <span style={{ color: 'var(--coral)', display: 'block' }}>
              {'\n'}
              {data.recent_stderr.slice(-3).join('\n')}
            </span>
          )}
        </pre>
      )}

      {data.exit_code !== undefined && (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--ink-muted)',
          }}
        >
          <span>exit {data.exit_code}</span>
          <span className="tabular">{fmtMs(data.duration_ms)}</span>
        </div>
      )}
    </div>
  );
}
