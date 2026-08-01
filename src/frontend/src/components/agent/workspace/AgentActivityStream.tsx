import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, User, Terminal, Activity } from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import { ResponseRenderer } from '../../chat/ResponseRenderer';
import { localizedTime } from '../../../utils/format';
import type { ChatMessage, AgentObservation } from '@shared/types';

/**
 * AgentActivityStream — transforms raw agent store events into a dense,
 * high-signal execution log.
 */

interface ActivityEntry {
  id: string;
  ts: number;
  role: 'assistant' | 'user' | 'system';
  content: string;
  label?: string;
  kind: 'thought' | 'action' | 'observation' | 'reflection' | 'step';
  subtext?: string;
  message?: ChatMessage;
  
  // Consolidated step data
  taskId?: string;
  stepIdx?: number;
  thought?: string;
  intent?: string;
  actionName?: string;
  results?: AgentObservation[];
}

export function AgentActivityStream() {
  const recentActions = useAgentStore((s) => s.recentActions);
  const observations = useAgentStore((s) => s.observations);
  const reflections = useAgentStore((s) => s.reflections);
  const events = useAgentStore((s) => s.events);
  
  const listRef = useRef<HTMLDivElement>(null);

  // Map store state to a unified stream of activity entries
  const stream = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    const stepMap = new Map<string, ActivityEntry>();

    // 0. Extract Goals and Replies from events
    events.forEach(e => {
      const tid = (e.payload?.task_id as string) || 'global';
      
      if (e.type === 'task.started') {
        entries.push({
          id: `goal-${tid}-${e.ts}`,
          ts: e.ts,
          role: 'user',
          content: String(e.payload?.goal || ''),
          kind: 'thought',
          label: 'OBJECTIVE',
        });
      } else if (e.type === 'agent.chat.reply') {
        entries.push({
          id: `reply-${tid}-${e.ts}`,
          ts: e.ts,
          role: 'assistant',
          content: String(e.payload?.reply || e.payload?.content || ''),
          kind: 'observation',
          label: 'RESPONSE',
          message: {
            id: `msg-reply-${tid}-${e.ts}`,
            session_id: tid,
            user_id: 'assistant',
            role: 'assistant',
            content: String(e.payload?.reply || e.payload?.content || ''),
            response_form: (e.payload?.response_form as any) || 'text',
            metadata: { state_at_time: 'OPERATOR' as any, context_snapshot_id: '', ai_provider: 'gemini', latency_ms: 0, tokens_used: 0, tone: 'neutral', input_method: 'encoder' },
            attachments: (e.payload?.attachments as any) || [],
            created_at: new Date(e.ts).toISOString(),
          }
        });
      } else if (e.type === 'task.completed' || e.type === 'task.failed') {
        const summary = String(e.payload?.summary || e.payload?.error || '');
        if (summary && !summary.startsWith('Fast-Track:')) {
          entries.push({
            id: `final-${tid}-${e.ts}`,
            ts: e.ts,
            role: 'assistant',
            content: summary,
            kind: 'observation',
            label: e.type === 'task.failed' ? 'TASK FAILED' : 'TASK COMPLETED',
            message: {
              id: `msg-final-${tid}-${e.ts}`,
              session_id: tid,
              user_id: 'assistant',
              role: 'assistant',
              content: summary,
              response_form: 'markdown',
              metadata: { state_at_time: 'OPERATOR' as any, context_snapshot_id: '', ai_provider: 'gemini', latency_ms: 0, tokens_used: 0, tone: 'neutral', input_method: 'encoder' },
              attachments: [],
              created_at: new Date(e.ts).toISOString(),
            }
          });
        }
      } else if (e.type === 'plan.step_created') {
        const step = e.payload?.step as any;
        if (step && step.monologue) {
          const content = step.monologue._what_i_plan || step.monologue._intent || 'Thinking...';
          entries.push({
            id: `thought-${tid}-${e.ts}`,
            ts: e.ts,
            role: 'system',
            content: content,
            kind: 'thought',
            label: 'THOUGHT',
          });
        }
      } else if (e.type === 'reflection.completed') {
        entries.push({
          id: `refl-${tid}-${e.ts}`,
          ts: e.ts,
          role: 'system',
          content: String(e.payload?.summary || 'Reflecting on progress.'),
          kind: 'reflection',
          label: 'REFLECTION',
        });
      }
    });

    // 1. Actions + Thoughts (Grouped by taskId + step_idx)
    recentActions.forEach((action) => {
      const tid = action.sub_goal_id || 'global'; 
      const stepIdx = action.step_idx;
      const key = `${tid}-${stepIdx}`;
      
      let entry = stepMap.get(key);
      if (!entry) {
        entry = {
          id: `step-${key}`,
          ts: typeof action.ts === 'string' ? Date.parse(action.ts) : (action.ts || Date.now()),
          role: 'assistant',
          content: '',
          kind: 'step',
          taskId: tid,
          stepIdx: stepIdx,
          thought: action.monologue?.what_i_plan,
          intent: action.intent,
          actionName: action.action,
          results: [],
        };
        stepMap.set(key, entry);
        entries.push(entry);
      } else {
        entry.thought = entry.thought || action.monologue?.what_i_plan;
        entry.intent = entry.intent || action.intent;
        entry.actionName = entry.actionName || action.action;
      }
    });

    // 2. Observations
    observations.forEach((obs, idx) => {
      const stepIdx = obs.step_idx;
      const tid = obs.source === 'conversation_context' ? 'ctx' : 'global';
      const key = `${tid}-${stepIdx}`;
      
      if (stepIdx > 0 || (stepIdx === 0 && obs.source !== 'conversation_context')) {
        let entry = stepMap.get(key);
        if (!entry) {
          entry = {
            id: `step-${key}`,
            ts: typeof obs.ts === 'string' ? Date.parse(obs.ts) : (obs.ts || Date.now()),
            role: 'assistant',
            content: '',
            kind: 'step',
            stepIdx: stepIdx,
            results: [obs],
          };
          stepMap.set(key, entry);
          entries.push(entry);
        } else {
          if (!entry.results) entry.results = [];
          if (!entry.results.find(r => r.content === obs.content)) {
            entry.results.push(obs);
          }
        }
      } else {
        entries.push({
          id: `obs-sys-${idx}-${obs.ts}`,
          ts: typeof obs.ts === 'string' ? Date.parse(obs.ts) : (obs.ts || Date.now()),
          role: 'system',
          content: obs.content,
          kind: 'observation',
          label: obs.source === 'conversation_context' ? 'CONTEXT' : obs.type.toUpperCase(),
        });
      }
    });

    // 3. Reflections
    reflections.forEach((ref, idx) => {
      entries.push({
        id: `ref-${idx}`,
        ts: Date.now(),
        role: 'assistant',
        content: ref.summary || 'Reflection completed.',
        kind: 'reflection',
        label: `VERDICT: ${ref.verdict.toUpperCase()}`,
        subtext: ref.recommendations,
      });
    });

    return entries.sort((a, b) => a.ts - b.ts).slice(-60);
  }, [recentActions, observations, reflections, events]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [stream]);

  return (
    <div 
      ref={listRef}
      className="absolute inset-0 overflow-y-auto flex flex-col gap-4 p-4 scrollbar-thin"
      style={{ 
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {stream.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 opacity-30">
          <div className="w-12 h-12 rounded-full border-2 border-primary/20 flex items-center justify-center mb-3">
             <Activity size={20} className="text-primary/60" />
          </div>
          <span className="font-mono text-[9px] tracking-[0.3em] text-primary/80 uppercase">Чекаю на завдання</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {stream.map((entry) => (
          <ActivityBubble key={entry.id} entry={entry} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ActivityBubble({ entry }: { entry: ActivityEntry }) {
  if (entry.kind === 'step') {
    return <StepBubble entry={entry} />;
  }

  const time = localizedTime(entry.ts);
  const label = entry.label || entry.kind;
  
  if (entry.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="flex flex-col gap-1 max-w-[90%] self-end items-end mb-2 mt-4"
      >
        <div className="flex items-center gap-2 px-1 flex-row-reverse opacity-40">
          <User size={10} />
          <span className="text-[10px] font-mono tabular">
             {time}
          </span>
        </div>
        <div className="bg-primary/5 border border-primary/10 px-4 py-2.5 text-[14px] leading-relaxed text-amber-950 font-medium" style={{ borderRadius: '16px 16px 4px 16px' }}>
          {entry.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-1 max-w-[98%] self-start mb-2"
    >
      <div className="flex items-center gap-2 px-1 opacity-40">
        <Terminal size={10} className="text-primary" />
        <span className="micro-label text-[8px] font-bold uppercase tracking-[0.2em]">
          {label}
        </span>
        <span className="text-[8px] font-mono tabular">
           {time}
        </span>
      </div>

      <div className="px-2">
        {entry.message ? (
          <div className="scale-[1.0] origin-top-left">
            <ResponseRenderer message={entry.message} />
          </div>
        ) : (
          <div className="text-[14px] leading-relaxed text-ink-primary whitespace-pre-wrap">
            {entry.content}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StepBubble({ entry }: { entry: ActivityEntry }) {
  const { thought, intent, actionName, results, stepIdx, ts } = entry;
  const time = localizedTime(ts);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-1.5 max-w-[98%] self-start border-l-2 border-primary/10 pl-4 py-1 mb-2 ml-2 group"
    >
      <div className="flex items-center gap-2 opacity-30 group-hover:opacity-60 transition-opacity">
        <Zap size={10} className="text-primary" />
        <span className="text-[9px] font-bold uppercase tracking-widest">Step {stepIdx}</span>
        <span className="text-[9px] font-mono tabular">{time}</span>
      </div>

      {thought && (
        <div className="text-[13px] text-amber-900/60 italic leading-snug">
          {thought}
        </div>
      )}

      {actionName && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-ink-primary/70 font-mono">
            <span className="text-primary font-bold">$</span>
            <span className="font-semibold uppercase tracking-tighter">{actionName}</span>
            {intent && <span className="opacity-30 italic">— {intent}</span>}
          </div>
          
          {results && results.length > 0 && (
            <div className="space-y-1 pl-3 border-l border-black/5 mt-1">
              {results.map((res, i) => {
                const isSystemMetric = actionName === 'bash.run' && (res.content.includes('top -') || res.content.includes('Filesystem'));
                return (
                  <div key={i} className={`text-[11px] leading-tight break-all font-mono ${res.type === 'error' ? 'text-rose-500' : 'text-emerald-700/70'}`}>
                    {isSystemMetric ? (
                       <pre className="bg-black/5 p-2 rounded border border-black/5 overflow-x-auto scrollbar-none max-h-40 text-[10px]">
                         {res.content}
                       </pre>
                    ) : (
                       res.content
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
