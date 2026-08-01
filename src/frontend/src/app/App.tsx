import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { EndocrineVisualizer } from '../components/EndocrineVisualizer';
import { useEndocrineStore } from '../stores/endocrineStore';

function GlobalEndocrineTheme() {
  const { cortisol, oxytocin } = useEndocrineStore();
  
  useEffect(() => {
    // Modify CSS custom properties based on Endocrine levels
    // High Cortisol: Increases contrast, lowers saturation, turns accent red
    // High Oxytocin: Warms the accent color, increases bloom/glow
    
    // Example map: 
    // Default Accent is an Amber or Blue. Let's shift hue and saturation.
    const root = document.documentElement;
    
    // Cortisol shifts to alert red (0deg) and reduces rounding (harsh)
    // Oxytocin shifts to gold/warm (40deg) and adds soft glow
    
    if (cortisol > 0.3) {
      root.style.setProperty('--accent', `hsl(0, 80%, ${50 + cortisol * 20}%)`);
      root.style.setProperty('--surface-raised', `rgba(255, 0, 0, ${cortisol * 0.1})`);
    } else {
      // Normal / Oxytocin state
      root.style.setProperty('--accent', `hsl(35, ${70 + oxytocin * 30}%, ${50 + oxytocin * 10}%)`);
      root.style.setProperty('--surface-raised', `rgba(255, 200, 100, ${oxytocin * 0.05})`);
    }
  }, [cortisol, oxytocin]);

  return null;
}

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
const AnalyticsOverview = React.lazy(() => import('../pages/Dashboard/AnalyticsOverview'));
const LoginScreen = React.lazy(() => import('../components/auth/LoginScreen'));
const SettingsPanel = React.lazy(() => import('../components/settings/SettingsPanel'));
const MapLayout = React.lazy(() => import('../layouts/MapLayout'));
const PolisLayout = React.lazy(() => import('../layouts/PolisLayout'));
const CreateWorkspace = React.lazy(() => import('../pages/Onboarding/CreateWorkspace'));

const DashboardLayout = React.lazy(() => import('../layouts/DashboardLayout'));
const GhostLayout = React.lazy(() => import('../layouts/GhostLayout'));
const DreamLayout = React.lazy(() => import('../layouts/DreamLayout'));
const DialogueLayout = React.lazy(() => import('../layouts/DialogueLayout'));
const OperatorLayout = React.lazy(() => import('../layouts/OperatorLayout'));
const FocusLayout = React.lazy(() => import('../layouts/FocusLayout'));
const SentinelLayout = React.lazy(() => import('../layouts/SentinelLayout'));


// «/» належить станові, а не одному екрану. Кнопки дока (Головна, Діалог,
// Фокус, Вартовий, Привид) міняють SystemState і йдуть сюди — поки тут
// висів дашборд, стан мінявся, а екран лишався той самий, і кнопки
// виглядали мертвими.
function StateSurface() {
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
    default:
      return <ShadowLayout />;
  }
}

function MainRouter() {
  const { authenticated } = useSystemStore();

  if (!authenticated) {
    return (
      <React.Suspense fallback={<PhantomLoader />}>
        <LoginScreen />
      </React.Suspense>
    );
  }

  return (
    <React.Suspense fallback={<PhantomLoader />}>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/onboarding" element={<CreateWorkspace />} />
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<StateSurface />} />
            <Route path="analytics" element={<AnalyticsOverview />} />
            <Route path="map" element={<MapLayout />} />
            <Route path="polis" element={<PolisLayout />} />
            <Route path="chat" element={<DialogueLayout />} />
            <Route path="operator" element={<OperatorLayout />} />
            <Route path="system" element={<FocusLayout />} />
            <Route path="sentinel" element={<SentinelLayout />} />
            <Route path="settings/:categoryId?" element={<SettingsPanel />} />
            <Route path="*" element={<ShadowLayout />} />
          </Route>
        </Routes>
      </AnimatePresence>
    </React.Suspense>
  );
}

function PhantomLoader() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span
          className="tracking-widest font-mono"
          style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}
        >
          PHANTOM OS
        </span>
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
        <GlobalEndocrineTheme />
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
            <div className="fixed bottom-4 right-4 z-[200] pointer-events-none">
              <EndocrineVisualizer />
            </div>
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
