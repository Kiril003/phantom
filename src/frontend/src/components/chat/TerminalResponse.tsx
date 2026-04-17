import { useState, useCallback } from 'react';
import { Play, AlertTriangle, Check, X, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { linuxApi } from '../../services/api';

export interface TerminalData {
  command: string;
  explanation?: string;
  dangerous?: boolean;
  auto_run?: boolean;
  pre_output?: string;
}

interface TerminalResponseProps {
  data: TerminalData;
}

interface RunState {
  status: 'idle' | 'running' | 'completed' | 'error' | 'needs_confirm';
  stdout: string;
  stderr: string;
  exit_code: number | null;
  dangerous: boolean;
  explanation: string;
}

const initialRun: RunState = {
  status: 'idle',
  stdout: '',
  stderr: '',
  exit_code: null,
  dangerous: false,
  explanation: '',
};

export function TerminalResponse({ data }: TerminalResponseProps) {
  const [run, setRun] = useState<RunState>(initialRun);
  const [confirmed, setConfirmed] = useState(false);

  const execute = useCallback(
    async (forceConfirm: boolean) => {
      setRun((r) => ({ ...r, status: 'running', stdout: '', stderr: '', exit_code: null }));
      try {
        const resp = await linuxApi.execute({
          command: data.command,
          timeout_s: 30,
          confirmed: forceConfirm,
        });
        setRun({
          status: resp.status,
          stdout: resp.stdout,
          stderr: resp.stderr,
          exit_code: resp.exit_code,
          dangerous: resp.dangerous,
          explanation: resp.explanation,
        });
      } catch (err) {
        setRun({
          status: 'error',
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          exit_code: null,
          dangerous: data.dangerous ?? false,
          explanation: data.explanation ?? '',
        });
      }
    },
    [data.command, data.dangerous, data.explanation]
  );

  const runCommand = useCallback(() => {
    if (run.status === 'running') return;
    execute(confirmed || (data.auto_run ?? false));
  }, [run.status, confirmed, data.auto_run, execute]);

  const needsConfirmNow = run.status === 'needs_confirm' && !confirmed;

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--surface-void)',
        border: '1px solid var(--line-default)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{
          background: 'var(--surface-raised)',
          borderBottom: '1px solid var(--line-subtle)',
        }}
      >
        <span
          className="font-mono tracking-wider uppercase"
          style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
        >
          SHELL
        </span>
        {(run.dangerous || data.dangerous) && (
          <motion.div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{
              background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)',
              color: 'var(--signal-alert)',
              fontSize: 'var(--fs-micro)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <AlertTriangle size={10} strokeWidth={2} />
            <span className="font-mono tracking-wider">DANGER</span>
          </motion.div>
        )}
        <div className="flex-1" />
        <StatusPill status={run.status} />
      </div>

      {/* Command line */}
      <div className="px-3 py-2 flex items-start gap-2">
        <span
          className="font-mono select-none pt-[1px]"
          style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}
        >
          $
        </span>
        <code
          className="font-mono whitespace-pre-wrap break-all flex-1"
          style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-xs)', lineHeight: 'var(--lh-normal)' }}
        >
          {data.command}
        </code>
        <button
          type="button"
          onClick={runCommand}
          disabled={run.status === 'running'}
          className="flex items-center justify-center gap-1 rounded transition-opacity"
          style={{
            minWidth: 44,
            minHeight: 44,
            padding: '0 10px',
            background: needsConfirmNow ? 'var(--signal-alert)' : 'var(--accent)',
            color: 'var(--ink-inverse)',
            opacity: run.status === 'running' ? 0.6 : 1,
            fontSize: 'var(--fs-micro)',
            fontFamily: 'var(--font-tech)',
            letterSpacing: '0.08em',
          }}
          aria-label={needsConfirmNow ? 'Confirm dangerous command' : 'Run command'}
        >
          {run.status === 'running' ? (
            <>
              <Loader2 size={12} className="animate-spin" strokeWidth={2} />
              <span>RUN…</span>
            </>
          ) : needsConfirmNow ? (
            <>
              <AlertTriangle size={12} strokeWidth={2} />
              <span>CONFIRM</span>
            </>
          ) : (
            <>
              <Play size={12} strokeWidth={2} />
              <span>RUN</span>
            </>
          )}
        </button>
      </div>

      {/* Explanation / confirm prompt */}
      {(run.explanation || data.explanation) && (
        <div
          className="px-3 py-2"
          style={{
            borderTop: '1px solid var(--line-subtle)',
            background: 'var(--surface-raised)',
          }}
        >
          <span
            className="font-mono tracking-wider uppercase"
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
          >
            EXPLAIN
          </span>
          <div
            className="mt-1"
            style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-xs)', lineHeight: 'var(--lh-normal)' }}
          >
            {run.explanation || data.explanation}
          </div>
          {needsConfirmNow && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer" style={{ minHeight: 32 }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="w-4 h-4"
                style={{ accentColor: 'var(--signal-alert)' }}
              />
              <span
                className="font-mono"
                style={{ color: 'var(--signal-alert)', fontSize: 'var(--fs-xs)' }}
              >
                I understand this command is dangerous
              </span>
            </label>
          )}
        </div>
      )}

      {/* Output */}
      {(run.stdout || run.stderr || data.pre_output) && (
        <pre
          className="m-0 px-3 py-2 whitespace-pre-wrap break-all overflow-y-auto"
          style={{
            background: 'var(--surface-void)',
            borderTop: '1px solid var(--line-subtle)',
            color: 'var(--ink-primary)',
            fontFamily: 'var(--font-tech)',
            fontSize: 'var(--fs-micro)',
            maxHeight: 180,
            lineHeight: 'var(--lh-normal)',
          }}
        >
          {run.stdout || data.pre_output}
          {run.stderr && (
            <span style={{ color: 'var(--signal-alert)' }}>
              {run.stdout ? '\n' : ''}
              {run.stderr}
            </span>
          )}
          {run.exit_code != null && (
            <span
              className="block mt-2 font-mono tracking-wider"
              style={{
                color: run.exit_code === 0 ? 'var(--signal-ok)' : 'var(--signal-alert)',
                fontSize: 'var(--fs-micro)',
              }}
            >
              [exit {run.exit_code}]
            </span>
          )}
        </pre>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: RunState['status'] }) {
  const label = STATUS_LABEL[status];
  const color = STATUS_COLOR[status];
  const Icon = STATUS_ICON[status];
  return (
    <span
      className="flex items-center gap-1 font-mono tracking-wider"
      style={{ color, fontSize: 'var(--fs-micro)' }}
    >
      <Icon size={10} strokeWidth={2} />
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<RunState['status'], string> = {
  idle: 'IDLE',
  running: 'RUNNING',
  completed: 'DONE',
  error: 'ERROR',
  needs_confirm: 'CONFIRM?',
};
const STATUS_COLOR: Record<RunState['status'], string> = {
  idle: 'var(--ink-muted)',
  running: 'var(--accent)',
  completed: 'var(--signal-ok)',
  error: 'var(--signal-alert)',
  needs_confirm: 'var(--signal-warn)',
};
const STATUS_ICON: Record<RunState['status'], typeof Play> = {
  idle: Play,
  running: Loader2,
  completed: Check,
  error: X,
  needs_confirm: AlertTriangle,
};
