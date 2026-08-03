import { useEffect, useRef } from 'react';
import { useMapInstance } from '../MapContext';
import { getMapTokens, preserveOverlayLayers } from '../mapTokens';
import { buildPhantomMapStyle } from '../phantomStyle';
import { useSystemStore } from '../../../stores/systemStore';

/**
 * Базовий шар — перебудовує стиль, коли змінюється стан системи, щоб мапа
 * жила в тій самій палітрі, що й решта інтерфейсу.
 *
 * Тут ховалась причина, чому власний стиль не з'являвся на екрані: цей
 * компонент монтується ПІСЛЯ конструктора мапи і ставив чужий URL
 * (`buildPhantomStyle`) поверх нашого. Тобто рельєф і об'ємні будівлі
 * будувались і за мить затирались, і мапа лишалась чужою.
 */
export function BaseLayer() {
  const { map, ready } = useMapInstance();
  const systemState = useSystemStore((s) => s.state);
  const seenState = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !ready) return;
    // Конструктор уже поставив наш стиль. Перший прогін тут ставив його
    // вдруге — MapLibre обривав щойно запущені запити тайлів і сипав
    // AbortError у консоль. Реагуємо лише на СПРАВЖНЮ зміну стану.
    if (seenState.current === null) {
      seenState.current = systemState;
      return;
    }
    if (seenState.current === systemState) return;
    seenState.current = systemState;

    try {
      const tokens = getMapTokens();
      const c = map.getCenter();
      // `transformStyle` carries ReconLayer/HeatmapLayer/GeofencesLayer's
      // runtime-added sources/layers forward — without it they'd be torn
      // down every time SystemState changes (see mapTokens.ts).
      map.setStyle(buildPhantomMapStyle(tokens, { center: [c.lng, c.lat] }), {
        diff: true,
        transformStyle: preserveOverlayLayers,
      });
      // Рельєф повертає утримувач у TacticalMap на події `styledata` —
      // тут його вмикати марно, стиль ще не осів.
    } catch {
      /* map not ready yet */
    }
  }, [map, ready, systemState]);

  return null;
}
