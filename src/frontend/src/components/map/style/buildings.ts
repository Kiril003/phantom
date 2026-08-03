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

/**
 * Смуги висот для тіні.
 *
 * `fill-translate` — величина на шар, не на об'єкт: одним шаром усі тіні
 * вийдуть однакової довжини, і дев'ятиповерхівка кине таку саму, як кіоск.
 * Тому шарів три, кожен зі своїм множником довжини. Це не трасування
 * променів, але висота нарешті читається з тіні.
 */
const BANDS: Array<{ key: string; min: number; max: number; reach: number }> = [
  { key: 'low', min: 0, max: 12, reach: 0.5 },
  { key: 'mid', min: 12, max: 32, reach: 1 },
  { key: 'high', min: 32, max: 1e6, reach: 1.9 },
];

export function buildingLayers(p: Palette, sun: SunPosition): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  const opacity = shadowOpacity(sun);
  const [dx, dy] = shadowOffset(sun);

  if (opacity > 0) {
    for (const band of BANDS) {
      layers.push({
        id: `building-shadow-${band.key}`,
        type: 'fill',
        source: SRC,
        'source-layer': LAYER,
        minzoom: 15,
        filter: expr(['all', VISIBLE, ['>=', HEIGHT, band.min], ['<', HEIGHT, band.max]]),
        paint: {
          'fill-color': p.buildingShadow,
          'fill-translate': [dx * band.reach, dy * band.reach],
          'fill-translate-anchor': 'map',
          'fill-opacity': byZoom([
            [15, 0],
            [16, Math.min(0.55, opacity * (0.8 + band.reach * 0.15))],
          ]),
        },
      });
    }
  }

  // Притінення біля підмурівка. Без нього будинок не стоїть на землі, а
  // лежить на ній наліпкою — це те, що першим впадає в око поруч із
  // рушіями, які рахують затінення чесно.
  layers.push({
    id: 'building-contact',
    type: 'line',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 15.2,
    filter: VISIBLE,
    paint: {
      'line-color': p.buildingShadow,
      'line-width': byZoom([[15.2, 1], [17, 3], [19, 6]]),
      'line-blur': byZoom([[15.2, 1], [19, 4]]),
      'line-opacity': byZoom([[15.2, 0], [16, p.dark ? 0.5 : 0.3]]),
    },
  });

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
