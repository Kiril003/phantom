import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield,
  Terminal,
  CheckCircle2,
  Play,
  Circle,
  ArrowDownToLine,
  Copy,
  RotateCw,
  Save,
  StopCircle,
  AlertTriangle,
} from 'lucide-react';
import { wsClient, type WSChannel, type WSMessage } from '../services/websocket';
import { linuxApi } from '../services/api';

/* ─── SandboxEvent — matches docs/CONTRACTS_R1.md schema ─────────────── */

export type SandboxEvent =
  | { type: 'session.started'; session_id: string; root: boolean }
  | {
      type: 'plan.step';
      session_id: string;
      step_id: string;
      status: 'pending' | 'running' | 'done' | 'failed';
      text: string;
    }
  | { type: 'plan.thought'; session_id: string; text: string }
  | {
      type: 'stdout.line';
      session_id: string;
      line: string;
      severity?: 'info' | 'warn' | 'error';
    }
  | { type: 'stderr.line'; session_id: string; line: string }
  | {
      type: 'process.completed';
      session_id: string;
      exit: number;
      duration_ms: number;
    }
  | {
      type: 'session.killed';
      session_id: string;
      by: 'operator' | 'timeout';
    };

interface PlanStep {
  step_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  text: string;
}

interface OutputLine {
  id: number;
  stream: 'stdout' | 'stderr' | 'meta';
  severity?: 'info' | 'warn' | 'error';
  text: string;
}

/**
 * SANDBOX — full-screen ROOT executor (Phase 5 R3-FE).
 *
 * Streams `SandboxEvent` (CONTRACTS_R1.md §Sandbox stream WS event) over
 * the multiplexed WS channel `sandbox.<session_id>`. Owner of emit-side:
 * BE-SANDBOX (`src/backend/linux/`). FE renders here.
 *
 * Strict 1024×600 layout:
 *   header     12..56  (44 high)
 *   left  pane 68..588 (500 wide) — plan + thinking + cmd preview + EXECUTE
 *   right pane 68..588 (500 wide) — terminal stdout stream + actions
 *
 * Reduced motion: respected by the per-line slide-up-fade keyframe; the
 * dot-pulse on `running` plan steps drops automatically because it uses
 * `var(--motion-scale)` indirectly via the global token.
 */
export default function SandboxLayout() {
  const [sessionId, setSessionId] = useState<string>('');
  const [startedAt, setStartedAt] = useState<Date>(() => new Date());
  const [isRoot, setIsRoot] = useState<boolean>(true);
  const [killing, setKilling] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [bytesOut, setBytesOut] = useState(0);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [killedBy, setKilledBy] = useState<'operator' | 'timeout' | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const lineSeqRef = useRef(0);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  /* ── command source (Phase 5 R3-FE provides preview only; the real
     command pipe is owned by BE-SANDBOX which emits stdout via WS) ──── */
  const command = useMemo(
    () =>
      [
        'import subprocess, pathlib',
        'files = pathlib.Path("/tmp").glob("*.cache")',
        'for f in files: f.unlink()',
      ].join('\n'),
    []
  );

  /* ── WS subscription. Channel name follows the contract:
     `sandbox.<session_id>`. We attach a single listener that filters
     by session_id once one is announced via `session.started`.
     ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // The wsClient channel union doesn't enumerate every dynamic
    // sandbox.<id> stream, so we cast the channel literal once. The
    // emit/parse contract is still strict via SandboxEvent.
    const channel = 'sandbox' as WSChannel;
    const unsubscribe = wsClient.on(channel, (msg: WSMessage) => {
      const evt = msg.data as unknown as SandboxEvent;
      handleEvent(evt);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Auto-scroll the terminal body whenever a new line arrives,
     unless the operator has scrolled up (autoScroll = false). ──────── */
  useEffect(() => {
    if (!autoScroll) return;
    const el = terminalBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output, autoScroll]);

  const handleEvent = useCallback((evt: SandboxEvent) => {
    switch (evt.type) {
      case 'session.started':
        setSessionId(evt.session_id);
        setIsRoot(evt.root);
        setStartedAt(new Date());
        setPlanSteps([]);
        setThoughts([]);
        setOutput([]);
        setBytesOut(0);
        setExitCode(null);
        setKilledBy(null);
        return;

      case 'plan.step':
        setPlanSteps((prev) => {
          const idx = prev.findIndex((s) => s.step_id === evt.step_id);
          const next: PlanStep = {
            step_id: evt.step_id,
            status: evt.status,
            text: evt.text,
          };
          if (idx === -1) return [...prev, next];
          const copy = prev.slice();
          copy[idx] = next;
          return copy;
        });
        return;

      case 'plan.thought':
        setThoughts((prev) => [...prev.slice(-3), evt.text]);
        return;

      case 'stdout.line': {
        const id = ++lineSeqRef.current;
        setOutput((prev) => [
          ...prev,
          { id, stream: 'stdout', severity: evt.severity, text: evt.line },
        ]);
        setBytesOut((b) => b + evt.line.length + 1);
        return;
      }

      case 'stderr.line': {
        const id = ++lineSeqRef.current;
        setOutput((prev) => [
          ...prev,
          { id, stream: 'stderr', text: evt.line },
        ]);
        setBytesOut((b) => b + evt.line.length + 1);
        return;
      }

      case 'process.completed': {
        const id = ++lineSeqRef.current;
        setExitCode(evt.exit);
        setOutput((prev) => [
          ...prev,
          {
            id,
            stream: 'meta',
            text: `process completed · exit ${evt.exit} · ${(evt.duration_ms / 1000).toFixed(1)}s`,
          },
        ]);
        return;
      }

      case 'session.killed': {
        const id = ++lineSeqRef.current;
        setKilledBy(evt.by);
        setOutput((prev) => [
          ...prev,
          {
            id,
            stream: 'meta',
            text: `session killed by ${evt.by}`,
            severity: 'warn',
          },
        ]);
        return;
      }
    }
  }, []);

  /* ── Execute via existing /linux/execute (kept stable per scope rules).
     The sandbox build plan + line stream still arrive via WS once the
     backend emits SandboxEvent; this POST is the kick-off. ──────────── */
  const handleExecute = useCallback(async () => {
    try {
      const res = await linuxApi.execute({ command, timeout_s: 30 });
      // Echo the synchronous fallback into the local stream so something
      // shows even when the WS emit-side hasn't been wired yet by
      // BE-SANDBOX. Lines arriving via WS later will simply append.
      const lines: OutputLine[] = [];
      for (const raw of (res.stdout ?? '').split('\n')) {
        if (!raw) continue;
        lines.push({
          id: ++lineSeqRef.current,
          stream: 'stdout',
          text: raw,
        });
      }
      for (const raw of (res.stderr ?? '').split('\n')) {
        if (!raw) continue;
        lines.push({
          id: ++lineSeqRef.current,
          stream: 'stderr',
          text: raw,
        });
      }
      if (lines.length) {
        setOutput((prev) => [...prev, ...lines]);
        setBytesOut(
          (b) => b + lines.reduce((acc, l) => acc + l.text.length + 1, 0)
        );
      }
      if (typeof res.exit_code === 'number') setExitCode(res.exit_code);
    } catch (err) {
      const id = ++lineSeqRef.current;
      setOutput((prev) => [
        ...prev,
        {
          id,
          stream: 'stderr',
          text: err instanceof Error ? err.message : 'execute failed',
        },
      ]);
    }
  }, [command]);

  const handleKill = useCallback(async () => {
    setKilling(true);
    try {
      // The backend kill endpoint is owned by BE-SANDBOX; we send a
      // kill request via WS so the session-channel emitter can route
      // it. If the WS isn't open this is a graceful no-op (operator
      // can re-issue once reconnect lands).
      wsClient.send({
        channel: 'sandbox' as WSChannel,
        type: 'kill',
        data: { session_id: sessionId },
      });
    } finally {
      setKilling(false);
    }
  }, [sessionId]);

  const handleCopy = useCallback(async () => {
    const text = output.map((l) => l.text).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked — silent */
    }
  }, [output]);

  const handleSave = useCallback(() => {
    const text = output.map((l) => l.text).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sandbox-${sessionId || 'session'}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [output, sessionId]);

  const handleRerun = useCallback(() => {
    setOutput([]);
    setBytesOut(0);
    setExitCode(null);
    setKilledBy(null);
    handleExecute();
  }, [handleExecute]);

  const handleScrollToBottom = useCallback(() => {
    const el = terminalBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  }, []);

  const onTerminalScroll = useCallback(() => {
    const el = terminalBodyRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setAutoScroll(atBottom);
  }, []);

  const sessionShort = sessionId ? sessionId.slice(0, 6) : '— · — · —';
  const startedClock = `${pad(startedAt.getHours())}:${pad(
    startedAt.getMinutes()
  )}`;
  const bytesLabel =
    bytesOut < 1024
      ? `${bytesOut} B`
      : `${(bytesOut / 1024).toFixed(1)} KB`;

  return (
    <div
      className="sunrise-frame coral-tint relative"
      style={{ width: 1024, height: 600, overflow: 'hidden' }}
    >
      {/* ── Header strip ── */}
      <div
        className="glass-strong"
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          height: 44,
          borderRadius: 12,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 5,
          border: '1px solid rgba(239,68,68,0.30)',
        }}
      >
        <span className="status-pill coral">
          <span className="dot" />
          {isRoot ? 'SANDBOX · ROOT' : 'SANDBOX'}
        </span>
        <span
          aria-hidden
          style={{
            width: 1,
            height: 16,
            background: 'var(--line-strong)',
            opacity: 0.4,
          }}
        />
        <Shield size={14} strokeWidth={2} style={{ color: '#b9201f' }} />
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-secondary)',
            fontWeight: 600,
          }}
        >
          SESSION{' '}
          <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
            {sessionShort}
          </span>{' '}
          · started{' '}
          <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
            {startedClock}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <span className="micro-label" style={{ color: '#b9201f' }}>
          PROTECTED MODE · ESP32 RGB STRIP CORAL
        </span>
      </div>

      {/* ── LEFT — INPUT / PLAN ── */}
      <div
        className="glass"
        style={{
          position: 'absolute',
          top: 68,
          left: 12,
          bottom: 12,
          width: 500,
          borderRadius: 14,
          padding: 16,
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div className="eyebrow-amber" style={{ color: '#b9201f' }}>
          BUILD PLAN · LIVE
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {planSteps.length === 0 ? (
            <PlanStepRow
              status="pending"
              text="Waiting for sandbox session…"
            />
          ) : (
            planSteps.map((s) => (
              <PlanStepRow
                key={s.step_id}
                status={s.status}
                text={s.text}
              />
            ))
          )}
        </div>

        {/* AI thinking */}
        <div
          style={{
            marginTop: 4,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(244,175,37,0.10)',
            border: '1px solid rgba(244,175,37,0.25)',
          }}
        >
          <div className="eyebrow-amber" style={{ fontSize: 9 }}>
            AI THINKING
          </div>
          {(thoughts.length === 0
            ? ['Sandbox idle. Awaiting operator command.']
            : thoughts
          ).map((t, i) => (
            <div
              key={i}
              className="playfair animate-slide-up-fade"
              style={{
                marginTop: 6,
                fontSize: 13,
                fontStyle: 'italic',
                color: 'var(--ink-secondary)',
                lineHeight: 1.5,
              }}
            >
              “{t}”
            </div>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        {/* Command preview */}
        <div
          className="sub-glass"
          style={{ padding: '10px 12px', borderRadius: 10 }}
        >
          <div className="eyebrow" style={{ fontSize: 9 }}>
            COMMAND · PYTHON
          </div>
          <pre
            className="mono"
            style={{
              marginTop: 6,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ink-primary)',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            <SyntaxLine line={'import subprocess, pathlib'} />
            <SyntaxLine
              line={'files = pathlib.Path("/tmp").glob("*.cache")'}
            />
            <SyntaxLine line={'for f in files: f.unlink()'} />
          </pre>
        </div>

        <button
          type="button"
          onClick={handleExecute}
          aria-label="Execute sandbox command"
          style={{
            height: 44,
            borderRadius: 12,
            border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg,#ef4444,#b9201f)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow:
              '0 8px 24px rgba(239,68,68,0.35), 0 0 0 1px rgba(239,68,68,0.5)',
          }}
        >
          <Shield size={16} strokeWidth={2.5} />
          EXECUTE
        </button>
      </div>

      {/* ── RIGHT — LIVE TERMINAL ── */}
      <div
        style={{
          position: 'absolute',
          top: 68,
          right: 12,
          bottom: 12,
          width: 500,
          borderRadius: 14,
          zIndex: 3,
          background:
            'linear-gradient(180deg, rgba(34,28,16,0.94), rgba(20,16,10,0.94))',
          border: '1px solid rgba(244,175,37,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        }}
      >
        {/* terminal header */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid rgba(244,175,37,0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#f5e7c8',
          }}
        >
          <Terminal size={14} strokeWidth={1.75} style={{ color: '#f4af25' }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
            }}
          >
            STDOUT · LIVE
          </span>
          <span style={{ flex: 1 }} />
          <span
            className="tabular"
            style={{ fontSize: 10, color: '#8a7f72' }}
          >
            {bytesLabel}
          </span>
          <button
            type="button"
            onClick={handleScrollToBottom}
            aria-label="Scroll to bottom"
            style={{
              height: 22,
              minHeight: 22,
              minWidth: 0,
              padding: '0 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: 'rgba(244,175,37,0.15)',
              border: '1px solid rgba(244,175,37,0.30)',
              color: '#f4af25',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ArrowDownToLine size={10} strokeWidth={2} />
            scroll
          </button>
        </div>

        {/* terminal body */}
        <div
          ref={terminalBodyRef}
          onScroll={onTerminalScroll}
          className="mono no-scrollbar"
          style={{
            flex: 1,
            padding: '12px 14px',
            fontSize: 11,
            lineHeight: 1.55,
            color: '#f4af25',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div>
            <span style={{ color: '#8a7f72' }}>phantom@root</span>{' '}
            <span style={{ color: '#f5e7c8' }}>~/sandbox</span> ${' '}
            <span style={{ color: '#f5e7c8' }}>
              python /tmp/sb_{sessionShort}.py
            </span>
          </div>
          {output.map((line) => (
            <OutputRow key={line.id} line={line} />
          ))}
          <div
            style={{
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ color: '#8a7f72' }}>phantom@root</span>
            <span> $ </span>
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 7,
                height: 13,
                background: '#f4af25',
                animation: 'phantom-status-pulse 1.1s steps(1) infinite',
              }}
            />
          </div>
        </div>

        {/* quick-actions footer */}
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(244,175,37,0.18)',
            display: 'flex',
            gap: 6,
            background: 'rgba(20,16,10,0.50)',
          }}
        >
          <FooterButton onClick={handleCopy} icon={<Copy size={12} />}>
            copy output
          </FooterButton>
          <FooterButton onClick={handleRerun} icon={<RotateCw size={12} />}>
            rerun
          </FooterButton>
          <FooterButton onClick={handleSave} icon={<Save size={12} />}>
            save trace
          </FooterButton>
          <span style={{ flex: 1 }} />
          {killedBy && (
            <span
              style={{
                fontSize: 9,
                color: '#fca5a5',
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                paddingRight: 6,
              }}
            >
              <AlertTriangle size={10} strokeWidth={2} />
              killed · {killedBy}
            </span>
          )}
          {exitCode != null && killedBy == null && (
            <span
              className="tabular"
              style={{
                fontSize: 9,
                color: exitCode === 0 ? '#22c55e' : '#fca5a5',
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                paddingRight: 6,
              }}
            >
              exit {exitCode}
            </span>
          )}
          <button
            type="button"
            onClick={handleKill}
            disabled={killing}
            aria-label="Kill sandbox process (ROOT)"
            style={{
              height: 28,
              minHeight: 28,
              minWidth: 0,
              padding: '0 10px',
              borderRadius: 8,
              cursor: killing ? 'default' : 'pointer',
              background: 'rgba(239,68,68,0.18)',
              border: '1px solid rgba(239,68,68,0.40)',
              color: '#fca5a5',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: killing ? 0.6 : 1,
            }}
          >
            <StopCircle size={12} strokeWidth={2.5} />
            KILL (ROOT)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function PlanStepRow({
  status,
  text,
}: {
  status: PlanStep['status'];
  text: string;
}) {
  const palette = {
    done: { dot: '#22c55e', text: 'var(--ink-secondary)' },
    running: { dot: '#f4af25', text: 'var(--ink-primary)' },
    pending: { dot: 'rgba(0,0,0,0.18)', text: 'var(--ink-muted)' },
    failed: { dot: '#ef4444', text: 'var(--coral-deep)' },
  }[status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background:
          status === 'running'
            ? 'rgba(244,175,37,0.14)'
            : status === 'failed'
              ? 'rgba(239,68,68,0.10)'
              : 'transparent',
        border:
          status === 'running'
            ? '1px solid rgba(244,175,37,0.32)'
            : status === 'failed'
              ? '1px solid rgba(239,68,68,0.30)'
              : '1px solid transparent',
        boxShadow:
          status === 'running'
            ? 'inset 0 0 12px rgba(244,175,37,0.18)'
            : 'none',
      }}
    >
      {status === 'done' ? (
        <CheckCircle2 size={16} strokeWidth={2} style={{ color: palette.dot }} />
      ) : status === 'running' ? (
        <Play size={16} strokeWidth={2} style={{ color: palette.dot }} />
      ) : status === 'failed' ? (
        <AlertTriangle
          size={16}
          strokeWidth={2}
          style={{ color: palette.dot }}
        />
      ) : (
        <Circle size={14} strokeWidth={2} style={{ color: palette.dot }} />
      )}
      <span
        style={{
          fontSize: 12,
          fontWeight: status === 'running' ? 700 : 500,
          color: palette.text,
          flex: 1,
        }}
      >
        {text}
        {status === 'running' && <RunningDots />}
      </span>
      {status === 'running' && (
        <span className="micro-label" style={{ color: '#b07a10' }}>
          RUNNING
        </span>
      )}
    </div>
  );
}

function RunningDots() {
  return (
    <span
      style={{
        marginLeft: 6,
        color: '#f4af25',
        fontFamily: 'var(--font-mono)',
        display: 'inline-flex',
        gap: 1,
      }}
      aria-hidden
    >
      <span
        style={{ animation: 'phantom-status-pulse 0.6s ease-in-out infinite' }}
      >
        ·
      </span>
      <span
        style={{
          animation: 'phantom-status-pulse 0.6s ease-in-out infinite',
          animationDelay: '0.2s',
        }}
      >
        ·
      </span>
      <span
        style={{
          animation: 'phantom-status-pulse 0.6s ease-in-out infinite',
          animationDelay: '0.4s',
        }}
      >
        ·
      </span>
    </span>
  );
}

function OutputRow({ line }: { line: OutputLine }) {
  // Colour palette per spec: stdout amber by default; severity tints
  // (info=cream, warn=orange, error=coral); stderr=coral; meta=green.
  let color = '#f5e7c8';
  if (line.stream === 'stderr') color = '#ef4444';
  else if (line.stream === 'meta') {
    color =
      line.severity === 'warn'
        ? '#fb923c'
        : line.severity === 'error'
          ? '#ef4444'
          : '#22c55e';
  } else if (line.severity === 'warn') color = '#fb923c';
  else if (line.severity === 'error') color = '#ef4444';
  else if (line.severity === 'info') color = '#f5e7c8';
  else color = '#22c55e';

  return (
    <div
      className="animate-slide-up-fade"
      style={{
        paddingLeft: line.stream === 'meta' ? 0 : 12,
        color,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {line.text}
    </div>
  );
}

function FooterButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        minHeight: 28,
        minWidth: 0,
        padding: '0 10px',
        borderRadius: 8,
        cursor: 'pointer',
        background: 'rgba(244,175,37,0.10)',
        border: '1px solid rgba(244,175,37,0.25)',
        color: '#f5e7c8',
        fontSize: 10,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ color: '#f4af25', display: 'inline-flex' }}>{icon}</span>
      {children}
    </button>
  );
}

/**
 * Tiny syntax-highlighter for the COMMAND preview. Token colours follow
 * the prototype: keywords amber-deep, strings coral. Non-load-bearing —
 * just visual sugar so the preview reads like the design comp.
 */
function SyntaxLine({ line }: { line: string }) {
  const KEYWORDS = ['import', 'from', 'for', 'in', 'def', 'return', 'if', 'else'];
  const tokens: React.ReactNode[] = [];
  // Naive tokenise: split on whitespace + quotes; we only care about
  // visual tinting, not correctness for arbitrary Python.
  const re = /("[^"]*"|'[^']*'|\s+|[A-Za-z_][A-Za-z0-9_.]*|[()=:,])/g;
  let i = 0;
  for (const match of line.match(re) ?? []) {
    const key = `t${i++}`;
    if (/^["'].*["']$/.test(match)) {
      tokens.push(
        <span key={key} style={{ color: '#b9201f' }}>
          {match}
        </span>
      );
    } else if (KEYWORDS.includes(match)) {
      tokens.push(
        <span key={key} style={{ color: '#8a5e0a' }}>
          {match}
        </span>
      );
    } else {
      tokens.push(<span key={key}>{match}</span>);
    }
  }
  return (
    <span style={{ display: 'block' }}>
      {tokens}
    </span>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
