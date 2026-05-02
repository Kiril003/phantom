import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Providers } from './providers';
import { StateTransitionController } from './StateTransitionController';
import { ViewportFrame } from './ViewportFrame';
import { Overlays } from '../components/core/Overlays';
import { VoiceAlwaysOnGate } from '../components/chat/VoiceAlwaysOnGate';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';
import { geolocationService, BrowserGeolocationService } from '../services/geolocation';
import { ToolsOverlay } from '../components/tools/ToolsOverlay';
import { AgentSessionHistory } from '../components/agent/AgentSessionHistory';
import { AgentVisionPanel } from '../components/agent/AgentVisionPanel';
import { AgentStudioOverlay } from '../components/studio/AgentStudioOverlay';
import { useUIStore } from '../stores/uiStore';
import { useFamiliarTriggers } from '../hooks/useFamiliarTriggers';
import { useAuthStore } from '../stores/authStore';

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
  console.log('PHANTOM OS: App rendering');
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
              <Route path="/*" element={<StateRouter />} />
            </Routes>
            <Overlays />
            <FamiliarTriggers />
            {/* <PhantomFamiliar /> */}
            <ToolsOverlayMount />
            <AgentSessionHistoryMount />
            <StudioOverlayMount />
            <AgentVisionMount />
          </div>
        </ViewportFrame>
      </BrowserRouter>
    </Providers>
  );
}

function StudioOverlayMount() {
  const open = useUIStore((s) => s.studioOpen);
  const setOpen = useUIStore((s) => s.setStudioOpen);
  return <AgentStudioOverlay open={open} onClose={() => setOpen(false)} />;
}

function AgentVisionMount() {
  const open = useUIStore((s) => s.visionOpen);
  const setOpen = useUIStore((s) => s.setVisionOpen);
  return <AgentVisionPanel open={open} onClose={() => setOpen(false)} />;
}

function ToolsOverlayMount() {
  const open = useUIStore((s) => s.toolsOverlayOpen);
  const setOpen = useUIStore((s) => s.setToolsOverlayOpen);
  return <ToolsOverlay open={open} onClose={() => setOpen(false)} />;
}

function AgentSessionHistoryMount() {
  const open = useUIStore((s) => s.agentHistoryOpen);
  const setOpen = useUIStore((s) => s.setAgentHistoryOpen);
  const setSystemState = useSystemStore((s) => s.setState);
  return (
    <AgentSessionHistory
      open={open}
      onClose={() => setOpen(false)}
      onContinueAsConversation={() => {
        setSystemState(SystemState.DIALOGUE, {
          trigger: 'agent_resume_as_conversation',
          timestamp: Date.now(),
          auto: false,
        });
      }}
    />
  );
}
