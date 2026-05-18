import { useAgentStore } from '../../../stores/agentStore';
import { SubstateIndicator } from '../status/SubstateIndicator';
import { EmotionIndicator } from '../status/EmotionIndicator';
import { ThoughtBudget } from '../status/ThoughtBudget';
import { LLMCallBudget } from '../status/LLMCallBudget';
import { useQuery } from '@tanstack/react-query';
import { Brain, Zap, ShieldCheck, ShieldAlert, Activity } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';

interface Drive {
  name: string;
  current_level: number;
}

interface WillState {
  drives: Drive[];
  dominant_drive: string;
}

function getEmotionSummary(e: any): string {
  if (!e) return 'CALM';
  if (e.concern > 0.7) return 'ALERT';
  if (e.fatigue > 0.8) return 'TIRED';
  if (e.focus > 0.8) return 'FLOW';
  if (e.curiosity > 0.7) return 'CURIOUS';
  return 'STABLE';
}

export function AgentVitals() {
  const status = useAgentStore((s) => s.status);
  const substate = useAgentStore((s) => s.substate);
  const emotion = useAgentStore((s) => s.emotion);
  const thoughtBudget = useAgentStore((s) => s.thoughtBudget);
  const llmCallsUsed = useAgentStore((s) => s.llmCallsUsed);
  const llmCallsCap = useAgentStore((s) => s.llmCallsCap);
  const proactive = useAgentStore((s) => s.proactive);
  const unsafeMode = useAgentStore((s) => s.unsafeMode);

  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const { data: will } = useQuery<WillState>({
    queryKey: ['agent-will-state-mini'],
    queryFn: async () => {
      const resp = await fetch('/api/v1/agent/will/state', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('phantom_token')}` }
      });
      if (!resp.ok) throw new Error('Failed');
      return resp.json();
    },
    refetchInterval: 60000,
  });

  if (isPro) {
    return (
      <div className="flex flex-col gap-1 h-full font-mono text-[10px]" data-testid="agent-vitals">
        <div className="bg-black border border-white/5 p-2 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between border-b border-white/5 pb-1 mb-1">
            <span className="text-cyan-500 font-bold uppercase tracking-widest">[SYSTEM_VITALS]</span>
            <Activity size={10} className={status === 'running' ? 'text-green-500 animate-pulse' : 'text-neutral-800'} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-neutral-400">
             <span>STATE:</span>
             <span className="text-white text-right">{substate.toUpperCase()}</span>
             <span>MOOD:</span>
             <span className="text-white text-right">{getEmotionSummary(emotion)}</span>
             <span>UNCHAINED:</span>
             <span className={unsafeMode ? 'text-red-500 text-right' : 'text-green-500 text-right'}>{unsafeMode ? 'TRUE' : 'FALSE'}</span>
          </div>

          <div className="h-px bg-white/5 my-1" />

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[9px]">
               <span className="text-neutral-500">THOUGHT_CAP:</span>
               <span className="text-white font-bold">{thoughtBudget.actions_used}/{thoughtBudget.estimated_actions}</span>
            </div>
            <div className="h-1 w-full bg-white/5 overflow-hidden">
               <div className="h-full bg-cyan-500" style={{ width: `${Math.min(100, (thoughtBudget.actions_used/thoughtBudget.estimated_actions)*100)}%` }} />
            </div>

            <div className="flex justify-between items-center text-[9px]">
               <span className="text-neutral-500">LLM_COMPUTE:</span>
               <span className="text-white font-bold">{llmCallsUsed}/{llmCallsCap}</span>
            </div>
            <div className="h-1 w-full bg-white/5 overflow-hidden">
               <div className="h-full bg-purple-500" style={{ width: `${Math.min(100, (llmCallsUsed/llmCallsCap)*100)}%` }} />
            </div>
          </div>
        </div>

        {will && (
           <div className="bg-black border border-white/5 p-2 flex flex-col gap-1 shrink-0">
              <div className="flex items-center gap-2 border-b border-white/5 pb-1 mb-1">
                 <Brain size={10} className="text-amber-500" />
                 <span className="text-neutral-500 uppercase font-bold">Will_Drives</span>
              </div>
              <div className="flex flex-col gap-1">
                 {will.drives.slice(0, 4).map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                       <span className="w-12 text-neutral-600 uppercase text-[8px] truncate">{d.name}</span>
                       <div className="flex-1 h-0.5 bg-white/5 relative">
                          <div className={`absolute top-0 bottom-0 ${d.name === will.dominant_drive ? 'bg-amber-500' : 'bg-neutral-800'}`} style={{ width: `${d.current_level*100}%` }} />
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        )}

        <div className="mt-auto bg-black border border-white/5 p-1.5 flex items-center justify-between text-neutral-600">
           <div className="flex items-center gap-2">
              <Zap size={10} className={proactive.enabled ? 'text-amber-500' : ''} />
              <span className="uppercase">{proactive.enabled ? 'Proactive_Loop:ON' : 'Proactive:IDLE'}</span>
           </div>
           {proactive.enabled && <span className="w-1 h-1 bg-amber-500 rounded-full animate-pulse" />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden" data-testid="agent-vitals">
...

      {/* Primary Vitals */}
      <div 
        className="glass-panel p-2.5 flex flex-col gap-2.5 shrink-0 rounded-[12px]"
        style={{
          background: 'rgba(255, 255, 255, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.45)',
          boxShadow: '0 4px 15px rgba(0,0,0,0.02)',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="micro-label text-[9px] text-primary-deep font-bold">Vitals</span>
          <Activity size={10} className={status === 'running' ? 'text-signal-ok animate-pulse' : 'text-ink-faint'} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-ink-muted uppercase tracking-wider">State</span>
            <SubstateIndicator substate={substate} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-ink-muted uppercase tracking-wider">Mood</span>
            <EmotionIndicator emotion={emotion} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-ink-muted uppercase tracking-wider">Safe</span>
            {unsafeMode ? <ShieldAlert size={10} className="text-signal-alert" /> : <ShieldCheck size={10} className="text-signal-ok" />}
          </div>
        </div>

        <div className="h-px bg-black/5 mx-[-4px]" />

        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-[8px] uppercase text-ink-muted font-mono tracking-widest">
              <span>Thought</span>
              <span className="text-ink-primary font-bold">{thoughtBudget.actions_used}/{thoughtBudget.estimated_actions}</span>
            </div>
            <ThoughtBudget budget={thoughtBudget} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[8px] uppercase text-ink-muted font-mono tracking-widest">
              <span>Compute</span>
              <span className="text-ink-primary font-bold">{llmCallsUsed}/{llmCallsCap}</span>
            </div>
            <LLMCallBudget used={llmCallsUsed} cap={llmCallsCap} />
          </div>
        </div>
      </div>

      {/* Will Engine Mini */}
      {will && (
        <div 
          className="glass-panel p-2 flex flex-col gap-1.5 shrink-0 rounded-[12px]"
          style={{
            background: 'rgba(255, 255, 255, 0.55)',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.01)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <Brain size={10} className="text-primary" />
            <span className="micro-label text-[8px] text-primary-deep font-bold">Drives</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {will.drives.slice(0, 4).map(drive => (
              <div key={drive.name} className="space-y-0.5">
                <div className="text-[7px] uppercase truncate font-bold text-ink-muted tracking-wide">
                  {drive.name}
                </div>
                <div className="h-1 w-full bg-black/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-1000 shadow-[0_0_4px_var(--primary)]"
                    style={{ 
                      width: `${drive.current_level * 100}%`, 
                      opacity: drive.name === will.dominant_drive ? 1 : 0.3,
                      background: drive.name === will.dominant_drive ? 'var(--primary)' : 'var(--ink-muted)'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proactive Loop */}
      <div 
        className="glass-panel p-2 flex items-center justify-between mt-auto rounded-[10px]"
        style={{
          background: 'rgba(255, 255, 255, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <Zap size={10} className={proactive.enabled ? 'text-primary animate-pulse' : 'text-ink-faint'} />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] truncate text-ink-secondary">
            {proactive.enabled ? 'Proactive' : 'Idle'}
          </span>
        </div>
        {proactive.enabled && (
           <span className="w-1 h-1 rounded-full bg-primary animate-ping" />
        )}
      </div>
    </div>
  );
}
