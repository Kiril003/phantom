import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Providers } from './providers';
import { StateTransitionController } from './StateTransitionController';
import { ViewportFrame } from './ViewportFrame';
import { Overlays } from '../components/core/Overlays';
import { VoiceAlwaysOnGate } from '../components/chat/VoiceAlwaysOnGate';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';
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
const FocusLayout = React.lazy(() => import('../layouts/FocusLayout'));
const DialogueLayout = React.lazy(() => import('../layouts/DialogueLayout'));
const SentinelLayout = React.lazy(() => import('../layouts/SentinelLayout'));
const GhostLayout = React.lazy(() => import('../layouts/GhostLayout'));
const DreamLayout = React.lazy(() => import('../layouts/DreamLayout'));
const OperatorLayout = React.lazy(() => import('../layouts/OperatorLayout'));
const LoginScreen = React.lazy(() => import('../components/auth/LoginScreen'));
const SettingsPanel = React.lazy(() => import('../components/settings/SettingsPanel'));
const MapLayout = React.lazy(() => import('../layouts/MapLayout'));
const PolisLayout = React.lazy(() => import('../layouts/PolisLayout'));

/* ─── State → Layout routing ─────────────────────────────────────────────── */

const LAYOUT_MAP: Record<SystemState, React.LazyExoticComponent<() => React.JSX.Element>> = {
  [SystemState.SHADOW]: ShadowLayout,
  [SystemState.FOCUS]: FocusLayout,
  [SystemState.DIALOGUE]: DialogueLayout,
  [SystemState.SENTINEL]: SentinelLayout,
  [SystemState.GHOST]: GhostLayout,
  [SystemState.DREAM]: DreamLayout,
  [SystemState.OPERATOR]: OperatorLayout,
};

function StateRouter() {
  const { state, authenticated } = useSystemStore();

  useEffect(() => {
    document.body.setAttribute('data-state', state);
  }, [state]);

  if (!authenticated) {
    return (
      <React.Suspense fallback={<PhantomLoader />}>
        <LoginScreen />
      </React.Suspense>
    );
  }

  const Layout = LAYOUT_MAP[state];

  return (
    <React.Suspense fallback={<PhantomLoader />}>
      <AnimatePresence mode="wait">
        <Layout key={state} />
      </AnimatePresence>
    </React.Suspense>
  );
}

function PhantomLoader() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'var(--surface-void)' }}
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
        <ViewportFrame>
          <div
            className="w-[1024px] h-[600px] overflow-hidden relative"
            style={{ background: 'var(--surface-void)' }}
          >
            <Routes>
              <Route
                path="/settings/:categoryId?"
                element={
                  <React.Suspense fallback={<PhantomLoader />}>
                    <SettingsPanel />
                  </React.Suspense>
                }
              />
              <Route
                path="/map"
                element={
                  <React.Suspense fallback={<PhantomLoader />}>
                    <MapLayout />
                  </React.Suspense>
                }
              />
              <Route
                path="/polis"
                element={
                  <React.Suspense fallback={<PhantomLoader />}>
                    <PolisLayout />
                  </React.Suspense>
                }
              />
              <Route path="/*" element={<StateRouter />} />
            </Routes>
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
            <span className="msym text-ink-muted">close</span>
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
