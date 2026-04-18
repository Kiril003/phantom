import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Providers } from './providers';
import { StateTransitionController } from './StateTransitionController';
import { ViewportFrame } from './ViewportFrame';
import { Overlays } from '../components/core/Overlays';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

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

/* ─── App Root ────────────────────────────────────────────────────────────── */

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <StateTransitionController />
        <ViewportFrame>
          <div
            className="w-[1024px] h-[600px] overflow-hidden relative"
            style={{ background: 'var(--surface-void)' }}
          >
            <Routes>
              <Route
                path="/settings"
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
          </div>
        </ViewportFrame>
      </BrowserRouter>
    </Providers>
  );
}
