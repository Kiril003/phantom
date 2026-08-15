import { Outlet } from 'react-router-dom';
import { StatusBar } from '../components/core/StatusBar';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { useMapOpenNavigator } from '../hooks/useMapOpenNavigator';

export default function DashboardLayout() {
  // Every in-app route (/, /map, /chat, /settings, ...) is a child route
  // rendered inside this layout, so this is alive no matter which screen
  // is showing — the one place `map.open_map` can actually be received
  // outside of the map screen itself. See useMapOpenNavigator.ts.
  useMapOpenNavigator();
  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden font-sans"
      style={{ background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
    >
      <StatusBar />
      {/* Без pb-24: екрани на h-full і так тримають власний відступ під док
          (bottom: 76). Подвійний резерв забирав ~96px висоти і обрізав
          налаштування на 600-піксельному дисплеї. */}
      <main className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto no-scrollbar">
          <Outlet />
        </div>
      </main>
      <FloatingToolbar />
    </div>
  );
}
