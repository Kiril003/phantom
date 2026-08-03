import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { byZoom, expr } from './base';
import type { Palette } from './palette';

const SRC = 'openmaptiles';
const LAYER = 'poi';

const FOOD = ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery', 'sushi'];
const SHOP = ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'butcher', 'florist',
  'furniture', 'gift', 'hairdresser', 'laundry', 'music', 'suitcase', 'car', 'bicycle', 'bank'];
const TRANSIT = ['bus', 'railway', 'aerialway', 'airport', 'ferry_terminal', 'harbor',
  'fuel', 'parking'];
const HEALTH = ['hospital', 'pharmacy', 'doctors', 'dentist', 'veterinary'];
const CIVIC = ['town_hall', 'police', 'fire_station', 'post', 'embassy', 'prison',
  'school', 'college', 'library', 'place_of_worship'];
const LEISURE = ['park', 'garden', 'playground', 'pitch', 'golf', 'stadium', 'swimming',
  'tennis', 'campsite', 'picnic_site', 'museum', 'art_gallery', 'theatre', 'cinema',
  'attraction', 'monument', 'castle', 'zoo', 'aquarium', 'lodging', 'cemetery'];

function family(p: Palette): ExpressionSpecification {
  return expr([
    'match', ['get', 'class'],
    FOOD, p.poi.food,
    SHOP, p.poi.shop,
    TRANSIT, p.poi.transit,
    HEALTH, p.poi.health,
    CIVIC, p.poi.civic,
    LEISURE, p.poi.leisure,
    p.poi.civic,
  ]);
}

/** Дрібне, що має сенс лише коли людина вже стоїть на місці. */
const MINOR = ['toilets', 'drinking_water', 'information', 'shelter',
  'telephone', 'bicycle_rental', 'post_box'];

/**
 * Список дозволених класів, а не заборонених. У тайлі центру Києва лежать
 * `gate × 305`, `waste_basket × 129`, `lift_gate × 100`, `bollard × 42` —
 * саме вони засипали мапу сірим кропом. Клас, якого тут немає, не малюємо
 * взагалі: курована мапа корисніша за повну.
 */
const CLASS_GATE = expr([
  'match', ['get', 'class'],
  [...FOOD, ...SHOP, ...TRANSIT, ...HEALTH, ...CIVIC, ...LEISURE], 14,
  MINOR, 18,
  99,
]);

/**
 * Скільки міста показувати. Ранг у тайлі — порядок важливості в межах
 * клітинки; без сходинок по зуму z14 стає суцільним килимом (в одному
 * тайлі Києва лежить 2673 точки).
 */
const RANK_GATE = expr([
  '<=',
  ['coalesce', ['get', 'rank'], 99],
  ['step', ['zoom'], 3, 15, 6, 16, 12, 17, 26, 18, 60, 19, 999],
]);

const FILTER = expr(['all', ['>=', ['zoom'], CLASS_GATE], RANK_GATE]);

/**
 * Кольоровий обід навколо точки. Іконки спрайту OpenMapTiles — не гліфи, а
 * готові світлі маркери (заміряно: 79% площі — непрозорий беж ~#e9d5bf), і
 * підкладка під ними просто зникає. Тому коло тут ширше за іконку: колір
 * каже, що це за місце, іконка каже, яке саме.
 */
export function poiDiscLayer(p: Palette): LayerSpecification {
  return {
    id: 'poi-disc',
    type: 'circle',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 14,
    filter: FILTER,
    paint: {
      'circle-color': family(p),
      'circle-radius': byZoom([[14, 5.5], [16, 8.5], [18, 11], [20, 13.5]]),
      'circle-stroke-color': p.halo,
      'circle-stroke-width': byZoom([[14, 0.8], [17, 1.6]]),
      'circle-opacity': byZoom([[14, 0], [14.6, 1]]),
      'circle-stroke-opacity': byZoom([[14, 0], [14.6, 1]]),
    },
  };
}

export function poiSymbolLayers(p: Palette): LayerSpecification[] {
  return [
    {
      id: 'poi-mark',
      type: 'symbol',
      source: SRC,
      'source-layer': LAYER,
      minzoom: 14,
      filter: FILTER,
      layout: {
        // Іконка йде разом зі своїм кружком, тому колізій для неї немає —
        // інакше лишалися б голі кружки без значка. Змагається лише підпис.
        // Малюємо за класом, не за підкласом. Спрайт покриває 72 з 74 наших
        // класів, а от підкласів у ньому майже немає — і кожен промах
        // MapLibre пише в консоль окремим рядком («Image "clinic" could not
        // be loaded»), навіть усередині coalesce.
        'icon-image': expr([
          'coalesce',
          ['image', ['match', ['get', 'class'],
            'ferry_terminal', 'ferry',
            'post_box', 'post',
            ['get', 'class'],
          ]],
          ['image', 'circle_stroked'],
        ]),
        'icon-size': byZoom([[14, 0.4], [16, 0.6], [18, 0.78], [20, 0.95]]),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': expr(['coalesce', ['get', 'name:uk'], ['get', 'name:en'], ['get', 'name']]),
        'text-font': ['Noto Sans Regular'],
        'text-size': byZoom([[15, 10], [18, 12]]),
        'text-anchor': 'top',
        'text-offset': [0, 0.85],
        'text-max-width': 8,
        'text-optional': true,
        'text-padding': 4,
        'symbol-sort-key': expr(['coalesce', ['get', 'rank'], 99]),
      },
      paint: {
        'icon-opacity': byZoom([[14, 0], [14.6, 1]]),
        'text-color': p.ink,
        'text-halo-color': p.halo,
        'text-halo-width': 1.4,
        'text-opacity': byZoom([[15, 0], [15.6, 1]]),
      },
    },
    {
      id: 'housenumber',
      type: 'symbol',
      source: SRC,
      'source-layer': 'housenumber',
      minzoom: 17.5,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': ['Noto Sans Regular'],
        'text-size': byZoom([[17.5, 9], [20, 11]]),
        'text-padding': 2,
      },
      paint: {
        'text-color': p.inkFaint,
        'text-halo-color': p.halo,
        'text-halo-width': 1,
        'text-opacity': byZoom([[17.5, 0], [18.2, 1]]),
      },
    },
  ];
}
