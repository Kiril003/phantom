/** ПОЛІС — операційний зал.
 *
 * Розділ організований навколо ЖИТТЯ ЗАВДАННЯ, а не навколо типів об'єктів:
 * наказ → хід → те, що з нього вийшло. Тому розмова й план не вкладки, а
 * сусіди: ти пишеш «додай крок безпеки» і одразу бачиш, де він з'явився.
 *
 * Два рівні навігації. Верхній (робота / населення / ключі / світ) — це «де я»,
 * і він більше не краде місійний ряд. Нижній — яка саме місія. */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, Users, KeyRound, Building2, X, Pause, Play, Square } from 'lucide-react';
import { usePolisStore, registerPolisWsHandler, normalizeTab, type RoomTab } from '../stores/polisStore';
import { useUIStore } from '../stores/uiStore';
import { wsClient } from '../services/websocket';
import { WorldView } from '../components/polis/world/WorldView';
import { MissionRail } from '../components/polis/room/MissionRail';
import { ThreadPanel } from '../components/polis/room/ThreadPanel';
import { PlanRail } from '../components/polis/room/PlanRail';
import { DocumentsPanel } from '../components/polis/room/DocumentsPanel';
import { KeysPanel } from '../components/polis/room/KeysPanel';
import { CitizensGallery } from '../components/polis/room/CitizensGallery';
import { NewMissionSheet } from '../components/polis/NewMissionSheet';
import { domainToken } from '../components/polis/theme';
import { missionVitals, humanMinutes } from '../components/polis/room/missionView';
import { AgentCommandCenter } from '../components/agent/hud/AgentCommandCenter';
import { AgentVault } from '../components/agent/overlays/AgentVault';
import { Orb } from '../components/core/Orb';
import { ParallelChatDrawer } from '../components/agent/overlays/ParallelChatDrawer';
import { PlanEditor } from '../components/agent/workspace/PlanEditor';
import { useAgentStore } from '../stores/agentStore';

const SECTIONS: { id: RoomTab; label: string; Icon: typeof Users }[] = [
  { id: 'work', label: 'Робота', Icon: LayoutGrid },
  { id: 'citizens', label: 'Населення', Icon: Users },
  { id: 'keys', label: 'Ключі', Icon: KeyRound },
  { id: 'world', label: 'Світ', Icon: Building2 },
];

const STATUS_CHIP: Record<string, { label: string; tint: string }> = {
  planning: { label: 'планування', tint: 'var(--ink-muted)' },
  running: { label: 'у роботі', tint: 'var(--signal-ok)' },
  paused: { label: 'пауза', tint: 'var(--primary)' },
  awaiting_gate: { label: 'чекає тебе', tint: 'var(--primary)' },
  done: { label: 'готово', tint: 'var(--signal-ok)' },
  failed: { label: 'зрив', tint: 'var(--signal-alert)' },
  killed: { label: 'зупинено', tint: 'var(--ink-faint)' },
};

/** Статус пишемо лише тоді, коли він вимагає дії: «у роботі» вже видно
 * зі смуги поступу, а місце у шапці коштує назви місії. */
const ACTIONABLE = new Set(['awaiting_gate', 'paused', 'failed', 'killed']);

/** Шапка місії: усе, що треба знати, не клікаючи нікуди.
 * Місця тут рівно на 448 px, тому кожен елемент має заслужити своє — інакше
 * він з'їдає назву місії, а вона головна. */
function MissionHeader() {
  const mission = usePolisStore((s) => s.missions.find((m) => m.id === s.selectedMissionId));
  const artifacts = usePolisStore((s) =>
    s.selectedMissionId ? (s.artifacts[s.selectedMissionId] ?? []) : [],
  );
  const pause = usePolisStore((s) => s.pauseMission);
  const resume = usePolisStore((s) => s.resumeMission);
  const kill = usePolisStore((s) => s.killMission);

  const vitals = missionVitals(mission, artifacts, Date.now());
  const chip = mission ? (STATUS_CHIP[mission.status] ?? STATUS_CHIP.planning) : null;
  const tint = mission ? domainToken(mission.domain) : 'var(--accent)';

  if (!mission || !vitals) {
    return (
      <header
        className="shrink-0 flex items-center px-4 h-[44px]"
        style={{ borderBottom: '1px solid var(--glass-border)' }}
      >
        <span style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-primary)' }}>ПОЛІС</span>
      </header>
    );
  }

  // керування — значками: два підписи забирали 120 px і не лишали місця назві
  const btn = (label: string, Icon: typeof Pause, onClick: () => void, colour: string) => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-[32px] h-[32px] rounded-lg flex items-center justify-center active:scale-[0.95] shrink-0"
      style={{ background: `color-mix(in srgb, ${colour} 16%, transparent)`, color: colour }}
    >
      <Icon size={14} strokeWidth={2.2} />
    </button>
  );

  return (
    <header
      className="shrink-0 flex items-center gap-2.5 px-3.5 h-[44px]"
      style={{ borderBottom: '1px solid var(--glass-border)' }}
      data-testid="mission-header"
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: tint, boxShadow: `0 0 10px ${tint}` }}
      />
      <h1
        className="font-semibold truncate flex-1 min-w-0"
        style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-primary)' }}
        title={mission.title}
      >
        {mission.title}
      </h1>
      {/* смуга поступу — єдине місце, де видно рух місії цілком */}
      <div
        className="w-[68px] h-[3px] rounded-full shrink-0 overflow-hidden"
        style={{ background: 'var(--glass-subtle)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(vitals.progress * 100)}%`, background: tint }}
        />
      </div>

      {/* Тільки те, що міняє рішення. Решта — у підказці: на 448 px повний
          рядок стискав назву місії до однієї літери. */}
      <span
        className="font-mono shrink-0"
        style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
        title={`${vitals.running} у роботі · ${vitals.spentCalls}/${vitals.maxCalls} викликів · іде ${humanMinutes(vitals.elapsed)}`}
      >
        бюджет {Math.round(vitals.pressure * 100)}%
      </span>
      {chip && ACTIONABLE.has(mission.status) && (
        <span className="font-mono shrink-0" style={{ fontSize: 'var(--fs-micro)', color: chip.tint }}>
          {chip.label}
        </span>
      )}

      {mission.status === 'running' && btn('Пауза', Pause, () => void pause(mission.id), 'var(--primary)')}
      {mission.status === 'paused' && btn('Продовжити', Play, () => void resume(mission.id), 'var(--accent)')}
      {!['done', 'killed', 'failed'].includes(mission.status) &&
        btn('Зупинити', Square, () => void kill(mission.id), 'var(--signal-alert)')}
    </header>
  );
}

export default function SunriseWorkspace() {
  const currentTask = useAgentStore((s) => s.currentTask);
  const subGoals = useAgentStore((s) => s.subGoals);
  const hydrate = usePolisStore((s) => s.hydrate);
  const roomTab = usePolisStore((s) => normalizeTab(s.roomTab));
  const setRoomTab = usePolisStore((s) => s.setRoomTab);
  const selectedMissionId = usePolisStore((s) => s.selectedMissionId);
  const selectMission = usePolisStore((s) => s.selectMission);
  const missions = usePolisStore((s) => s.missions);
  const gates = usePolisStore((s) => s.gates);
  const keys = usePolisStore((s) => s.keys);
  const openDoc = usePolisStore((s) => s.openDoc);
  const closeArtifact = usePolisStore((s) => s.closeArtifact);

  const agentHistoryOpen = useUIStore((s) => s.agentHistoryOpen);
  const setAgentHistoryOpen = useUIStore((s) => s.setAgentHistoryOpen);
  const setMissionBriefOpen = useUIStore((s) => s.setMissionBriefOpen);
  const setMissionBriefObjective = useUIStore((s) => s.setMissionBriefObjective);

  const [chatOpen, setChatOpen] = useState(false);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  // наведення живе тут, бо зшиває дві колонки: хід і план
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
    const off = registerPolisWsHandler((ch, cb) => wsClient.on(ch as 'polis', cb as never));
    const poll = window.setInterval(() => void hydrate(), 20_000);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, [hydrate]);

  useEffect(() => {
    if (!selectedMissionId && missions.length > 0) selectMission(missions[0].id);
  }, [selectedMissionId, missions, selectMission]);

  const showDocs = docsOpen || !!openDoc;
  const closeDocs = () => {
    if (openDoc) closeArtifact();
    else setDocsOpen(false);
  };

  // значок на розділі: скільки чекає рішення, скільки ключів лежить
  const badge: Partial<Record<RoomTab, number>> = {
    work: gates.length,
    keys: keys.filter((k) => k.state === 'exhausted' || k.state === 'invalid').length,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative overflow-hidden flex gap-2.5 p-2.5 pb-[92px]"
      data-testid="polis-layout"
      style={{ background: 'var(--surface-base)' }}
    >
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{ background: 'var(--surface-sunrise)', opacity: 0.9 }} />
        <Orb size="xl" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10 scale-[1.5]" />
        <div
          className="absolute rounded-full animate-pulse-slow"
          style={{ top: '-20%', left: '-8%', width: '45%', height: '70%', filter: 'blur(120px)', background: 'var(--glow-warm)', opacity: 0.6 }}
        />
        <div
          className="absolute rounded-full animate-pulse-slow"
          style={{ bottom: '-25%', right: '-6%', width: '42%', height: '65%', filter: 'blur(120px)', background: 'var(--glow-primary)', opacity: 0.45, animationDelay: '2s' }}
        />
      </div>

      {/* ліва колонка: де я + які місії */}
      <div className="w-[198px] shrink-0 h-full flex flex-col gap-2.5 relative" style={{ zIndex: 1 }}>
        <nav
          className="shrink-0 glass-card rounded-2xl flex items-center gap-0.5 p-1"
          role="tablist"
          aria-label="розділи"
        >
          {SECTIONS.map((s) => {
            const active = roomTab === s.id;
            const n = badge[s.id] ?? 0;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                onClick={() => setRoomTab(s.id)}
                className="relative flex-1 h-[42px] rounded-xl flex items-center justify-center active:scale-[0.94]"
                style={{
                  color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                  background: active ? 'var(--accent)' : 'transparent',
                  boxShadow: active ? 'var(--shadow-glow)' : 'none',
                }}
                title={s.label}
                aria-label={s.label}
                data-testid={`section-${s.id}`}
              >
                <s.Icon size={16} strokeWidth={active ? 2.4 : 1.9} />
                {n > 0 && !active && (
                  <span
                    className="absolute top-1 right-1.5 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center font-bold"
                    style={{ fontSize: 9, background: 'var(--primary)', color: 'var(--ink-inverse)' }}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="flex-1 min-h-0">
          <MissionRail onNewMission={() => setSheetOpen(true)} />
        </div>
      </div>

      {/* робоча поверхня */}
      {roomTab === 'work' ? (
        <>
          <main
            className="flex-1 min-w-0 h-full glass-card rounded-3xl flex flex-col overflow-hidden relative"
            style={{ zIndex: 1 }}
          >
            <MissionHeader />
            <div className="flex-1 min-h-0">
              <ThreadPanel hoverNode={hoverNode} onHoverNode={setHoverNode} />
            </div>

            <AnimatePresence>
              {showDocs && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ background: 'var(--glass-elevated)', backdropFilter: 'blur(20px)', zIndex: 5 }}
                  data-testid="materials-overlay"
                >
                  <div className="absolute top-2 right-2" style={{ zIndex: 6 }}>
                    <button
                      onClick={closeDocs}
                      className="w-[36px] h-[36px] rounded-xl flex items-center justify-center active:scale-[0.95]"
                      style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)' }}
                      aria-label="закрити матеріали"
                      data-testid="close-materials"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <DocumentsPanel />
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <div className="w-[326px] shrink-0 h-full relative" style={{ zIndex: 1 }}>
            <PlanRail hoverNode={hoverNode} onHoverNode={setHoverNode} onDocs={() => setDocsOpen(true)} />
          </div>
        </>
      ) : (
        <main
          className="flex-1 min-w-0 h-full glass-card rounded-3xl flex flex-col overflow-hidden relative"
          style={{ zIndex: 1 }}
        >
          {roomTab === 'citizens' && <CitizensGallery />}
          {roomTab === 'keys' && <KeysPanel />}
          {roomTab === 'world' && <WorldView />}
        </main>
      )}

      <footer className="absolute bottom-6 left-0 right-0 z-40 px-6 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-4xl">
           <AgentCommandCenter
             onOpenParallelChat={() => setChatOpen(!chatOpen)}
             onOpenPlanEditor={() => setPlanEditorOpen(!planEditorOpen)}
             onStartMission={(obj) => {
               setMissionBriefObjective(obj);
               setMissionBriefOpen(true);
             }}
           />
        </div>
      </footer>

      <NewMissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <AgentVault isOpen={agentHistoryOpen} onClose={() => setAgentHistoryOpen(false)} />
      <ParallelChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      {planEditorOpen && currentTask && (
        <PlanEditor
          open={planEditorOpen}
          taskId={currentTask.task.id}
          initialSubGoals={subGoals}
          onClose={() => setPlanEditorOpen(false)}
        />
      )}
    </motion.div>
  );
}
