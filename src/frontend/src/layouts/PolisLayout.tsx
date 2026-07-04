/** ПОЛІС — операційний зал. Одна поверхня, три синхронні зони:
 * місії зліва · розмова/документи/граф/світ у центрі · воркери справа.
 * Місія — це чат; документи народжуються на очах; кожного воркера
 * видно наживо. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePolisStore, registerPolisWsHandler, type RoomTab } from '../stores/polisStore';
import { wsClient } from '../services/websocket';
import { CityCanvas } from '../components/polis/CityCanvas';
import { MissionRail } from '../components/polis/room/MissionRail';
import { ConversationPanel } from '../components/polis/room/ConversationPanel';
import { DocumentsPanel } from '../components/polis/room/DocumentsPanel';
import { WorkersRail, WorkerInspector } from '../components/polis/room/WorkersRail';
import { MissionFocus } from '../components/polis/MissionFocus';
import { NewMissionSheet } from '../components/polis/NewMissionSheet';

const TABS: { id: RoomTab; label: string }[] = [
  { id: 'talk', label: 'Розмова' },
  { id: 'docs', label: 'Документи' },
  { id: 'graph', label: 'Граф' },
  { id: 'world', label: 'Світ' },
];

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative overflow-hidden flex gap-3 p-3"
      data-testid="polis-layout"
    >
      <div className="w-[236px] shrink-0 h-full">
        <MissionRail onNewMission={() => setSheetOpen(true)} />
      </div>

      <main className="flex-1 min-w-0 h-full glass-panel rounded-2xl flex flex-col overflow-hidden">
        <header
          className="flex items-center gap-1 px-3 pt-2 pb-0"
          style={{ borderBottom: '1px solid var(--glass-border)' }}
        >
          <span
            className="text-gradient font-medium mr-2"
            style={{ fontSize: 'var(--fs-md)' }}
          >
            {mission ? mission.title : 'ПОЛІС'}
          </span>
          <div className="flex-1" />
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setRoomTab(t.id)}
              className="min-h-[44px] px-3 font-mono uppercase active:scale-[0.97]"
              style={{
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-widest)',
                color: roomTab === t.id ? 'var(--accent)' : 'var(--ink-muted)',
                borderBottom:
                  roomTab === t.id
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
              }}
              data-testid={`room-tab-${t.id}`}
            >
              {t.label}
              {t.id === 'docs' && docsCount > 0 ? ` ${docsCount}` : ''}
            </button>
          ))}
        </header>

        <div className="flex-1 min-h-0">
          {roomTab === 'talk' && <ConversationPanel />}
          {roomTab === 'docs' && <DocumentsPanel />}
          {roomTab === 'graph' && <MissionFocus />}
          {roomTab === 'world' && <CityCanvas />}
        </div>
      </main>

      <div className="w-[264px] shrink-0 h-full">
        <WorkersRail />
      </div>

      <WorkerInspector />
      <NewMissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </motion.div>
  );
}
