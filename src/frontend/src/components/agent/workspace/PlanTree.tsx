/**
 * PlanTree — pro-console overhaul (Cycle 7 Hardening).
 *
 * Structured hierarchical view of the current mission strategy.
 */
import { useMemo } from 'react';
import {
  GitBranch,
  Check,
  X
} from 'lucide-react';
import type {
  AgentPlanStep,
  AgentSubGoal,
} from '@shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';

export const MAX_DEPTH = 5;

type RecentAction = AgentPlanStep & {
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
  audit_entry_id?: number;
};

interface Props {
  subGoals: AgentSubGoal[];
  recentActions: RecentAction[];
  activeSubGoalId?: string | null;
}

export function PlanTree({
  subGoals,
  recentActions,
  activeSubGoalId,
}: Props) {
  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const actionsBySubGoal = useMemo(() => {
    const map = new Map<string, RecentAction[]>();
    for (const a of recentActions) {
      const key = a.sub_goal_id ?? '__orphan__';
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [recentActions]);

  if (subGoals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-30 font-mono text-[10px]">
        <GitBranch size={20} className="mb-2" />
        <span>[NO_STRATEGY_LOADED]</span>
      </div>
    );
  }

  if (isPro) {
    return (
      <div className="flex flex-col h-full font-mono text-[11px]" data-testid="plan-tree">
         <div className="flex items-center gap-2 mb-2 px-1 text-neutral-600 text-[9px] font-bold uppercase tracking-widest">
            <GitBranch size={10} />
            <span>Mission_Plan: {subGoals.length} nodes</span>
         </div>
         <div className="flex-1 overflow-y-auto pr-1">
            {subGoals.map((sg, idx) => (
               <SubGoalNode 
                  key={sg.id}
                  index={idx}
                  subGoal={sg}
                  actions={actionsBySubGoal.get(sg.id) ?? []}
                  isActive={activeSubGoalId ? sg.id === activeSubGoalId : sg.status === 'active'}
               />
            ))}
         </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="plan-tree">
       {/* Legacy layout kept for non-pro themes */}
       <div className="text-center py-10 text-neutral-400 font-serif italic">Switch to Pro-Console for the full engineering view.</div>
    </div>
  );
}

function SubGoalNode({ index, subGoal, actions, isActive }: { index: number, subGoal: AgentSubGoal, actions: RecentAction[], isActive: boolean }) {
  const isDone = subGoal.status === 'done';
  const isFailed = subGoal.status === 'failed';
  
  return (
    <div className={`mb-2 border-l-2 pl-3 transition-colors ${isActive ? 'border-cyan-500 bg-cyan-500/5' : isDone ? 'border-neutral-800' : 'border-neutral-900'}`}>
       <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] text-neutral-700 font-bold">{String(index + 1).padStart(2, '0')}</span>
          <span className={`font-bold ${isActive ? 'text-cyan-400' : isDone ? 'text-neutral-500' : 'text-neutral-300'}`}>
             {subGoal.description.toUpperCase()}
          </span>
          <span className="ml-auto text-[9px] text-neutral-600 tabular">
             [{subGoal.actions_used}/{subGoal.expected_actions}]
          </span>
          {isDone && <Check size={10} className="text-green-500" />}
          {isFailed && <X size={10} className="text-red-500" />}
       </div>
       
       {subGoal.acceptance_criteria && (
          <div className="text-[9px] text-neutral-600 mb-1 leading-tight italic">
             {">"} Criteria: {subGoal.acceptance_criteria}
          </div>
       )}

       {actions.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-1 ml-2">
             {actions.map(a => (
                <div key={a.step_idx} className="flex items-center gap-2 group">
                   <div className="w-1 h-1 rounded-full bg-neutral-800" />
                   <span className="text-[9px] text-cyan-600 font-bold shrink-0">{a.action}</span>
                   <span className="text-[10px] text-neutral-500 truncate group-hover:text-white transition-colors">{a.intent}</span>
                   {a.result?.elapsed_ms && <span className="ml-auto text-[8px] text-neutral-800">{a.result.elapsed_ms}ms</span>}
                </div>
             ))}
          </div>
       )}
    </div>
  );
}
