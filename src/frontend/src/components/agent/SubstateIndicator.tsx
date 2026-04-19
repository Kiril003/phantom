import { motion } from 'framer-motion';
import type { AgentSubstate } from '@shared/types';

const SUBSTATE_META: Record<AgentSubstate, { color: string; label: string; pulse: number }> = {
  thinking:     { color: 'var(--chart-2)',   label: 'THINKING',     pulse: 1.6 },
  acting:       { color: 'var(--chart-4)',   label: 'ACTING',       pulse: 0.8 },
  reflecting:   { color: 'var(--signal-info)', label: 'REFLECTING', pulse: 2.4 },
  waiting_user: { color: 'var(--signal-warn)', label: 'WAITING USER', pulse: 0.6 },
  paused:       { color: 'var(--ink-muted)', label: 'PAUSED',       pulse: 0 },
  idle:         { color: 'var(--ink-faint)', label: 'IDLE',         pulse: 0 },
  // Phase 9.2.3 (F-14) — quota-parked tasks pulse slow amber and say so.
  // Distinct label / cadence from WAITING USER so the operator can tell
  // auto-resuming probe-loop tasks apart from tasks blocked on human input.
  blocked_quota: { color: 'var(--signal-warn)', label: 'BLOCKED (QUOTA)', pulse: 2.0 },
};

export function SubstateIndicator({ substate }: { substate: AgentSubstate }) {
  const meta = SUBSTATE_META[substate];
  if (substate === 'idle') return null;
  return (
    <div className="flex items-center gap-2" style={{ minHeight: 20 }} data-testid="substate-indicator">
      <motion.span
        animate={
          meta.pulse > 0
            ? { opacity: [0.4, 1, 0.4], scale: [0.85, 1.1, 0.85] }
            : { opacity: 1, scale: 1 }
        }
        transition={
          meta.pulse > 0
            ? { duration: meta.pulse, repeat: Infinity, ease: 'easeInOut' }
            : undefined
        }
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          background: meta.color,
          boxShadow: `0 0 8px ${meta.color}`,
        }}
      />
      <span
        className="font-mono"
        style={{
          color: meta.color,
          letterSpacing: 'var(--tracking-wider)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        {meta.label}
      </span>
    </div>
  );
}
