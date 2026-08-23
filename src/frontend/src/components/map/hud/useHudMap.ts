import { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Живий інстанс MapLibre для HUD-компонентів.
 *
 * HudShell стоїть ПОРУЧ із TacticalMap, а не всередині нього, тому
 * MapContext.Provider (обгортає лише шари рушія) сюди не дістає.
 * Канонічний міст той самий, яким уже користується OmniMap для
 * bearing: TacticalMap безумовно публікує інстанс у
 * `window.__phantom.map` (TacticalMap.tsx, блок одразу після
 * конструктора мапи).
 *
 * Опитування, а не одноразовий rAF: мапа може з'явитися пізніше за
 * HUD (повільний стиль, retry після збою) і може бути перестворена
 * (retryNonce у TacticalMap) — тоді старий інстанс мертвий і його
 * треба відпустити.
 */
export function useHudMap(): MapLibreMap | null {
  const [map, setMap] = useState<MapLibreMap | null>(() => {
    if (typeof window === 'undefined') return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((window as any).__phantom?.map as MapLibreMap | undefined) ?? null;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = ((window as any).__phantom?.map as MapLibreMap | undefined) ?? null;
      setMap((prev) => (prev === current ? prev : current));
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return map;
}
