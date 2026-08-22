import { Outlet } from 'react-router-dom';
import { DeskStrip } from '../components/desk/DeskStrip';
import { CommandBarMount, OrganismStripMount } from '../components/desk/IntegrationMounts';
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
      style={{ background: 'var(--ph-color-ground)', color: 'var(--ph-color-ink)' }}
    >
      {/* Стрічка організму (30px) — заміна StatusBar на столі (вердикт:
          слово стану живе в ній). Хром: 30 + смуга столів 28 = 58 ≤ 76.
          StatusBar і док (FloatingToolbar) у новому шляху НЕ монтуються —
          файли не чіпаємо: вирок мертвому коду — окрема робота. */}
      <OrganismStripMount />
      <main className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto no-scrollbar">
          <Outlet />
        </div>
      </main>
      <DeskStrip />
      {/* Командний рядок (Ctrl+K) — глобально в оболонці; null до приїзду. */}
      <CommandBarMount />
    </div>
  );
}
