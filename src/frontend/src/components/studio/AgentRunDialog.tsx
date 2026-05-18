/**
 * Phase 17b — AgentRunDialog.
 *
 * Pre-run prompt that gathers values for the CustomAgent's `inputs_schema`
 * (re-uses InfoNeedDialog when there are typed prompts) or runs immediately
 * if the agent has no run-time inputs.
 *
 * Light implementation: when `inputs_schema` is empty we just confirm + fire.
 * When it has prompts we render them sequentially through InfoNeedDialog,
 * collect answers into a flat dict keyed by InfoNeed.id, then submit.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import type { AgentInfoNeed, CustomAgent } from '@shared/types';
import { useStudioStore } from '../../stores/studioStore';
import { InfoNeedDialog } from '../agent/overlays/InfoNeedDialog';

interface Props {
  agent: CustomAgent;
  onClose: () => void;
  onLaunched?: (taskId: string, runId: string) => void;
}

export function AgentRunDialog({ agent, onClose, onLaunched }: Props) {
  const runAgent = useStudioStore((s) => s.runAgent);

  const inputs: AgentInfoNeed[] = agent.inputs_schema || [];
  const [step, setStep] = useState(0);
  const [collected, setCollected] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allDone = inputs.length === 0 || step >= inputs.length;

  // Auto-fire when no inputs are needed (operator just clicked "Запустити").
  useEffect(() => {
    if (inputs.length > 0) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const resp = await runAgent(agent.id, {});
        if (!cancelled && resp) {
          onLaunched?.(resp.task_id, resp.run_id);
          onClose();
        } else if (!cancelled) {
          setError('запуск не вдався');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id, inputs.length, runAgent, onClose, onLaunched]);

  const handleSubmit = async (answer: unknown) => {
    if (allDone) return;
    const need = inputs[step];
    setCollected((prev) => ({ ...prev, [need.id]: answer }));
    if (step + 1 >= inputs.length) {
      // Last input — fire.
      setBusy(true);
      try {
        const finalInputs = { ...collected, [need.id]: answer };
        const resp = await runAgent(agent.id, finalInputs);
        if (resp) {
          onLaunched?.(resp.task_id, resp.run_id);
          onClose();
          return;
        }
        setError('запуск не вдався');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep((s) => s + 1);
  };

  if (inputs.length === 0) {
    return (
      <motion.div
        className="fixed inset-0"
        style={{
          zIndex: 71,
          background: 'rgba(28,22,14,0.55)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div
          className="glass-strong"
          style={{
            padding: 24,
            borderRadius: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 320,
            alignItems: 'center',
          }}
        >
          <Play size={28} color="var(--primary, #F4AF25)" />
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {busy ? 'Запускаю агента…' : `Готовий запустити «${agent.name}»`}
          </span>
          {error && <span style={{ color: '#B9201F', fontSize: 12 }}>{error}</span>}
          {!busy && (
            <button
              type="button"
              onClick={onClose}
              style={{
                minHeight: 38,
                padding: '0 14px',
                borderRadius: 10,
                background: 'transparent',
                border: '1px solid rgba(180,150,90,0.30)',
                color: 'var(--ink-muted)',
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <X size={14} /> Скасувати
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  const need = inputs[step];
  return (
    <InfoNeedDialog
      infoNeed={need}
      busy={busy}
      onSubmit={handleSubmit}
      onCancel={onClose}
    />
  );
}
