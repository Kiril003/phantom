/** ПОЛІС — three zoom levels of one truth:
 * СВІТ (living canvas city) ⇄ ШТАБ (command deck) ⇄ Фокус (one mission). */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolisStore, registerPolisWsHandler } from '../stores/polisStore';
import { wsClient } from '../services/websocket';
import { CityCanvas } from '../components/polis/CityCanvas';
import { StaffDeck } from '../components/polis/StaffDeck';
import { MissionFocus } from '../components/polis/MissionFocus';
import { NewMissionSheet } from '../components/polis/NewMissionSheet';

export default function PolisLayout() {
  const view = usePolisStore((s) => s.view);
  const setView = usePolisStore((s) => s.setView);
  const hydrate = usePolisStore((s) => s.hydrate);
  const gates = usePolisStore((s) => s.gates);
  const missions = usePolisStore((s) => s.missions);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void hydrate();
    const off = registerPolisWsHandler((ch, cb) =>
      wsClient.on(ch as 'polis', cb as never),
    );
    const poll = window.setInterval(() => void hydrate(), 15_000);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, [hydrate]);

  const activeCount = missions.filter(
    (m) => !['done', 'killed', 'failed'].includes(m.status),
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative overflow-hidden"
      data-testid="polis-layout"
    >
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-5 pt-3">
        <h1
          className="text-gradient font-medium"
          style={{ fontSize: 'var(--fs-md)', letterSpacing: 'var(--tracking-wide)' }}
        >
          ПОЛІС
        </h1>
        <span className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
          {activeCount} активних місій
        </span>
        <div className="flex-1" />
        {view !== 'focus' && (
          <div
            className="flex rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--glass-border)' }}
          >
            {(['world', 'staff'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="min-h-[44px] px-4 font-mono uppercase active:scale-[0.97]"
                style={{
                  fontSize: 'var(--fs-micro)',
                  letterSpacing: 'var(--tracking-widest)',
                  background: view === v ? 'var(--glass-card)' : 'transparent',
                  color: view === v ? 'var(--accent)' : 'var(--ink-muted)',
                }}
                data-testid={`polis-view-${v}`}
              >
                {v === 'world' ? 'Світ' : 'Штаб'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setSheetOpen(true)}
          className="min-h-[44px] min-w-[44px] px-4 rounded-xl font-medium active:scale-[0.97]"
          style={{ background: 'var(--accent)', color: 'var(--ink-inverse)', fontSize: 'var(--fs-sm)' }}
          data-testid="polis-new-mission"
        >
          + Місія
        </button>
      </header>

      {gates.length > 0 && view === 'world' && (
        <button
          onClick={() => setView('staff')}
          className="absolute top-[60px] left-1/2 -translate-x-1/2 z-20 glass-card rounded-full px-4 py-2 flex items-center gap-2 active:scale-[0.97]"
          style={{ border: '1px solid rgba(244,175,37,0.4)' }}
          data-testid="polis-bell-banner"
        >
          <span className="w-2 h-2 rounded-full animate-ping" style={{ background: '#f4af25' }} />
          <span style={{ fontSize: 'var(--fs-xs)', color: '#f4af25' }}>
            дзвін Ратуші: {gates.length} рішення чекає
          </span>
        </button>
      )}

      <div className="absolute inset-0 pt-[56px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, scale: view === 'focus' ? 1.03 : 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full"
          >
            {view === 'world' && <CityCanvas />}
            {view === 'staff' && <StaffDeck />}
            {view === 'focus' && <MissionFocus />}
          </motion.div>
        </AnimatePresence>
      </div>

      <NewMissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </motion.div>
  );
}
