import { useState } from 'react';
import { useAgentStore } from '../../../stores/agentStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { collapseRepeats, type TapeRow } from './tape-utils';

/** Format epoch-ms or ISO string to HH:MM in Ukrainian locale. */
function fmtTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/** Truncate a string to at most maxLen chars. */
function trunc(s: string, maxLen = 24): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}

export function Tape() {
  const recentActions = useAgentStore((s) => s.recentActions);
  const reflections = useAgentStore((s) => s.reflections);
  const observations = useAgentStore((s) => s.observations);

  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Build raw TapeRow list from each source —————————————————————————————

  const actionRows: TapeRow[] = recentActions.map((step) => ({
    id: `action-${step.step_idx}`,
    kind: 'action' as const,
    ts: step.ts,
    step_idx: step.step_idx,
    action: step.action,
    label: trunc(step.action, 32),
  }));

  const reflectionRows: TapeRow[] = reflections.map((ref, idx) => ({
    id: `reflection-${idx}`,
    kind: 'reflection' as const,
    ts: Date.now() - (reflections.length - 1 - idx) * 1000,
    step_idx: null,
    verdict: ref.verdict,
    label: trunc(ref.verdict || 'reflection', 32),
  }));

  const observationRows: TapeRow[] = observations.map((obs) => ({
    id: `observation-${obs.step_idx}-${obs.type}`,
    kind: 'observation' as const,
    ts: obs.ts,
    step_idx: obs.step_idx,
    label: trunc(`${obs.type}: ${obs.source}`, 32),
  }));

  const allRows: TapeRow[] = [...actionRows, ...reflectionRows, ...observationRows].sort((a, b) => {
    const ta = typeof a.ts === 'number' ? a.ts : new Date(a.ts).getTime();
    const tb = typeof b.ts === 'number' ? b.ts : new Date(b.ts).getTime();
    return ta - tb;
  });

  const collapsed = collapseRepeats(allRows);

  if (isPro) {
    return (
      <div
        data-testid="tape"
        className="flex-1 flex flex-col bg-black border border-white/5 p-2 overflow-hidden font-mono text-[10px]"
      >
        <div className="flex items-center justify-between border-b border-white/5 pb-1 mb-1 px-1 shrink-0">
          <span className="text-neutral-500 font-bold uppercase tracking-widest">[ACTIVITY_LOG]</span>
          <span className="text-[8px] text-green-500 animate-pulse">STREAMING</span>
        </div>
        
        <div className="flex-1 overflow-y-auto scrollbar-none">
          {collapsed.length === 0 ? (
            <div className="py-8 text-center text-neutral-800 italic uppercase tracking-tighter">Empty execution tape...</div>
          ) : (
            <div className="flex flex-col">
              {collapsed.slice().reverse().map((row) => (
                <div 
                  key={row.id}
                  className="flex items-start gap-2 py-1 border-b border-white/[0.03] last:border-none group"
                >
                  <span className="text-neutral-700 tabular shrink-0">{fmtTime(row.ts)}</span>
                  <span className={`uppercase font-bold shrink-0 ${row.kind === 'reflection' ? 'text-amber-500/80' : row.kind === 'observation' ? 'text-blue-500/80' : 'text-neutral-500'}`}>
                     [{row.kind.slice(0,3)}]
                  </span>
                  <span className="text-neutral-300 truncate group-hover:text-white transition-colors">
                    {row.verdict ?? row.action ?? row.label ?? '—'}
                  </span>
                  {row.repeats != null && row.repeats > 1 && (
                    <span className="text-cyan-500 font-bold ml-auto shrink-0">x{row.repeats}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="tape"
      className={`flex-1 flex flex-col overflow-hidden ${isPro ? 'bg-black border border-white/5 p-2' : 'rounded-[24px] glass shadow-2xl'}`}
      style={isPro ? {} : {
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(30px)',
        border: '1px solid rgba(255, 255, 255, 0.4)',
      }}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="micro-label" style={{ color: 'var(--ink-muted)' }}>ACTIVITY_TAPE</span>
        <span className="text-[9px] font-mono opacity-40 uppercase tracking-widest">Live</span>
      </div>
      
      {collapsed.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 opacity-20">
          <div className="w-1 h-8 bg-black/20 rounded-full animate-pulse" />
          <span className="text-[9px] font-mono text-ink-muted text-center mt-2 uppercase tracking-widest">
            Idle
          </span>
        </div>
      ) : (
        <ul className="flex flex-col gap-1 list-none m-0 p-0">
          {collapsed.map((row) => {
            const isExpanded = expandedId === row.id;
            const hasRepeats = (row.repeats ?? 1) > 1;

            return (
              <li key={row.id}>
                <button
                  className="w-full flex items-center gap-3 text-left px-2 py-1.5 rounded-lg hover:bg-black/5 transition-all active:scale-[0.98]"
                  onClick={() => {
                    if (hasRepeats) {
                      setExpandedId(isExpanded ? null : row.id);
                    }
                  }}
                  aria-expanded={hasRepeats ? isExpanded : undefined}
                >
                  <time
                    className="text-[10px] font-mono text-ink-muted opacity-60 flex-shrink-0"
                    dateTime={typeof row.ts === 'string' ? row.ts : new Date(row.ts).toISOString()}
                  >
                    {fmtTime(row.ts)}
                  </time>
                  <span className={`text-[10px] font-mono truncate flex-1 min-w-0 ${row.kind === 'reflection' ? 'text-primary' : 'text-ink-primary'}`}>
                    {row.verdict ?? row.action ?? row.label ?? '—'}
                  </span>
                  {hasRepeats && (
                    <span className="text-[9px] font-bold text-primary bg-primary/10 rounded-full px-1.5 flex-shrink-0">
                      {`↻${row.repeats}`}
                    </span>
                  )}
                </button>

                {isExpanded && hasRepeats && (
                  <ul className="ml-4 mt-1 flex flex-col gap-1 list-none p-0 border-l border-black/10 pl-3">
                    {Array.from({ length: Math.min(row.repeats ?? 1, 5) }).map((_, i) => (
                      <li
                        key={i}
                        className="text-[9px] font-mono text-ink-muted opacity-70 truncate"
                      >
                        {fmtTime(row.ts)} · {row.verdict ?? row.action ?? row.label ?? '—'}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
