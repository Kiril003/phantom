import type { LayerSpecification } from 'maplibre-gl';
import { byZoom, expr } from './base';
import type { Palette } from './palette';
import { shadowOffset, shadowOpacity, type SunPosition } from './sun';

const SRC = 'openmaptiles';
const LAYER = 'building';

const VISIBLE = expr(['!=', ['get', 'hide_3d'], true]);
const HEIGHT = expr(['coalesce', ['get', 'render_height'], 4]);

/**
 * Колір беремо з висоти, а не з OSM. Поле `colour` там є, але це не колір
 * фасаду: у центрі Києва лежать `#0099ff` × 15, `#e5c100` × 8, `green`,
 * `pink`, `teal`. Мапа з ними виглядає як помилка рендера, тож єдина чесна
 * величина тут — висота будинку.
 */
function buildingColor(p: Palette) {
  return expr([
    'interpolate', ['linear'], HEIGHT,
    0, p.building, 14, p.building, 45, p.buildingTop, 140, p.buildingTop,
  ]);
}

export function buildingLayers(p: Palette, sun: SunPosition): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  const shadow = shadowOpacity(sun);

  if (shadow > 0) {
    layers.push({
      id: 'building-shadow',
      type: 'fill',
      source: SRC,
      'source-layer': LAYER,
      minzoom: 15,
      filter: VISIBLE,
      paint: {
        'fill-color': p.buildingShadow,
        'fill-translate': shadowOffset(sun),
        'fill-translate-anchor': 'map',
        'fill-opacity': byZoom([[15, 0], [16, shadow]]),
      },
    });
  }

  layers.push({
    id: 'building-flat',
    type: 'fill',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 13,
    maxzoom: 16,
    filter: VISIBLE,
    paint: {
      'fill-color': p.buildingFlat,
      'fill-opacity': byZoom([[13, 0], [13.8, 0.9], [15, 0.9], [15.8, 0]]),
    },
  });

  layers.push({
    id: 'building-3d',
    type: 'fill-extrusion',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 14.5,
    filter: VISIBLE,
    paint: {
      'fill-extrusion-color': buildingColor(p),
      'fill-extrusion-height': expr([
        'interpolate', ['linear'], ['zoom'], 14.5, 0, 16, HEIGHT,
      ]),
      'fill-extrusion-base': expr(['coalesce', ['get', 'render_min_height'], 0]),
      'fill-extrusion-opacity': p.dark ? 0.94 : 0.97,
      // Градієнт по вертикалі — те, що відрізняє об'єм від кольорових
      // коробок: низ стіни темніший, дах світліший.
      'fill-extrusion-vertical-gradient': true,
    },
  });

  // Світлий кант по даху. Дешевий шар, але саме він дає силует.
  layers.push({
    id: 'building-roof',
    type: 'fill-extrusion',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 16.5,
    filter: expr(['all', VISIBLE, ['>', HEIGHT, 6]]),
    paint: {
      'fill-extrusion-color': p.roofEdge,
      'fill-extrusion-base': HEIGHT,
      'fill-extrusion-height': expr(['+', HEIGHT, 0.6]),
      'fill-extrusion-opacity': byZoom([[16.5, 0], [17.4, p.dark ? 0.5 : 0.75]]),
      'fill-extrusion-vertical-gradient': false,
    },
  });

  return layers;
}
