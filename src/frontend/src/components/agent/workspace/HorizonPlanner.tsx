import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Target, ChevronRight, ChevronDown, Zap, Flag } from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import type { HorizonGoal } from '@shared/types';

const HORIZON_LABELS = [
  "Vision (Життя)",
  "Year (Рік)",
  "Quarter (Квартал)",
  "Month (Місяць)",
  "Week (Тиждень)",
  "Day (День)",
  "Action (Зараз)"
];

const HORIZON_COLORS = [
  "text-amber-400 border-amber-400/30 bg-amber-400/5", // Vision
  "text-orange-400 border-orange-400/30 bg-orange-400/5", // Year
  "text-rose-400 border-rose-400/30 bg-rose-400/5", // Quarter
  "text-purple-400 border-purple-400/30 bg-purple-400/5", // Month
  "text-blue-400 border-blue-400/30 bg-blue-400/5", // Week
  "text-cyan-400 border-cyan-400/30 bg-cyan-400/5", // Day
  "text-emerald-400 border-emerald-400/30 bg-emerald-400/5" // Action
];

export const HorizonPlanner: React.FC = () => {
  const { horizons, horizonsLoading, loadHorizons } = useAgentStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadHorizons();
  }, [loadHorizons]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderGoal = (goal: HorizonGoal) => {
    const isExpanded = expanded[goal.id];
    const hasChildren = goal.children && goal.children.length > 0;
    const colorClass = HORIZON_COLORS[goal.horizon_level] || "text-neutral-400";

    return (
      <div key={goal.id} className="mb-2">
        <div 
          className={`flex items-center p-2 rounded border group cursor-pointer transition-all hover:bg-black/20 ${colorClass}`}
          onClick={() => hasChildren && toggleExpand(goal.id)}
        >
          <div className="mr-2 opacity-50">
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <div className="w-[14px]" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">
                {goal.horizon_name}
              </span>
              <span className="text-[10px] font-mono opacity-50">
                {Math.round(goal.progress * 100)}%
              </span>
            </div>
            <div className="text-xs font-medium truncate">{goal.description}</div>
            
            {/* Progress bar */}
            <div className="h-1 bg-black/20 rounded-full mt-1.5 overflow-hidden">
              <motion.div 
                className="h-full bg-current opacity-60"
                initial={{ width: 0 }}
                animate={{ width: `${goal.progress * 100}%` }}
                transition={{ duration: 1 }}
              />
            </div>
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="ml-4 mt-2 border-l border-white/5 pl-2">
            {goal.children.map(child => renderGoal(child))}
          </div>
        )}
      </div>
    );
  };

  if (horizonsLoading && horizons.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 opacity-50 italic text-xs">
        <Zap size={14} className="animate-pulse mr-2" />
        Loading Horizons...
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto max-h-full scrollbar-hide">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Target className="text-amber-400 mr-2" size={18} />
          <h2 className="text-sm font-bold uppercase tracking-widest text-ink-heading">7-Horizon Planner</h2>
        </div>
        <button 
          onClick={() => loadHorizons()}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          <Zap size={14} className="text-amber-400/50" />
        </button>
      </div>

      <div className="space-y-4">
        {horizons.length > 0 ? (
          horizons.map(goal => renderGoal(goal))
        ) : (
          <div className="text-center p-8 border border-dashed border-white/10 rounded-xl opacity-50">
            <Flag size={24} className="mx-auto mb-2 opacity-20" />
            <p className="text-xs italic">No horizons defined yet.</p>
            <p className="text-[10px] mt-1">Vision provides the spark for all actions.</p>
          </div>
        )}
      </div>
      
      {/* Hierarchy Info */}
      <div className="mt-8 pt-6 border-t border-white/5 opacity-30">
        <div className="text-[9px] uppercase tracking-[0.2em] font-bold mb-3 text-center">Hierarchy of Intent</div>
        <div className="flex flex-col space-y-1">
          {HORIZON_LABELS.map((label, i) => (
            <div key={label} className="flex items-center text-[10px]">
              <div className={`w-1 h-1 rounded-full mr-2 ${HORIZON_COLORS[i].split(' ')[0].replace('text-', 'bg-')}`} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
