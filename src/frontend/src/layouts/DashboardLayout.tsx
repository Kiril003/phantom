import { Outlet } from 'react-router-dom';
import { StatusBar } from '../components/core/StatusBar';
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
      {/* Стрічка організму (агент f1-command-organism): поки файла нема —
          рендериться null. Бюджет хрому з нею вирішується коммітом
          інтеграції, коли вона приїде. */}
      <OrganismStripMount />
      <StatusBar />
      {/* Хром стола: StatusBar 44px + смуга столів 28px = 72px ≤ 76px.
          Старий док (FloatingToolbar) у новому шляху НЕ монтується —
          вердикт власника: «багато знизу кнопок — погано»; входи станів
          чекають дизайн-дебату, навігація — за Ctrl+K (К4). Файл дока не
          чіпаємо: вирок мертвому коду — окрема робота. */}
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
