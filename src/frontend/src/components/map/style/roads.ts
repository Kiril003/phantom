import type { LayerSpecification } from 'maplibre-gl';
import { byZoom, expr, IS_BRIDGE, IS_TUNNEL, ON_GROUND } from './base';
import type { Palette } from './palette';

const SRC = 'openmaptiles';
const LAYER = 'transportation';

const HI = ['motorway', 'trunk'];
const MID = ['primary', 'secondary', 'tertiary'];
const LOW = ['minor', 'service', 'unclassified', 'residential'];
const PATH = ['path', 'track'];

type Stops = Array<[number, number]>;

const W_HI: Stops = [[5, 0.9], [10, 2.6], [14, 5], [16, 11], [18, 22], [20, 42]];
const W_MID: Stops = [[7, 0.6], [12, 2.2], [16, 7], [18, 16], [20, 34]];
const W_LOW: Stops = [[12, 0.5], [14, 1.6], [16, 4], [18, 10], [20, 26]];
const W_PATH: Stops = [[14, 0.5], [16, 1.2], [19, 3]];

function wider(stops: Stops, by: number): Stops {
  return stops.map(([z, w]) => [z, w + by] as [number, number]);
}

interface Band {
  key: string;
  classes: string[];
  color: string;
  stops: Stops;
  minzoom: number;
}

/**
 * Один прохід дороги = три шари: обводка, полотно, і те саме окремо для
 * мостів. Порядок у стилі важить більше за кольори — без нього естакада
 * ріже квартал навпіл, а тунель малюється поверх будинків.
 */
function band(p: Palette, b: Band, mode: 'ground' | 'bridge' | 'tunnel'): LayerSpecification[] {
  const geom = expr(['==', ['geometry-type'], 'LineString']);
  const cls = expr(['match', ['get', 'class'], b.classes, true, false]);
  const brunnel = mode === 'bridge' ? IS_BRIDGE : mode === 'tunnel' ? IS_TUNNEL : ON_GROUND;
  const filter = expr(['all', geom, cls, brunnel]);
  const casingBy = mode === 'bridge' ? 3.2 : 1.8;
  const id = `road-${b.key}-${mode}`;

  const casing: LayerSpecification = {
    id: `${id}-casing`,
    type: 'line',
    source: SRC,
    'source-layer': LAYER,
    minzoom: b.minzoom,
    filter,
    layout: { 'line-cap': mode === 'bridge' ? 'butt' : 'round', 'line-join': 'round' },
    paint: {
      'line-color': mode === 'tunnel' ? p.roadCasingSoft : p.roadCasing,
      'line-width': byZoom(wider(b.stops, casingBy)),
      ...(mode === 'tunnel' ? { 'line-dasharray': [1.6, 1.2] } : {}),
    },
  };

  const surface: LayerSpecification = {
    id,
    type: 'line',
    source: SRC,
    'source-layer': LAYER,
    minzoom: b.minzoom,
    filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': mode === 'tunnel' ? p.tunnel : b.color,
      'line-width': byZoom(b.stops),
    },
  };

  return [casing, surface];
}

export function roadLayers(p: Palette): LayerSpecification[] {
  const bands: Band[] = [
    { key: 'path', classes: PATH, color: p.roadPath, stops: W_PATH, minzoom: 14 },
    { key: 'low', classes: LOW, color: p.roadLow, stops: W_LOW, minzoom: 12 },
    { key: 'mid', classes: MID, color: p.roadMid, stops: W_MID, minzoom: 6 },
    { key: 'hi', classes: HI, color: p.roadHi, stops: W_HI, minzoom: 4 },
  ];

  const out: LayerSpecification[] = [];
  for (const b of bands) out.push(...band(p, b, 'tunnel'));
  for (const b of bands) out.push(...band(p, b, 'ground'));

  out.push({
    id: 'rail',
    type: 'line',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 10,
    filter: expr(['all',
      ['match', ['get', 'class'], ['rail', 'transit'], true, false],
      ['!=', ['get', 'brunnel'], 'tunnel'],
    ]),
    paint: { 'line-color': p.rail, 'line-width': byZoom([[10, 0.6], [16, 2.4], [20, 6]]) },
  }, {
    id: 'rail-ties',
    type: 'line',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 14,
    filter: expr(['all',
      ['match', ['get', 'class'], ['rail'], true, false],
      ['!=', ['get', 'brunnel'], 'tunnel'],
    ]),
    paint: {
      'line-color': p.railTies,
      'line-width': byZoom([[14, 2.4], [20, 8]]),
      'line-dasharray': [0.25, 2.4],
    },
  });

  for (const b of bands) out.push(...band(p, b, 'bridge'));

  // Односторонні стрілки — те, чого бракує кожній аматорській мапі. Дані
  // вже в тайлі, поле `oneway`.
  out.push({
    id: 'road-oneway',
    type: 'symbol',
    source: SRC,
    'source-layer': LAYER,
    minzoom: 16,
    filter: expr(['all',
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['get', 'oneway'], 1],
      ['match', ['get', 'class'], [...HI, ...MID, ...LOW], true, false],
    ]),
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 160,
      'icon-image': 'arrow',
      'icon-size': byZoom([[16, 0.6], [19, 1]]),
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': false,
    },
    paint: { 'icon-opacity': p.dark ? 0.5 : 0.65 },
  });

  return out;
}
