/** ПОЛІС — операційний зал. Одна поверхня, три синхронні зони:
 * місії зліва · розмова/документи/граф/світ у центрі · воркери справа.
 * Місія — це чат; документи народжуються на очах; кожного воркера
 * видно наживо. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MessageSquareText,
  FileText,
  Workflow,
  ListChecks,
  Users,
  Building2,
} from 'lucide-react';
import { usePolisStore, registerPolisWsHandler, type RoomTab } from '../stores/polisStore';
import { wsClient } from '../services/websocket';
import { CityCanvas } from '../components/polis/CityCanvas';
import { MissionRail } from '../components/polis/room/MissionRail';
import { ConversationPanel } from '../components/polis/room/ConversationPanel';
import { DocumentsPanel } from '../components/polis/room/DocumentsPanel';
import { WorkersRail, WorkerInspector } from '../components/polis/room/WorkersRail';
import { MissionFocus } from '../components/polis/MissionFocus';
import { GraphCanvas } from '../components/polis/room/GraphCanvas';
import { CitizensGallery } from '../components/polis/room/CitizensGallery';
import { NewMissionSheet } from '../components/polis/NewMissionSheet';
import { domainToken } from '../components/polis/theme';

const TABS: { id: RoomTab; label: string; Icon: typeof FileText }[] = [
  { id: 'talk', label: 'Розмова', Icon: MessageSquareText },
  { id: 'docs', label: 'Документи', Icon: FileText },
  { id: 'graph', label: 'Граф', Icon: Workflow },
  { id: 'plan', label: 'План', Icon: ListChecks },
  { id: 'citizens', label: 'Населення', Icon: Users },
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

function MissionControlBar() {
  const mission = usePolisStore((s) =>
    s.missions.find((m) => m.id === s.selectedMissionId),
  );
  const pause = usePolisStore((s) => s.pauseMission);
  const resume = usePolisStore((s) => s.resumeMission);
  const kill = usePolisStore((s) => s.killMission);
  if (!mission) return null;
  const pressure = mission.budget.max_tokens
    ? Math.round((mission.budget.spent_tokens / mission.budget.max_tokens) * 100)
    : 0;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ borderBottom: '1px solid var(--glass-border)' }}
    >
      <span className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
        {Math.round(mission.progress * 100)}% · {mission.budget.spent_llm_calls}/
        {mission.budget.max_llm_calls} викл. · бюджет {pressure}%
      </span>
      <div className="flex-1" />
      {mission.status === 'running' && (
        <button
          onClick={() => void pause(mission.id)}
          className="min-h-[44px] px-4 rounded-lg active:scale-[0.97]"
          style={{ background: 'color-mix(in srgb, var(--primary) 18%, transparent)', color: 'var(--primary)', fontSize: 'var(--fs-xs)' }}
        >
          Пауза
        </button>
      )}
      {mission.status === 'paused' && (
        <button
          onClick={() => void resume(mission.id)}
          className="min-h-[44px] px-4 rounded-lg active:scale-[0.97]"
          style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}
        >
          Продовжити
        </button>
      )}
      {!['done', 'killed', 'failed'].includes(mission.status) && (
        <button
          onClick={() => void kill(mission.id)}
          className="min-h-[44px] px-4 rounded-lg active:scale-[0.97]"
          style={{ background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)', color: 'var(--signal-alert)', fontSize: 'var(--fs-xs)' }}
        >
          Зупинити
        </button>
      )}
    </div>
  );
}

export default function PolisLayout() {
  const hydrate = usePolisStore((s) => s.hydrate);
  const roomTab = usePolisStore((s) => s.roomTab);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);
  const selectedMissionId = usePolisStore((s) => s.selectedMissionId);
  const selectMission = usePolisStore((s) => s.selectMission);
  const missions = usePolisStore((s) => s.missions);
  const docsCount = usePolisStore((s) =>
    s.selectedMissionId ? (s.artifacts[s.selectedMissionId] ?? []).length : 0,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void hydrate();
    const off = registerPolisWsHandler((ch, cb) =>
      wsClient.on(ch as 'polis', cb as never),
    );
    const poll = window.setInterval(() => void hydrate(), 20_000);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, [hydrate]);

  useEffect(() => {
    if (!selectedMissionId && missions.length > 0) {
      selectMission(missions[0].id);
    }
  }, [selectedMissionId, missions, selectMission]);

  const mission = missions.find((m) => m.id === selectedMissionId);

  const chip = mission ? STATUS_CHIP[mission.status] ?? STATUS_CHIP.planning : null;
  const domainTint = mission ? domainToken(mission.domain) : 'var(--accent)';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative overflow-hidden flex gap-3 p-3"
      data-testid="polis-layout"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* signature sunrise wash + soft amber glows beneath everything */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{ background: 'var(--surface-sunrise)', opacity: 0.9 }} />
        <div
          className="absolute rounded-full animate-pulse-slow"
          style={{ top: '-20%', left: '-8%', width: '45%', height: '70%', filter: 'blur(120px)', background: 'var(--glow-warm)', opacity: 0.6 }}
        />
        <div
          className="absolute rounded-full animate-pulse-slow"
          style={{ bottom: '-25%', right: '-6%', width: '42%', height: '65%', filter: 'blur(120px)', background: 'var(--glow-primary)', opacity: 0.45, animationDelay: '2s' }}
        />
      </div>

      <div className="w-[236px] shrink-0 h-full relative" style={{ zIndex: 1 }}>
        <MissionRail onNewMission={() => setSheetOpen(true)} />
      </div>

      <main
        className="flex-1 min-w-0 h-full glass-card rounded-3xl flex flex-col overflow-hidden relative"
        style={{ zIndex: 1 }}
      >
        <header
          className="flex items-center gap-2 px-3.5 h-[54px] shrink-0"
          style={{ borderBottom: '1px solid var(--glass-border)' }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: domainTint, boxShadow: `0 0 10px ${domainTint}` }}
          />
          <h1
            className="font-semibold truncate min-w-0 flex-1"
            style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-primary)' }}
            title={mission?.title}
          >
            {mission ? mission.title : 'ПОЛІС'}
          </h1>
          {chip && (
            <span
              className="shrink-0 w-2 h-2 rounded-full"
              style={{ background: chip.tint, boxShadow: `0 0 8px ${chip.tint}` }}
              title={chip.label}
            />
          )}
          <nav
            role="tablist"
            aria-label="зони місії"
            className="flex items-center gap-0 shrink-0 p-0.5 rounded-xl"
            style={{ background: 'var(--glass-subtle)' }}
          >
            {TABS.map((t) => {
              const active = roomTab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setRoomTab(t.id)}
                  className="relative w-[44px] h-[44px] rounded-lg flex items-center justify-center active:scale-[0.94] transition-all"
                  style={{
                    color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                    background: active ? 'var(--accent)' : 'transparent',
                    boxShadow: active ? 'var(--shadow-glow)' : 'none',
                  }}
                  title={t.label}
                  aria-label={t.label}
                  data-testid={`room-tab-${t.id}`}
                >
                  <t.Icon size={16} strokeWidth={active ? 2.4 : 1.9} />
                  {t.id === 'docs' && docsCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center font-bold"
                      style={{ fontSize: 9, background: 'var(--primary)', color: 'var(--ink-inverse)' }}
                    >
                      {docsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        <MissionControlBar />

        <div className="flex-1 min-h-0" role="tabpanel">
          {roomTab === 'talk' && <ConversationPanel />}
          {roomTab === 'docs' && <DocumentsPanel />}
          {roomTab === 'graph' && <GraphCanvas />}
          {roomTab === 'plan' && <MissionFocus />}
          {roomTab === 'citizens' && <CitizensGallery />}
          {roomTab === 'world' && <CityCanvas />}
        </div>
      </main>

      <div className="w-[264px] shrink-0 h-full relative" style={{ zIndex: 1 }}>
        <WorkersRail />
      </div>

      <WorkerInspector />
      <NewMissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </motion.div>
  );
}
