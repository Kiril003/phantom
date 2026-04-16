import { useEffect } from 'react';
import { useMapInstance } from '../MapContext';
import { getMapTokens, buildPhantomStyle } from '../mapTokens';
import { useSystemStore } from '../../../stores/systemStore';

/**
 * BaseLayer — re-renders the dark raster tiles whenever the SystemState changes,
 * so accent-driven background stays in sync with state transitions.
 */
export function BaseLayer() {
  const { map, ready } = useMapInstance();
  const systemState = useSystemStore((s) => s.state);

  useEffect(() => {
    if (!map || !ready) return;

    try {
      const tokens = getMapTokens();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setStyle(buildPhantomStyle(tokens) as any);
    } catch {
      /* map not ready yet */
    }
  }, [map, ready, systemState]);

  return null;
}
