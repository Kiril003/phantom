import type {
  StyleSpecification,
  LayerSpecification,
  ExpressionSpecification,
} from 'maplibre-gl';
import type { MapTokens } from './mapTokens';

/**
 * Власний стиль мапи PHANTOM.
 *
 * До цього мапа вантажила чужий стиль цілим URL (OpenFreeMap liberty/positron)
 * — і виглядала як чужа мапа: сірий папір, підписи двома мовами поруч
 * («Malopidvalna Street Малопідвальна вулиця»), нульовий контроль над
 * ієрархією, і жодної можливості додати об'єм, бо кожен `setStyle` затирав
 * усе своє.
 *
 * Тепер ми беремо лише ДАНІ (векторні тайли OpenMapTiles, шрифти й спрайти —
 * усе вільне, з обов'язковою атрибуцією OSM, яку мапа показує) і малюємо їх
 * своїми шарами у своїй палітрі. Звідси все інше: об'ємні будівлі, рельєф,
 * небо, одна мова підписів.
 */

/** Векторні тайли планети. Вільні для комерційного вжитку, атрибуція OSM. */
const VECTOR_SOURCE = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';

/**
 * Рельєф: відкриті дані Mapzen/AWS у форматі terrarium. Ключа не потребує —
 * інакше це порушило б закон нуль-конфігу.
 */
export const DEM_SOURCE_ID = 'phantom-dem';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Українська передусім; далі міжнародна латиниця, далі як є в даних. */
const LABEL: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:uk'],
  ['get', 'name:int'],
  ['get', 'name'],
];

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

interface Palette {
  land: string;
  water: string;
  waterLine: string;
  green: string;
  greenDeep: string;
  builtup: string;
  roadHi: string;
  roadMid: string;
  roadLow: string;
  roadCasing: string;
  rail: string;
  building: string;
  buildingTop: string;
  boundary: string;
  ink: string;
  inkSoft: string;
  halo: string;
  skyLow: string;
  skyHigh: string;
  dark: boolean;
}

function palette(tokens: MapTokens): Palette {
  const night = tokens.theme === 'amber-night' || tokens.theme === 'ghost';
  const cold = tokens.theme === 'cyberdeck-cold';

  if (night) {
    return {
      land: '#12100c', water: '#0a1520', waterLine: '#12283a',
      green: '#141a12', greenDeep: '#182015', builtup: '#171410',
      roadHi: '#5c4a22', roadMid: '#3d3218', roadLow: '#2a2317',
      roadCasing: '#0b0906', rail: '#2f2a22',
      building: '#1e1913', buildingTop: '#2b2318',
      boundary: '#4a3d22', ink: '#e8dcc4', inkSoft: '#9b8d74',
      halo: 'rgba(8,6,4,0.9)', skyLow: '#1a1206', skyHigh: '#05070f',
      dark: true,
    };
  }
  if (cold) {
    return {
      land: '#0a0f1a', water: '#071320', waterLine: '#0f2a3d',
      green: '#0c1418', greenDeep: '#0f1a1e', builtup: '#0d131d',
      roadHi: '#1f5566', roadMid: '#173d4a', roadLow: '#122b35',
      roadCasing: '#04080e', rail: '#1c2a33',
      building: '#101a24', buildingTop: '#16242f',
      boundary: '#1f4d5c', ink: '#dbe9f0', inkSoft: '#7d94a3',
      halo: 'rgba(4,8,14,0.9)', skyLow: '#062230', skyHigh: '#020610',
      dark: true,
    };
  }
  // Денна тема — тепла паперова, під бурштин.
  return {
    land: '#f6f0e4', water: '#cfe0ea', waterLine: '#a9c6d6',
    green: '#e6ecd8', greenDeep: '#dbe5c8', builtup: '#efe7d8',
    roadHi: '#f2c96b', roadMid: '#ffffff', roadLow: '#fbf7ef',
    roadCasing: '#d8cbb4', rail: '#c9bda6',
    building: '#e5dac5', buildingTop: '#efe6d6',
    boundary: '#c2a86f', ink: '#2a2118', inkSoft: '#6d6250',
    halo: 'rgba(255,252,246,0.92)', skyLow: '#cfe3f2', skyHigh: '#8fb8dc',
    dark: false,
  };
}

/** Плавна ширина дороги за масштабом. */
function widthByZoom(stops: Array<[number, number]>): ExpressionSpecification {
  const out: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [z, w] of stops) out.push(z, w);
  return out as unknown as ExpressionSpecification;
}

const ROAD_HI = ['motorway', 'trunk'];
const ROAD_MID = ['primary', 'secondary'];
const ROAD_LOW = ['tertiary', 'minor', 'service', 'unclassified', 'residential'];

function roadLayers(p: Palette): LayerSpecification[] {
  const mk = (
    id: string,
    classes: string[],
    color: string,
    casing: string | null,
    stops: Array<[number, number]>,
    minzoom: number,
  ): LayerSpecification[] => {
    const filter = ['all', ['==', ['geometry-type'], 'LineString'],
      ['match', ['get', 'class'], classes, true, false]] as unknown as ExpressionSpecification;
    const layers: LayerSpecification[] = [];
    if (casing) {
      layers.push({
        id: `${id}-casing`, type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation', minzoom, filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': casing,
          'line-width': widthByZoom(stops.map(([z, w]) => [z, w + 1.6] as [number, number])),
        },
      });
    }
    layers.push({
      id, type: 'line', source: 'openmaptiles',
      'source-layer': 'transportation', minzoom, filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': widthByZoom(stops) },
    });
    return layers;
  };

  return [
    ...mk('road-low', ROAD_LOW, p.roadLow, p.roadCasing, [[12, 0.4], [14, 1.4], [17, 6], [20, 22]], 12),
    ...mk('road-mid', ROAD_MID, p.roadMid, p.roadCasing, [[8, 0.6], [12, 2], [16, 8], [20, 30]], 6),
    ...mk('road-hi', ROAD_HI, p.roadHi, p.roadCasing, [[5, 0.8], [10, 2.4], [16, 12], [20, 40]], 4),
  ];
}

export interface PhantomStyleOptions {
  /** Рельєф і небо. Вимикається на слабкій машині або в тестах. */
  relief?: boolean;
  /** Об'ємні будівлі. */
  buildings?: boolean;
}

export function buildPhantomMapStyle(
  tokens: MapTokens,
  opts: PhantomStyleOptions = {},
): StyleSpecification {
  const p = palette(tokens);
  const relief = opts.relief !== false;
  const buildings = opts.buildings !== false;

  const layers: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': p.land } },
    {
      id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          ['wood', 'forest'], p.greenDeep,
          ['grass', 'meadow', 'park'], p.green,
          p.green,
        ] as unknown as ExpressionSpecification,
        'fill-opacity': 0.75,
      },
    },
    {
      id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
      minzoom: 8,
      paint: { 'fill-color': p.builtup, 'fill-opacity': 0.55 },
    },
    {
      id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
      paint: { 'fill-color': p.green, 'fill-opacity': 0.6 },
    },
    {
      id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
      paint: { 'fill-color': p.water },
    },
    {
      id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
      minzoom: 8,
      paint: {
        'line-color': p.waterLine,
        'line-width': widthByZoom([[8, 0.4], [14, 1.6], [18, 6]]),
      },
    },
  ];

  if (relief) {
    // Тіні рельєфу під усім, що людина малює зверху — гори мають бути
    // видно навіть без нахилу камери.
    layers.push({
      id: 'hillshade', type: 'hillshade', source: DEM_SOURCE_ID,
      paint: {
        'hillshade-exaggeration': p.dark ? 0.35 : 0.22,
        'hillshade-shadow-color': p.dark ? '#000000' : '#8a7a5e',
        'hillshade-highlight-color': p.dark ? '#3a2f1c' : '#fffaf0',
        'hillshade-accent-color': p.dark ? '#1a1408' : '#c9b894',
      },
    });
  }

  layers.push(
    ...roadLayers(p),
    {
      id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
      minzoom: 10,
      filter: ['match', ['get', 'class'], ['rail', 'transit'], true, false] as unknown as ExpressionSpecification,
      paint: {
        'line-color': p.rail,
        'line-width': widthByZoom([[10, 0.5], [16, 2], [20, 5]]),
        'line-dasharray': [3, 2],
      },
    },
  );

  if (buildings) {
    // Об'єм — головне, чого мапі бракувало. Висота справжня: OpenMapTiles
    // несе render_height/render_min_height з OSM, вигадувати нічого не треба.
    layers.push({
      id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles',
      'source-layer': 'building', minzoom: 13,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 4],
          0, p.building, 60, p.buildingTop,
        ] as unknown as ExpressionSpecification,
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          13, 0, 15.5, ['coalesce', ['get', 'render_height'], 4],
        ] as unknown as ExpressionSpecification,
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] as unknown as ExpressionSpecification,
        'fill-extrusion-opacity': p.dark ? 0.92 : 0.82,
      },
    });
  }

  layers.push(
    {
      id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 4] as unknown as ExpressionSpecification,
      paint: {
        'line-color': p.boundary,
        'line-width': widthByZoom([[2, 0.5], [6, 1.2], [12, 2.4]]),
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    },
    {
      id: 'label-road', type: 'symbol', source: 'openmaptiles',
      'source-layer': 'transportation_name', minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': LABEL,
        'text-font': FONT,
        'text-size': widthByZoom([[13, 9], [18, 13]]),
      },
      paint: { 'text-color': p.inkSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'label-water', type: 'symbol', source: 'openmaptiles',
      'source-layer': 'water_name', minzoom: 6,
      layout: {
        'text-field': LABEL, 'text-font': FONT,
        'text-size': widthByZoom([[6, 10], [14, 14]]),
      },
      paint: { 'text-color': p.waterLine, 'text-halo-color': p.halo, 'text-halo-width': 1 },
    },
    {
      id: 'label-place', type: 'symbol', source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['match', ['get', 'class'],
        ['city', 'town', 'village', 'suburb', 'neighbourhood'], true, false] as unknown as ExpressionSpecification,
      layout: {
        'text-field': LABEL,
        'text-font': FONT_BOLD,
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          4, ['match', ['get', 'class'], 'city', 13, 10],
          12, ['match', ['get', 'class'], 'city', 20, 'town', 15, 12],
        ] as unknown as ExpressionSpecification,
        'text-letter-spacing': 0.04,
        'text-max-width': 8,
      },
      paint: { 'text-color': p.ink, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
    },
  );

  const style: StyleSpecification = {
    version: 8,
    name: 'PHANTOM',
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources: {
      openmaptiles: { type: 'vector', url: VECTOR_SOURCE },
      ...(relief
        ? {
            [DEM_SOURCE_ID]: {
              type: 'raster-dem' as const,
              tiles: [DEM_TILES],
              tileSize: 256,
              maxzoom: 13,
              encoding: 'terrarium' as const,
              attribution: 'Рельєф: Mapzen · відкриті дані AWS',
            },
          }
        : {}),
    },
    layers,
  };

  if (relief) {
    // Небо робить нахилену камеру камерою, а не косою картинкою.
    (style as StyleSpecification & { sky?: unknown }).sky = {
      'sky-color': p.skyHigh,
      'horizon-color': p.skyLow,
      'fog-color': p.dark ? '#0b0a08' : '#efe7d8',
      'fog-ground-blend': 0.6,
      'horizon-fog-blend': 0.5,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 12, 0.2, 16, 0],
    };
  }

  return style;
}
