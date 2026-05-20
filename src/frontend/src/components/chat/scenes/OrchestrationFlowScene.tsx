import { motion } from 'framer-motion';
import { Network, CheckCircle2, Loader2 } from 'lucide-react';
import type { OrchestrationFlowSceneData, OrchestrationNode } from '@shared/types';

interface OrchestrationFlowSceneProps {
  data: OrchestrationFlowSceneData;
}

export function OrchestrationFlowScene({ data }: OrchestrationFlowSceneProps) {
  return (
    <div
      className="glass lift"
      style={{ width: 540, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-orchestration"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
        <Network size={14} className="text-amber-500 animate-pulse" />
        <span className="eyebrow-amber">
          SWARM DELEGATION · {data.rootLabel.toUpperCase()}
        </span>
      </div>

      {/* Nodes list */}
      <div className="space-y-4">
        {data.nodes.map((node, index) => {
          const statusColors = getStatusColors(node.status);

          return (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative pl-6"
            >
              {/* Connector line for the tree structure */}
              {index < data.nodes.length - 1 && (
                <div
                  className="absolute left-2.5 top-6 bottom-[-16px] w-[1px] bg-amber-500/20"
                  style={{ zIndex: 0 }}
                />
              )}

              {/* Node Status Dot Indicator */}
              <div
                className={`absolute left-1 top-1.5 w-3 h-3 rounded-full border-2 flex items-center justify-center bg-white dark:bg-slate-900 ${statusColors.border}`}
                style={{ zIndex: 1 }}
              >
                {node.status === 'running' && (
                  <span className="w-1 h-1 rounded-full bg-amber-500 animate-ping" />
                )}
              </div>

              {/* Node Contents */}
              <div className="sub-glass p-3 rounded-xl space-y-2 border border-white/5 bg-white/20 dark:bg-slate-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                      @{node.agentId}
                    </span>
                    <h4 className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      {node.label}
                    </h4>
                  </div>
                  <span className={`text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusColors.badge}`}>
                    {node.status}
                  </span>
                </div>

                {/* Subtask items checklist */}
                {node.subtasks && node.subtasks.length > 0 && (
                  <div className="space-y-1 pl-1 border-l border-white/10 mt-1">
                    {node.subtasks.map((sub, sIdx) => (
                      <div key={sIdx} className="flex items-center gap-2 text-[9.5px]">
                        {sub.done ? (
                          <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                        ) : node.status === 'running' ? (
                          <Loader2 size={10} className="text-amber-500 animate-spin shrink-0" />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full border border-slate-350 dark:border-slate-800 shrink-0" />
                        )}
                        <span className={`leading-tight ${sub.done ? "line-through text-slate-400" : "text-slate-500 dark:text-slate-350"}`}>
                          {sub.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function getStatusColors(status: OrchestrationNode['status']) {
  switch (status) {
    case 'completed':
      return {
        border: 'border-emerald-500 text-emerald-500',
        badge: 'bg-emerald-500/10 text-emerald-500',
      };
    case 'running':
      return {
        border: 'border-amber-500 text-amber-500',
        badge: 'bg-amber-500/15 text-amber-500',
      };
    case 'failed':
      return {
        border: 'border-rose-500 text-rose-500',
        badge: 'bg-rose-500/10 text-rose-500',
      };
    default:
      return {
        border: 'border-slate-350 dark:border-slate-800 text-slate-400',
        badge: 'bg-slate-100 dark:bg-slate-900 text-slate-400',
      };
  }
}
