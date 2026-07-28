/**
 * FocusPanel — pro-console overhaul (Cycle 7 Hardening).
 *
 * High-density engineering panel with monospace focus.
 */

import { useState } from 'react';
import { Cpu, Database, ChevronDown, ChevronUp, Zap, Brain, Loader2 } from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import { useUIStore } from '../../../stores/uiStore';
import type { FocusedAgent } from '../../../stores/uiStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { PlanTree } from './PlanTree';
import { AgentActivityStream } from './AgentActivityStream';
import { HorizonPlanner } from './HorizonPlanner';
import { OrgChart } from './OrgChart';
// ─── helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// ─── pivots ──────────────────────────────────────────────────────────────────

function ForegroundPivot() {
  const subGoals = useAgentStore((s) => s.subGoals);
  const currentTask = useAgentStore((s) => s.currentTask);
  const thoughtBudget = useAgentStore((s) => s.thoughtBudget);
  const llmCallsUsed = useAgentStore((s) => s.llmCallsUsed);
  const llmCallsCap = useAgentStore((s) => s.llmCallsCap);
  const reflections = useAgentStore((s) => s.reflections);
  const substate = useAgentStore((s) => s.substate);
  
  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const [planExpanded, setPlanExpanded] = useState(false);

  const activeSubGoalId = subGoals.find((sg) => sg.status === 'active')?.id ?? null;
  const lastRef = reflections[reflections.length - 1];

  const formatSubstate = (state?: string) => {
    switch (state?.toLowerCase()) {
      case 'shadow': return 'ТІНЬ';
      case 'focus': return 'ФОКУС';
      case 'dialogue': return 'ДІАЛОГ';
      case 'idle': return 'ОЧІКУВАННЯ';
      case 'creative': return 'ТВОРЧІСТЬ';
      default: return state || 'АКТИВНІСТЬ';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Vital Metrics Bar (Now-row) */}
      <div 
        data-testid="focus-now-row"
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-black/5 z-20"
        style={{
          background: 'rgba(255, 255, 255, 0.5)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div data-testid="now-steps" className="flex items-center gap-1.5 font-mono text-[10px]">
            <Zap size={10} className="text-primary" />
            <span className="text-neutral-500">КРОКИ</span>
            <span className="text-neutral-200 font-bold">{thoughtBudget.actions_used}/{thoughtBudget.estimated_actions}</span>
          </div>
          <div data-testid="now-ai" className="flex items-center gap-1.5 font-mono text-[10px]">
            <Cpu size={10} className="text-cyan-500" />
            <span className="text-neutral-500">ШІ</span>
            <span className="text-neutral-200 font-bold">{llmCallsUsed}/{llmCallsCap}</span>
          </div>
          <div data-testid="now-loop" className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-neutral-500">ЦИКЛ</span>
            <span className="text-neutral-200 font-bold">↻{thoughtBudget.reflections_done}</span>
          </div>
          {substate !== 'idle' && (
            <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 animate-pulse">
               <Loader2 size={10} className="animate-spin text-primary" />
               <span className="font-mono text-[9px] font-bold text-primary uppercase">{formatSubstate(substate)}</span>
            </div>
          )}
        </div>
        {lastRef && (
          <div data-testid="now-cf" className="font-mono text-[10px] text-primary font-bold">
            ВІРОГІДНІСТЬ {lastRef.new_confidence.toFixed(2)}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 relative z-10">
        <AgentActivityStream />
      </div>

      <section 
        className={`shrink-0 flex flex-col overflow-hidden transition-all duration-300 z-20 ${planExpanded ? 'h-[240px]' : 'h-10'} ${isPro ? 'bg-neutral-950/80 border-t border-white/5' : 'rounded-xl bg-white/40 border border-white/50 shadow-sm mt-1 mx-2 mb-2'}`}
      >
        <button 
          onClick={() => setPlanExpanded(!planExpanded)}
          className="h-10 flex items-center justify-between px-4 hover:bg-black/5 transition-colors shrink-0"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold tracking-widest text-primary-deep uppercase">Стратегічний план</span>
            {currentTask && (
              <span className="text-[10px] text-primary/60 font-bold">
                {subGoals.filter(sg => sg.status === 'done').length}/{subGoals.length}
              </span>
            )}
          </div>
          {planExpanded ? <ChevronDown size={14} className="text-primary" /> : <ChevronUp size={14} className="text-primary" />}
        </button>

        <div className="flex-1 overflow-y-auto p-2">
          <PlanTree
            subGoals={subGoals}
            recentActions={[]} 
            activeSubGoalId={activeSubGoalId}
          />
        </div>
      </section>
    </div>
  );
}

function BackgroundPivot() {
  const progressByTaskId = useAgentStore((s) => s.progressByTaskId);
  const bgTaskGoals = useAgentStore((s) => s.bgTaskGoals);
  const bgTaskIds = Object.keys(progressByTaskId);
  const primaryBgId = bgTaskIds[0] ?? null;
  const updates = primaryBgId ? (progressByTaskId[primaryBgId] ?? []) : [];
  const goal = primaryBgId ? (bgTaskGoals[primaryBgId] ?? primaryBgId) : '—';
  const lastUpdate = updates[updates.length - 1];

  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  return (
    <div className="flex flex-col gap-3 p-2" data-testid="focus-bg-progress">
       <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-bold text-neutral-500 uppercase">
             {primaryBgId ? "АКТИВНИЙ ФОНОВИЙ ПРОЦЕС" : "ФОНОВІ ПРОЦЕСИ ВІДСУТНІ"}
          </span>
          <span className="text-[12px] text-ink-primary font-display truncate">
             {primaryBgId ? truncate(goal, 80) : "Фонові завдання не виконуються. Вони запускаються автоматично при складних обчисленнях."}
          </span>
       </div>
       <section className={`p-3 ${isPro ? 'bg-neutral-950 border border-white/5 font-mono' : 'rounded-lg bg-black/5 border border-black/5'}`}>
          {primaryBgId ? (
             <div className="flex flex-col gap-2">
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-cyan-500 animate-pulse" style={{ width: `${lastUpdate?.percent ?? 0}%` }} />
                </div>
                <div className="text-[10px] text-neutral-500">[{updates.length}] {lastUpdate?.label || 'Отримано імпульс системи.'}</div>
             </div>
          ) : <span className="text-[10px] opacity-40 uppercase">В очікуванні</span>}
       </section>
    </div>
  );
}

function StandingOrdersPivot() {
  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
         <div className="w-1.5 h-1.5 rounded-full bg-primary" />
         <span className="font-mono text-[10px] font-bold text-neutral-500 uppercase">Постійні доручення</span>
      </div>
      <section 
        data-testid="focus-so-placeholder"
        className={`p-4 text-center ${isPro ? 'bg-neutral-950 border border-white/5 font-mono text-[11px] text-neutral-600' : 'rounded-xl glass-panel bg-white/10 text-ink-muted text-xs'}`}
      >
        Активні постійні завдання відсутні. Доручення формуються автономно на основі вашого контексту або усних команд.
      </section>
    </div>
  );
}

function ProactivePivot() {
  const proactive = useAgentStore((s) => s.proactive);
  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  return (
    <div className="flex flex-col gap-4 p-2">
       <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
             <Brain size={14} className="text-primary" />
             <span className="font-mono text-[10px] font-bold text-neutral-500 uppercase">Двигун автономності</span>
          </div>
          <div 
            data-testid="proactive-enabled-indicator"
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${proactive.enabled ? 'bg-primary/20 text-primary' : 'bg-neutral-800 text-neutral-500'}`}
          >
            {proactive.enabled ? 'Активно' : 'В очікуванні'}
          </div>
       </div>

       {proactive.hasTriggers && (
         <div className="bg-primary/10 border border-primary/20 p-2 rounded text-[10px] text-primary animate-pulse">
            ! Очікують тригери дій
         </div>
       )}

       <section className={`p-4 ${isPro ? 'bg-neutral-950 border border-white/5 font-mono text-[11px]' : 'rounded-xl glass-panel bg-white/10 text-xs'}`}>
          {proactive.lastCycleAt ? `Останній аналіз: ${new Date(proactive.lastCycleAt).toLocaleTimeString()}` : 'Очікування першого циклу оцінки...'}
       </section>
    </div>
  );
}

function CouncilPivot() {
  const councilActive = useAgentStore((s) => s.councilActive);

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
       {!councilActive ? (
          <div data-testid="council-idle-label" className="flex flex-col items-center gap-2 opacity-50 text-center px-4">
             <Database size={24} className="text-neutral-400" />
             <span className="font-mono text-[10px] tracking-widest uppercase text-neutral-400">Рада агентів в очікуванні</span>
             <p className="text-[11px] text-neutral-500 max-w-xs">
                Консиліум запускається автоматично, коли виникає складна задача, що потребує узгодження кількох модулів.
             </p>
          </div>
       ) : (
          <button 
            data-testid="open-council-button"
            className="px-6 py-2 bg-primary text-white rounded-full font-bold text-sm shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
          >
             ВІДКРИТИ РАДУ
          </button>
       )}
    </div>
  );
}



// ─── FocusPanel ──────────────────────────────────────────────────────────────

interface Props {
  focusedAgent?: FocusedAgent;
}

export function FocusPanel({ focusedAgent: focusedAgentProp }: Props) {
  const focusedAgentStore = useUIStore((s) => s.focusedAgent);
  const pivot = focusedAgentProp ?? focusedAgentStore;
  
  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const formatPivotName = (p: string) => {
    switch (p) {
      case 'foreground': return 'Головний процес';
      case 'background': return 'Фонові завдання';
      case 'standing_orders': return 'Постійні доручення';
      case 'proactive': return 'Автономний двигун';
      case 'council': return 'Рада агентів';
      case 'horizons': return 'Планування';
      case 'org_chart': return 'Структура системи';
      default: return p;
    }
  };

  function renderPivot() {
    switch (pivot) {
      case 'foreground': return <ForegroundPivot />;
      case 'background': return <BackgroundPivot />;
      case 'standing_orders': return <StandingOrdersPivot />;
      case 'proactive': return <ProactivePivot />;
      case 'council': return <CouncilPivot />;
      case 'horizons': return <HorizonPlanner />;
      case 'org_chart': return <OrgChart />;
      default: return <ForegroundPivot />;
    }
  }

  return (
    <div
      data-testid="focus-panel"
      className={`flex flex-col h-full min-h-0 overflow-hidden relative ${isPro ? 'bg-black border border-white/5 p-2' : 'rounded-[24px] glass shadow-2xl overflow-hidden'}`}
      style={isPro ? {} : {
        background: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
      }}
    >
      {isPro && (
        <div className="flex items-center justify-between border-b border-white/5 pb-1 px-1 shrink-0">
          <div className="flex items-center gap-2">
             <Cpu size={10} className="text-cyan-500" />
             <span className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase">Фокус: {formatPivotName(pivot)}</span>
          </div>
          <div className="flex items-center gap-3">
             <span className="text-[8px] text-neutral-700 tabular">0.92 FLOPS</span>
             <Database size={8} className="text-neutral-800" />
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {renderPivot()}
      </div>
    </div>
  );
}
