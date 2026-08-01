import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { useMapStore } from '../../stores/mapStore';
import { useEffect, useMemo } from 'react';

export const DeckOverlay = () => {
  const entities = useMapStore((state) => state.entities);

  const layers = useMemo(() => [
    new ScatterplotLayer({
      id: 'entities-layer',
      data: entities,
      getPosition: (d) => [d.position[0], d.position[1], d.position[2] || 0],
      getFillColor: [0, 255, 255, 220],
      getLineColor: [0, 0, 0, 255],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      getRadius: 8,
      radiusUnits: 'pixels',
      stroked: true,
      pickable: true,
      updateTriggers: {
        getPosition: [entities],
      }
    })
  ], [entities]);

  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ interleaved: true, layers }));
  
  useEffect(() => {
    overlay.setProps({ layers });
  }, [layers, overlay]);

  return null;
};
