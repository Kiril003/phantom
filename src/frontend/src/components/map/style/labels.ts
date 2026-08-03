import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { byZoom, expr } from './base';
import type { Palette } from './palette';

const SRC = 'openmaptiles';
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

/**
 * Українська передусім. Раніше другою ланкою стояло `name:int` — такого поля
 * в схемі OpenMapTiles немає взагалі (там `name_int`), тож ланка була мертва
 * і підпис одразу падав на сире `name`, часом російське.
 */
export const LABEL: ExpressionSpecification = expr([
  'coalesce', ['get', 'name:uk'], ['get', 'name:en'], ['get', 'name'],
]);

export function boundaryLayer(p: Palette): LayerSpecification {
  return {
    id: 'boundary',
    type: 'line',
    source: SRC,
    'source-layer': 'boundary',
    filter: expr(['<=', ['get', 'admin_level'], 4]),
    paint: {
      'line-color': p.boundary,
      'line-width': byZoom([[2, 0.5], [6, 1.2], [12, 2.4]]),
      'line-dasharray': [4, 2],
      'line-opacity': 0.7,
    },
  };
}

/**
 * Порядок тут — не порядок малювання, а порядок ПРАВА на місце: MapLibre
 * розставляє символи згори вниз по списку, і хто не влазить — того нема.
 * Тому назва міста стоїть перед назвою вулиці, а вулиця перед кав'ярнею.
 */
export function labelLayers(p: Palette): LayerSpecification[] {
  return [
    {
      id: 'label-place',
      type: 'symbol',
      source: SRC,
      'source-layer': 'place',
      maxzoom: 15,
      filter: expr(['match', ['get', 'class'],
        ['city', 'town', 'village', 'hamlet'], true, false]),
      layout: {
        'text-field': LABEL,
        'text-font': FONT_BOLD,
        'text-size': expr([
          'interpolate', ['linear'], ['zoom'],
          4, ['match', ['get', 'class'], 'city', 13, 10],
          12, ['match', ['get', 'class'], 'city', 20, 'town', 15, 12],
        ]),
        'text-letter-spacing': 0.04,
        'text-max-width': 8,
        'symbol-sort-key': expr(['coalesce', ['get', 'rank'], 99]),
      },
      paint: {
        'text-color': p.ink,
        'text-halo-color': p.halo,
        'text-halo-width': 1.8,
      },
    },
    {
      id: 'label-neighbourhood',
      type: 'symbol',
      source: SRC,
      'source-layer': 'place',
      minzoom: 13,
      filter: expr(['match', ['get', 'class'],
        ['suburb', 'quarter', 'neighbourhood'], true, false]),
      layout: {
        'text-field': LABEL,
        'text-font': FONT,
        'text-size': byZoom([[13, 11], [17, 14]]),
        'text-letter-spacing': 0.14,
        'text-transform': 'uppercase',
        'text-max-width': 9,
      },
      paint: {
        'text-color': p.inkSoft,
        'text-halo-color': p.halo,
        'text-halo-width': 1.6,
        'text-opacity': byZoom([[13, 0], [13.6, 0.9]]),
      },
    },
    // Щит із номером траси. `ref_length` у тайлі каже, яка з підкладок
    // road_1…road_6 підійде під довжину напису.
    {
      id: 'label-shield',
      type: 'symbol',
      source: SRC,
      'source-layer': 'transportation_name',
      minzoom: 8,
      filter: expr(['all',
        ['has', 'ref'],
        ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
      ]),
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'icon-image': expr(['concat', 'road_',
          ['to-string', ['max', 1, ['min', ['coalesce', ['get', 'ref_length'], 1], 6]]]]),
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 4, 1, 4],
        'text-field': ['get', 'ref'],
        'text-font': FONT_BOLD,
        'text-size': 10,
        'text-max-width': 6,
      },
      paint: { 'text-color': p.ink },
    },
    {
      id: 'label-road',
      type: 'symbol',
      source: SRC,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: expr(['==', ['geometry-type'], 'LineString']),
      layout: {
        'symbol-placement': 'line',
        'text-field': LABEL,
        'text-font': FONT,
        'text-size': byZoom([[14, 9.5], [18, 13]]),
        'text-letter-spacing': 0.02,
        'text-padding': 3,
        'symbol-spacing': 320,
      },
      paint: {
        'text-color': p.inkSoft,
        'text-halo-color': p.halo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: SRC,
      'source-layer': 'water_name',
      minzoom: 6,
      layout: {
        'text-field': LABEL,
        'text-font': FONT,
        'text-size': byZoom([[6, 10], [14, 14]]),
        'text-letter-spacing': 0.08,
        'text-max-width': 7,
      },
      paint: {
        'text-color': p.waterLine,
        'text-halo-color': p.halo,
        'text-halo-width': 1.1,
      },
    },
    {
      id: 'label-peak',
      type: 'symbol',
      source: SRC,
      'source-layer': 'mountain_peak',
      minzoom: 10,
      filter: expr(['<=', ['coalesce', ['get', 'rank'], 99], 6]),
      layout: {
        'icon-image': 'mountain_11',
        'icon-size': 0.9,
        'text-field': expr(['concat', LABEL, '\n', ['to-string', ['get', 'ele']], ' м']),
        'text-font': FONT,
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-optional': true,
      },
      paint: {
        'text-color': p.inkSoft,
        'text-halo-color': p.halo,
        'text-halo-width': 1.2,
      },
    },
  ];
}
