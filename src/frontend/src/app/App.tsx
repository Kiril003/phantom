import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Providers } from './providers';
import { StateTransitionController } from './StateTransitionController';
import { ViewportFrame } from './ViewportFrame';
import { ErrorBoundary } from '../components/core/ErrorBoundary';
import { Overlays } from '../components/core/Overlays';
import { useSystemStore } from '../stores/systemStore';
import { useAuthStore } from '../stores/authStore';
import { ToastRail } from '../components/core/ToastRail';

/* ─── Lazy views ─────────────────────────────────────────────────────────── */

const QuickJoinScreen = React.lazy(() => import('../components/auth/QuickJoinScreen'));
const MessengerLayout = React.lazy(() => import('../layouts/MessengerLayout'));

export function StateSurface() {
  return <MessengerLayout />;
}

function MainRouter() {
  const { authenticated } = useSystemStore();
  const sessionPhase = useAuthStore((s) => s.sessionPhase);

  if (!authenticated) {
    if (sessionPhase === 'checking') return <PhantomLoader />;
    return (
      <React.Suspense fallback={<PhantomLoader />}>
        <QuickJoinScreen />
      </React.Suspense>
    );
  }

  return (
    <React.Suspense fallback={<PhantomLoader />}>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<MessengerLayout />} />
          <Route path="/messenger" element={<MessengerLayout />} />
          <Route path="/chat" element={<MessengerLayout />} />
          <Route path="*" element={<MessengerLayout />} />
        </Routes>
      </AnimatePresence>
    </React.Suspense>
  );
}

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
        <ViewportFrame>
          <ErrorBoundary>
            <div
              className="w-full h-full min-h-screen overflow-hidden relative flex flex-col"
              style={{ background: 'var(--surface-base)' }}
            >
              <MainRouter />
              <Overlays />
              <ToastRail />
            </div>
          </ErrorBoundary>
        </ViewportFrame>
      </BrowserRouter>
    </Providers>
  );
}
