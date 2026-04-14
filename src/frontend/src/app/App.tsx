import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Providers } from './providers';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

/* ─── Lazy layouts ────────────────────────────────────────────────────────── */
// Layouts are loaded lazily to keep initial bundle small
const ShadowLayout = React.lazy(() => import('../layouts/ShadowLayout'));
const FocusLayout = React.lazy(() => import('../layouts/FocusLayout'));
const DialogueLayout = React.lazy(() => import('../layouts/DialogueLayout'));
const SentinelLayout = React.lazy(() => import('../layouts/SentinelLayout'));
const GhostLayout = React.lazy(() => import('../layouts/GhostLayout'));
const DreamLayout = React.lazy(() => import('../layouts/DreamLayout'));
const LoginScreen = React.lazy(() => import('../components/auth/LoginScreen'));
const SettingsPanel = React.lazy(() => import('../components/settings/SettingsPanel'));

/* ─── State → Layout routing ─────────────────────────────────────────────── */

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

  const Layout = {
    [SystemState.SHADOW]: ShadowLayout,
    [SystemState.FOCUS]: FocusLayout,
    [SystemState.DIALOGUE]: DialogueLayout,
    [SystemState.SENTINEL]: SentinelLayout,
    [SystemState.GHOST]: GhostLayout,
    [SystemState.DREAM]: DreamLayout,
  }[state];

  return (
    <React.Suspense fallback={<PhantomLoader />}>
      <Layout />
    </React.Suspense>
  );
}

function PhantomLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-phantom-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-phantom-cyan border-t-transparent rounded-full animate-spin" />
        <span className="text-phantom-text-dim text-xs tracking-widest">PHANTOM OS</span>
      </div>
    </div>
  );
}

/* ─── App Root ────────────────────────────────────────────────────────────── */

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <div className="w-[1024px] h-[600px] overflow-hidden relative bg-phantom-bg">
          <Routes>
            <Route path="/settings" element={
              <React.Suspense fallback={<PhantomLoader />}>
                <SettingsPanel />
              </React.Suspense>
            } />
            <Route path="/*" element={<StateRouter />} />
          </Routes>
        </div>
      </BrowserRouter>
    </Providers>
  );
}
