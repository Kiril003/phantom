import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { Cpu } from 'lucide-react';
import { StatusBar } from '../components/core/StatusBar';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { AgentPanel } from '../components/agent/AgentPanel';
import { useAgentStream } from '../hooks/useAgentStream';
import { useAgentStore } from '../stores/agentStore';
import { EASE_PHANTOM } from '../styles/motion';

/**
 * OPERATOR — agent task surface (Phase 9.1).
 * Header: identity + substate. Body: AgentPanel. Subtle ambient pulse.
 */
export default function OperatorLayout() {
  useAgentStream();
  const substate = useAgentStore((s) => s.substate);
  const currentTask = useAgentStore((s) => s.currentTask);

  // Light ambient breathing tied to substate so the layout feels alive.
  useEffect(() => {
    document.body.setAttribute('data-substate', substate);
    return () => document.body.removeAttribute('data-substate');
  }, [substate]);

  return (
    <motion.div
      className="w-[1024px] h-[600px] flex flex-col relative"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <AmbientGlows />
      <StatusBar />

      <main className="flex-1 grid grid-cols-12 gap-4 px-4 py-4 min-h-0 z-10">
        <section className="col-span-12 flex flex-col min-h-0">
          <div className="flex items-center gap-3 px-2 pb-2">
            <Cpu size={16} strokeWidth={1.75} color="var(--accent)" />
            <span
              className="font-mono"
              style={{
                color: 'var(--accent)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wider)',
              }}
            >
              OPERATOR{currentTask?.task ? ` · TASK ${currentTask.task.id.slice(0, 6)}` : ''}
            </span>
          </div>
          <div
            className="flex-1 min-h-0"
            style={{
              background: 'var(--glass-panel)',
              border: '1px solid var(--glass-border)',
              borderRadius: 16,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              overflow: 'hidden',
            }}
          >
            <AgentPanel />
          </div>
        </section>
      </main>

      <FloatingToolbar />
    </motion.div>
  );
}
