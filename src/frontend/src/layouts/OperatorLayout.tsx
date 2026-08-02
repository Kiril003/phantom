import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { AmbientGlows } from '../components/core/AmbientGlows';
import { MissionMounts } from '../components/mission/MissionMounts';
import { SafetyShieldToggle } from '../components/agent/hud/SafetyShieldToggle';
import { AgentCommandCenter } from '../components/agent/hud/AgentCommandCenter';
import { AgentVault } from '../components/agent/overlays/AgentVault';
import { ParallelChatDrawer } from '../components/agent/overlays/ParallelChatDrawer';
import { AgentRoster } from '../components/agent/overlays/AgentRoster';
import { FocusPanel } from '../components/agent/workspace/FocusPanel';
import { CouncilStage } from '../components/agent/overlays/CouncilStage';
import { InfoNeedDialog } from '../components/agent/overlays/InfoNeedDialog';
import { PlanEditor } from '../components/agent/workspace/PlanEditor';

import { useAgentStream } from '../hooks/useAgentStream';
import { useAgentStore } from '../stores/agentStore';
import { useUIStore } from '../stores/uiStore';
import { useSystemStore } from '../stores/systemStore';
import { useSettingsStore } from '../stores/settingsStore';
import { MorphologyEngine, type SystemState as MorphologyState } from '../services/MorphologyEngine';

import { Orb } from '../components/core/Orb';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { TenantBadge } from '../components/saas/TenantBadge';

function VitalsHeaderStrip() {
  const substate = useAgentStore((s) => s.substate);
  const emotion = useAgentStore((s) => s.emotion);
  const unsafeMode = useAgentStore((s) => s.unsafeMode);

  const mood = useMemo(() => {
    if (!emotion) return 'СТАБІЛЬНИЙ';
    if (emotion.concern > 0.7) return 'УВАЖНИЙ';
    if (emotion.fatigue > 0.8) return 'ВТОМЛЕНИЙ';
    if (emotion.focus > 0.8) return 'ПОТІК';
    return 'СТАБІЛЬНИЙ';
  }, [emotion]);

  const formatSubstate = (state?: string) => {
    switch (state?.toUpperCase()) {
      case 'SHADOW':
        return 'ТІНЬ';
      case 'FOCUS':
        return 'ФОКУС';
      case 'DIALOGUE':
        return 'ДІАЛОГ';
      case 'IDLE':
        return 'ОЧІКУВАННЯ';
      case 'CREATIVE':
        return 'ТВОРЧІСТЬ';
      default:
        return state || 'ОЧІКУВАННЯ';
    }
  };

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 rounded-full bg-black/10 border border-white/5 shadow-inner">
       <TenantBadge />
       <div className="flex flex-col border-l border-white/10 pl-3">
          <span className="text-[7px] text-neutral-500 uppercase font-bold tracking-widest leading-none mb-0.5">Стан розуму</span>
          <span className="text-[10px] font-bold uppercase leading-none" style={{ color: 'var(--primary-shadow)' }}>{formatSubstate(substate)}</span>
       </div>
       <div className="flex flex-col">
          <span className="text-[7px] text-neutral-500 uppercase font-bold tracking-widest leading-none mb-0.5">Емпатія</span>
          <span className="text-[10px] text-ink-primary font-medium uppercase leading-none">{mood}</span>
       </div>
       <div className="flex items-center gap-2 border-l border-white/10 pl-3">
          {unsafeMode ? <ShieldAlert size={12} className="text-red-500" /> : <ShieldCheck size={12} className="text-green-500" />}
          <span className="text-[9px] font-mono font-bold" style={{ color: 'var(--ink-secondary)' }}>{unsafeMode ? 'БЕЗ ОБМЕЖЕНЬ' : 'ЗАХИЩЕНО'}</span>
       </div>
    </div>
  );
}

/**
 * OperatorLayout v4 (2026-05-15) — SUNRISE PREMIUM
 *
 * Sunrise Dashboard Composition:
 *   - Top: StatusBar (44px)
 *   - Top-Sub: AgentRoster (integrated strip)
 *   - Workspace (12-col grid):
 *     - [9 cols]: FocusPanel (Monologue + Activity Stream) + Background ORB
 *     - [3 cols]: Tape (Activity Log)
 *   - Bottom: AgentCommandCenter + FloatingToolbar
 */

export default function OperatorLayout() {
  useAgentStream();

  const substate = useAgentStore((s) => s.substate);
  const currentInfoNeed = useAgentStore((s) => s.currentInfoNeed);
  const infoNeedBusy = useAgentStore((s) => s.infoNeedBusy);
  const respondToInfoNeed = useAgentStore((s) => s.respondToInfoNeed);
  const dismissInfoNeed = useAgentStore((s) => s.dismissInfoNeed);
  const councilActive = useAgentStore((s) => s.councilActive);
  const councilSituationKind = useAgentStore((s) => s.councilSituationKind);
  const councilSituationSummary = useAgentStore((s) => s.councilSituationSummary);
  const councilStatements = useAgentStore((s) => s.councilStatements);
  const councilDecision = useAgentStore((s) => s.councilDecision);
  const dismissCouncil = useAgentStore((s) => s.dismissCouncil);
  const currentTask = useAgentStore((s) => s.currentTask);
  const subGoals = useAgentStore((s) => s.subGoals);

  const agentHistoryOpen = useUIStore((s) => s.agentHistoryOpen);
  const setAgentHistoryOpen = useUIStore((s) => s.setAgentHistoryOpen);
  const setMissionBriefOpen = useUIStore((s) => s.setMissionBriefOpen);
  const setMissionBriefObjective = useUIStore((s) => s.setMissionBriefObjective);

  const systemState = useSystemStore((s) => s.state);
  const sentience = useSystemStore((s) => s.sentience);

  const morphology = useMemo(
    () => MorphologyEngine.getProfile(systemState as MorphologyState, sentience.cortisol),
    [systemState, sentience.cortisol],
  );

  const currentTheme = useSettingsStore((s) => s.getActiveTheme());
  const isPro = currentTheme === 'pro-console';

  const [chatOpen, setChatOpen] = useState(false);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);

  useEffect(() => {
    document.body.setAttribute('data-substate', substate);
    return () => document.body.removeAttribute('data-substate');
  }, [substate]);

  return (
    <motion.div
      className={`w-full h-full min-w-[1024px] min-h-[600px] flex flex-col relative overflow-hidden ${isPro ? 'bg-black font-mono' : 'bg-surface-sunrise'}`}
      style={{ opacity: morphology.opacity }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      data-testid="operator-layout"
    >
      {!isPro && <AmbientGlows />}
      
      {/* ─── HEADER (44px + 52px = 96px total) ──────────────────────────────── */}
      <header className="shrink-0 z-30 flex flex-col">
        <div className="flex items-center justify-between pr-4 bg-black/5 backdrop-blur-md border-b border-white/5">
           {!isPro && <VitalsHeaderStrip />}
        </div>
        
        <div className="h-[52px] flex items-center justify-center bg-white/5 backdrop-blur-sm border-b border-black/5">
           {/* scale-90 стискав 44-піксельні чипи до 40 — тач-ціль ламалась
               саме через обгортку, а не через самі кнопки. */}
           <AgentRoster />
        </div>
      </header>

      {/* ─── MAIN WORKSPACE (FULL WIDTH) ────────────────────────────────────── */}
      <main className="flex-1 flex flex-col px-3 pt-2 pb-0 min-h-0 z-10 overflow-hidden">
        <motion.section
          className="flex-1 min-h-0 flex flex-col relative"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          {!isPro && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5 z-0">
              <Orb size="xl" className="scale-125" />
            </div>
          )}
          <div className="flex-1 min-h-0 z-10">
            <FocusPanel />
          </div>
        </motion.section>
      </main>

      {/* ─── FOOTER & OVERLAYS (UNIFIED) ────────────────────────────────────── */}
      {/* mb — щоб командний центр не ліз під глобальний док знизу */}
      <footer className="shrink-0 h-[64px] mb-[96px] relative z-40 px-6 flex items-center justify-center">
        {/* Center: Floating Command Center — Balanced width */}
        <div className="pointer-events-auto">
           <AgentCommandCenter
             onOpenParallelChat={() => setChatOpen(true)}
             onOpenPlanEditor={() => setPlanEditorOpen(true)}
             onStartMission={(obj) => {
               setMissionBriefObjective(obj);
               setMissionBriefOpen(true);
             }}
           />
        </div>

        {/* Safe Right: Global Toolbar — Anchored on the right to avoid edge issues */}
        {!isPro && (
          <div className="absolute right-6 bottom-4 pointer-events-auto z-50">
          </div>
        )}
      </footer>

      {/* Safety Shield — Top Right Overlay */}
      {!isPro && (
        <div className="absolute top-[52px] right-4 z-[60]">
           <SafetyShieldToggle />
        </div>
      )}

      {/* Overlays */}
      <ParallelChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <AgentVault isOpen={agentHistoryOpen} onClose={() => setAgentHistoryOpen(false)} />
      <MissionMounts />

      {currentInfoNeed && (
        <InfoNeedDialog
          infoNeed={currentInfoNeed}
          busy={infoNeedBusy}
          onSubmit={(answer) => respondToInfoNeed(answer)}
          onCancel={currentInfoNeed.required ? undefined : () => dismissInfoNeed()}
        />
      )}

      {planEditorOpen && currentTask && (
        <PlanEditor
          open={planEditorOpen}
          taskId={currentTask.task.id}
          initialSubGoals={subGoals}
          onClose={() => setPlanEditorOpen(false)}
        />
      )}

      {councilActive && (
        <CouncilStage
          open={councilActive}
          situationKind={councilSituationKind}
          summary={councilSituationSummary}
          statements={councilStatements}
          decision={councilDecision}
          onClose={dismissCouncil}
        />
      )}
    </motion.div>
  );
}


