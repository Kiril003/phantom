import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapTokens } from './mapTokens';
import { baseLayers } from './style/base';
import { buildingLayers } from './style/buildings';
import { boundaryLayer, labelLayers } from './style/labels';
import { palette } from './style/palette';
import { poiDiscLayer, poiSymbolLayers } from './style/poi';
import { roadLayers } from './style/roads';
import { skyFor, sunPosition, type SunPosition } from './style/sun';

/**
 * Власний стиль мапи PHANTOM.
 *
 * Дані беремо вільні (векторні тайли OpenMapTiles, шрифти й спрайти), а
 * малюємо своїми шарами: об'єм, рельєф, небо, точки міста й одна мова
 * підписів. Чужий стиль цілим URL не дав би нічого з цього.
 */

const VECTOR_SOURCE = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';

/** Рельєф: відкриті дані Mapzen/AWS. Ключа не потребує — інакше це порушило б закон нуль-конфігу. */
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * Два джерела на ті самі тайли — навмисно. MapLibre сам пише в консоль, що
 * спільне джерело під тіньовий шар і під геометрію рельєфу псує якість обох:
 * вони просять різні рівні деталізації в різні моменти й б'ються за кеш.
 */
export const DEM_SOURCE_ID = 'phantom-dem';
export const DEM_TERRAIN_ID = 'phantom-dem-terrain';

export interface PhantomStyleOptions {
  /** Рельєф і небо. Вимикається на слабкій машині або в тестах. */
  relief?: boolean;
  /** Об'ємні будівлі. */
  buildings?: boolean;
  /** Центр мапи — потрібен, щоб порахувати, де зараз сонце. */
  center?: [number, number];
  /** Момент, на який рахуємо сонце. За замовчуванням — зараз. */
  at?: Date;
}

/** Позиція сонця для поточного виду. Годинник пристрою, центр мапи, нічого більше. */
export function sunFor(opts: PhantomStyleOptions = {}): SunPosition {
  const [lon, lat] = opts.center ?? [30.52, 50.45];
  return sunPosition(opts.at ?? new Date(), lat, lon);
}

export function buildPhantomMapStyle(
  tokens: MapTokens,
  opts: PhantomStyleOptions = {},
): StyleSpecification {
  const p = palette(tokens);
  const relief = opts.relief !== false;
  const buildings = opts.buildings !== false;
  const sun = sunFor(opts);

  const layers: LayerSpecification[] = [...baseLayers(p)];

  if (relief) {
    layers.push({
      id: 'hillshade',
      type: 'hillshade',
      source: DEM_SOURCE_ID,
      paint: {
        'hillshade-exaggeration': p.dark ? 0.35 : 0.24,
        'hillshade-shadow-color': p.dark ? '#000000' : '#8a7a5e',
        'hillshade-highlight-color': p.dark ? '#3a2f1c' : '#fffaf0',
        'hillshade-accent-color': p.dark ? '#1a1408' : '#c9b894',
      },
    });
  }

  layers.push(...roadLayers(p));
  if (buildings) layers.push(...buildingLayers(p, sun));
  layers.push(boundaryLayer(p), poiDiscLayer(p), ...labelLayers(p), ...poiSymbolLayers(p));

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
            [DEM_TERRAIN_ID]: {
              type: 'raster-dem' as const,
              tiles: [DEM_TILES],
              tileSize: 256,
              maxzoom: 13,
              encoding: 'terrarium' as const,
            },
          }
        : {}),
    },
    layers,
  };

  if (relief) {
    (style as StyleSpecification & { sky?: unknown }).sky = skyFor(p, sun);
    // Рельєф належить самому стилю, а не дописується збоку. Поки його тут
    // не було, MapLibre зводив старий стиль (з рельєфом) із новим (без) і
    // падав на `_checkLoaded` — після чого будував усе з нуля, а разом із
    // тим гасив світло й починав тайли наново.
    style.terrain = { source: DEM_TERRAIN_ID, exaggeration: 1.25 };
  }

  return style;
}
