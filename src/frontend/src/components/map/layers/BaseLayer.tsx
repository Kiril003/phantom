import { useEffect } from 'react';
import { useMapInstance } from '../MapContext';
import { getMapTokens, buildPhantomStyle, preserveOverlayLayers } from '../mapTokens';
import { useSystemStore } from '../../../stores/systemStore';

/**
 * BaseLayer — re-renders the dark base style whenever the SystemState changes,
 * so accent-driven background stays in sync with state transitions.
 */
export function BaseLayer() {
  const { map, ready } = useMapInstance();
  const systemState = useSystemStore((s) => s.state);

  useEffect(() => {
    if (!map || !ready) return;

    try {
      const tokens = getMapTokens();
      // `transformStyle` carries ReconLayer/HeatmapLayer/GeofencesLayer's
      // runtime-added sources/layers forward — without it they'd be torn
      // down every time SystemState changes (see mapTokens.ts).
      map.setStyle(buildPhantomStyle(tokens), { diff: true, transformStyle: preserveOverlayLayers });
    } catch {
      /* map not ready yet */
    }
  }, [map, ready, systemState]);

  return null;
}
