import { ShieldAlert, Fingerprint, ShieldCheck } from 'lucide-react';
import type { ObjectionSceneData } from '@shared/types';

interface ObjectionSceneProps {
  data: ObjectionSceneData;
}

export function ObjectionScene({ data }: ObjectionSceneProps) {
  return (
    <div
      className="glass lift border border-rose-500/30 bg-rose-50/5 dark:bg-rose-950/5"
      style={{
        width: 540,
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(239, 68, 68, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      }}
      data-testid="scene-objection"
    >
      {/* Background warning pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(45deg, #ef4444 0, #ef4444 1px, transparent 0, transparent 50%)',
          backgroundSize: '10px 10px',
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-rose-500/20 pb-2 mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-rose-500 animate-pulse" />
          <span className="text-[10px] font-display font-bold text-rose-500 tracking-widest uppercase">
            OBJECTION ASSERTED
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Fingerprint size={10} className="text-rose-500/60" />
          <span className="text-[7.5px] font-mono text-rose-500/70 font-semibold tracking-wider uppercase">
            {data.signature}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3 relative z-10">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[8.5px] font-mono font-bold text-rose-400 uppercase tracking-wider">
              Origin Node:
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-700 dark:text-slate-200">
              @{data.node}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[8.5px] font-mono font-bold text-rose-400 uppercase tracking-wider">
              Conflict Signature:
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-350">
              {data.conflict}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[8.5px] font-mono font-bold text-rose-400 uppercase tracking-wider">
              Core State:
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-350">
              {data.state}
            </span>
          </div>
        </div>

        {/* Detailed Explanation */}
        <div className="sub-glass p-3 rounded-xl border border-rose-500/10 bg-rose-500/5 text-rose-700 dark:text-rose-300 text-[10px] leading-relaxed">
          <p>{data.details}</p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between mt-1 pt-1">
          <span className="text-[8.5px] font-mono font-bold text-slate-400">
            ARBITRATION STATUS
          </span>
          <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-amber-500 text-[8px] font-mono font-bold uppercase tracking-wider">
            <ShieldCheck size={9} />
            Resolving Code
          </div>
        </div>
      </div>
    </div>
  );
}
