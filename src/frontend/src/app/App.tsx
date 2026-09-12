import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Providers } from './providers';
import { StateTransitionController } from './StateTransitionController';
import { ViewportFrame } from './ViewportFrame';
import { ErrorBoundary } from '../components/core/ErrorBoundary';
import { Overlays } from '../components/core/Overlays';
import { VoiceAlwaysOnGate } from '../components/chat/VoiceAlwaysOnGate';
import { SystemState } from '@shared/types';
import { useSystemStore } from '../stores/systemStore';
import { geolocationService, BrowserGeolocationService } from '../services/geolocation';
import { ToolsOverlay } from '../components/tools/ToolsOverlay';
// Lazy: WillPanel statically pulls recharts (~170 kB gz). It's mounted at
// App root but only rendered when willOpen — lazy keeps the charts vendor
// chunk out of the initial load.
const WillPanel = React.lazy(() =>
  import('../components/agent/workspace/WillPanel').then((m) => ({ default: m.WillPanel })),
);
import { IntelligenceHub } from '../components/intelligence/IntelligenceHub';
import { useUIStore } from '../stores/uiStore';
import { useFamiliarTriggers } from '../hooks/useFamiliarTriggers';
import { useAuthStore } from '../stores/authStore';
import { FamiliarReactor } from '../components/familiar/FamiliarReactor';
// Lazy: PhantomFamiliar is the ONLY consumer of three.js/@react-three at
// App root — eager-importing it pulled the whole 3D stack (~600 kB) into
// the entry chunk. Lazy + Suspense(null) defers it to an async chunk so
// first paint never pays for the familiar.
const PhantomFamiliar = React.lazy(() => import('../components/familiar/PhantomFamiliar'));
import { ToastRail } from '../components/core/ToastRail';
import { PhantomIcon } from '../components/core/PhantomIcon';
import { DeskSurface } from '../components/desk/DeskSurface';
import { useDeskStore } from '../stores/deskStore';

function GlobalGeolocationManager() {
  const authenticated = useSystemStore((s) => s.authenticated);

  useEffect(() => {
    if (authenticated && BrowserGeolocationService.isSupported()) {
      geolocationService.start();
    }
    return () => {
      geolocationService.stop();
    };
  }, [authenticated]);

  return null;
}

/* ─── Lazy layouts ────────────────────────────────────────────────────────── */

const ShadowLayout = React.lazy(() => import('../layouts/ShadowLayout'));
const LoginScreen = React.lazy(() => import('../components/auth/LoginScreen'));
const CoreDownWall = React.lazy(() =>
  import('../components/auth/LoginScreen').then((m) => ({ default: m.CoreDownWall })),
);
const SunriseWorkspace = React.lazy(() => import('../layouts/SunriseWorkspace'));
const AgentFoundryLayout = React.lazy(() => import('../layouts/AgentFoundryLayout'));

// Злиття 29.08: месенджер приїхав окремою гілкою, де він володів «/» і «*».
// Тут «/» належить активному столу. 12.09 він переїхав із власного шляху в
// пейн `messenger` на столі «Розмови» — бо шлях без дороги не є дорогою:
// по всьому src рядок «/messenger» згадувався двічі, і обидва рази це було
// читання `location.pathname`, а не перехід. Поверхню вантажить
// paneRegistry.
const DashboardLayout = React.lazy(() => import('../layouts/DashboardLayout'));
const GhostLayout = React.lazy(() => import('../layouts/GhostLayout'));
const DreamLayout = React.lazy(() => import('../layouts/DreamLayout'));
const DialogueLayout = React.lazy(() => import('../layouts/DialogueLayout'));
const FocusLayout = React.lazy(() => import('../layouts/FocusLayout'));
const SentinelLayout = React.lazy(() => import('../layouts/SentinelLayout'));


// «/» належить станові, а не одному екрану. Кнопки дока (Головна, Діалог,
// Фокус, Вартовий, Привид) міняють SystemState і йдуть сюди — поки тут
// висів дашборд, стан мінявся, а екран лишався той самий, і кнопки
// виглядали мертвими.
// OPERATOR — не кнопка, а стан: ядро саме входить у нього, коли стартує
// передній план агента (agent/kernel/runtime.py:738 і :878 шлють transition
// у WS). Кейса тут не було, тож стан приходив, плашка ставала «Оператор», а
// під нею лишалась головна. Веде на ту саму майстерню, що й /operator.
export function StateSurface() {
  const state = useSystemStore((s) => s.state);
  switch (state) {
    case SystemState.DIALOGUE:
      return <DialogueLayout />;
    case SystemState.FOCUS:
      return <FocusLayout />;
    case SystemState.SENTINEL:
      return <SentinelLayout />;
    case SystemState.GHOST:
      return <GhostLayout />;
    case SystemState.DREAM:
      return <DreamLayout />;
    case SystemState.OPERATOR:
      return <AgentFoundryLayout />;
    default:
      return <ShadowLayout />;
  }
}

/**
 * «/» = активний стіл (Ф1). SystemState-режими не зламані: DIALOGUE і
 * OPERATOR діють УСЕРЕДИНІ відповідного пейна, якщо він є на активному
 * столі (Діалог на Театрі/Кокпіті, Компанія на Компанії); стани без
 * пейн-відповідника (FOCUS/SENTINEL/GHOST/DREAM) — тимчасово поверх.
 * Сама машина станів неушкоджена: переходи приходять з ядра по WS.
 */
const STATE_PANE: Partial<Record<SystemState, 'dialogue' | 'company'>> = {
  [SystemState.DIALOGUE]: 'dialogue',
  [SystemState.OPERATOR]: 'company',
};

/**
 * Редирект старого шляху в стіл/пейн (К4): активує стіл і/або відкриває
 * пейн вільним вікном, далі веде на «/». Старі закладки й внутрішні
 * navigate('/map' тощо) не ламаються — вони ведуть у ту саму поверхню,
 * що тепер живе пейном.
 */
function GoDesk({ desk, float }: { desk?: string; float?: 'settings' | 'messenger' }) {
  const setActiveDesk = useDeskStore((s) => s.setActiveDesk);
  const openPane = useDeskStore((s) => s.openPane);
  useEffect(() => {
    if (desk) setActiveDesk(desk);
    if (float) openPane(float);
    // Одноразово на вході в маршрут: це редирект, не підписка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Navigate to="/" replace />;
}

export function DeskIndex() {
  const state = useSystemStore((s) => s.state);
  const desks = useDeskStore((s) => s.desks);
  const activeDeskId = useDeskStore((s) => s.activeDeskId);
  const desk = desks.find((d) => d.id === activeDeskId) ?? desks[0];

  const paneKind = STATE_PANE[state];
  const stateLivesInPane = paneKind !== undefined && desk.panes.some((p) => p.kind === paneKind);
  const overlay = state !== SystemState.SHADOW && !stateLivesInPane;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <DeskSurface />
      {overlay && (
        <div
          className="absolute inset-0 overflow-hidden"
          // zIndex обов'язковий, і це не смак. Без нього «Режим Привид»
          // НЕ гасив екрана: DialogueLayout усередині пейна має власні
          // z-10/z-2, жоден предок пейна не творить контексту накладання,
          // тож ці шари конкурували з оверлеєм у корені й вигравали —
          // чат, поле вводу й банер помилки лишались читомими поверх
          // «чорного» Привида. Вище за повноекранний пейн (60 + z).
          style={{ background: 'var(--ph-color-ground)', zIndex: 100 }}
        >
          <StateSurface />
        </div>
      )}
    </div>
  );
}

/**
 * Двері для зняття кадрів — і чому вони структурно не можуть поїхати в реліз.
 *
 * Столи, мапа і смуга організму живуть за замком. Це правильно: замок і є
 * те, що продукт обіцяє (29.08 я прибрав обхід, який впускав як ROOT без
 * ПІНу від самої лише адреси). Але тоді ніхто, крім власника, не може
 * зняти стіл на склі — а «доведено на склі» у нас єдина форма доказу.
 *
 * Тому: `?desk=1` показує оболонку БЕЗ входу, і лише в збірці розробника.
 *
 * Чому це не діра:
 *   • `import.meta.env.DEV` — не прапорець рантайму, а константа, яку
 *     складальник підставляє на етапі збірки. У прод-бандлі гілка стає
 *     `if (false)` і **вирізається** — коду просто немає, вмикати нічого;
 *   • це НЕ автовхід: токена не з'являється, `authenticated` лишається
 *     false, жоден захищений виклик не пройде. Видно рівно те, що вміє
 *     намалювати сам інтерфейс;
 *   • сторож `test_dev_desk_door_cannot_reach_release` червоніє, якщо
 *     умову зробити досяжною в релізі.
 *
 * Зразок узято з телефона, де `phantom://screen/<маршрут>` так само
 * мертвий у релізі першим рядком `BuildConfig.DEBUG`.
 */
function devDeskDoorOpen(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('desk');
}

function MainRouter() {
  const { authenticated } = useSystemStore();
  const sessionPhase = useAuthStore((s) => s.sessionPhase);

  if (!authenticated && !devDeskDoorOpen()) {
    // Поки токен перевіряється, екран входу показувати не можна: власник
    // нікуди не виходив, а форма блимала йому в обличчя щоразу на старті.
    if (sessionPhase === 'checking') return <PhantomLoader />;
    return (
      <React.Suspense fallback={<PhantomLoader />}>
        {sessionPhase === 'unreachable' ? <CoreDownWall /> : <LoginScreen />}
      </React.Suspense>
    );
  }

  return (
    <React.Suspense fallback={<PhantomLoader />}>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<DeskIndex />} />
            {/* К4: старі шляхи ведуть у відповідний стіл/пейн. */}
            <Route path="map" element={<GoDesk desk="theatre" />} />
            <Route path="chat" element={<GoDesk desk="theatre" />} />
            {/* Месенджер живе столом «Розмови» (deskStore пресет `talks`).
                Шлях лишається дійсним для закладок і зовнішніх посилань —
                він веде в той самий стіл, а не у другу копію поверхні. */}
            <Route path="messenger" element={<GoDesk desk="talks" />} />
            <Route path="analytics" element={<GoDesk desk="cockpit" />} />
            <Route path="operator" element={<GoDesk desk="company" />} />
            <Route path="foundry" element={<GoDesk desk="company" />} />
            <Route path="settings/:categoryId?" element={<GoDesk float="settings" />} />
            {/* Поліс редиректу не має: власної пейн-долі ще не отримав. */}
            <Route path="polis" element={<SunriseWorkspace />} />
            {/* Зомбі-шляхи — на стіл. */}
            <Route path="system" element={<Navigate to="/" replace />} />
            <Route path="sentinel" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AnimatePresence>
    </React.Suspense>
  );
}

/**
 * Заставка на час, поки ядро не озвалось. Тут крутився сірий обідок і напис
 * «PHANTOM OS» — і висів так само і півсекунди, і півхвилини, ніяк не
 * зізнаючись, що щось не так. Тепер підпис іде за прожитим часом: це не
 * вигаданий поступ, а чесна відповідь на питання «скільки вже?».
 */
function PhantomLoader() {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const line =
    elapsed < 3 ? 'Прокидаюсь…' : elapsed < 8 ? 'Піднімаю ядро…' : 'Ядро відповідає поволі';

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="flex flex-col items-center">
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            background:
              'radial-gradient(circle at 34% 30%, #fff8dc 0%, #fde9b8 22%, #f4af25 62%, #e08a1a 94%)',
            boxShadow: '0 0 34px rgba(244,175,37,0.42)',
            animation: 'orb-breathe 2.6s ease-in-out infinite',
          }}
        />
        <span
          className="micro-label"
          style={{ marginTop: 20, color: 'var(--primary-deep)', letterSpacing: '0.28em' }}
        >
          PHANTOM
        </span>
        <span style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-muted)' }}>{line}</span>
        {elapsed >= 8 && (
          <span
            style={{
              marginTop: 6,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--ink-muted)',
              maxWidth: 300,
              textAlign: 'center',
            }}
          >
            Це буває на першому старті після ввімкнення. Якщо триватиме довго —
            служба на пристрої не піднялась.
          </span>
        )}
      </div>
    </div>
  );
}

function GlobalAlwaysOnGate() {
  const authenticated = useSystemStore((s) => s.authenticated);
  if (!authenticated) return null;
  return <VoiceAlwaysOnGate />;
}

function FamiliarTriggers() {
  useFamiliarTriggers();
  return null;
}

function AutoLoginManager() {
  const autoLogin = useAuthStore((s) => s.autoLogin);
  useEffect(() => {
    void autoLogin();
  }, [autoLogin]);
  return null;
}

/* ─── App Root ────────────────────────────────────────────────────────────── */

export function App() {
  return (
    <Providers>
      <AutoLoginManager />
      <BrowserRouter>
        <StateTransitionController />
        <GlobalAlwaysOnGate />
        <GlobalGeolocationManager />
        <ViewportFrame>
          <ErrorBoundary>
          <div
            className="w-full h-full min-h-screen overflow-hidden relative flex"
            style={{ background: 'var(--surface-base)' }}
          >
            <MainRouter />
            <Overlays />
            <ToastRail />
            <FamiliarTriggers />
            <FamiliarReactor />
            <React.Suspense fallback={null}>
              <PhantomFamiliar />
            </React.Suspense>
            <ToolsOverlayMount />
            <WillPanelMount />
            <IntelligenceHubMount />
          </div>
          </ErrorBoundary>
        </ViewportFrame>
      </BrowserRouter>
    </Providers>
  );
}

function WillPanelMount() {
  const open = useUIStore((s) => s.willOpen);
  const setOpen = useUIStore((s) => s.setWillOpen);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 100 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="absolute right-4 top-[84px] bottom-[84px] w-[360px] z-[100]"
        >
          <React.Suspense fallback={null}>
            <WillPanel />
          </React.Suspense>
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 p-2 hover:bg-black/5 rounded-full transition-colors z-10"
          >
            <PhantomIcon name="close" className="text-ink-muted" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToolsOverlayMount() {
  const open = useUIStore((s) => s.toolsOverlayOpen);
  const setOpen = useUIStore((s) => s.setToolsOverlayOpen);
  const initialTab = useUIStore((s) => s.toolsInitialTab);
  return (
    <ToolsOverlay
      open={open}
      initialTab={initialTab}
      onClose={() => setOpen(false)}
    />
  );
}

function IntelligenceHubMount() {
  const open = useUIStore((s) => s.intelligenceHubOpen);
  const setOpen = useUIStore((s) => s.setIntelligenceHubOpen);
  return <IntelligenceHub isOpen={open} onClose={() => setOpen(false)} />;
}
