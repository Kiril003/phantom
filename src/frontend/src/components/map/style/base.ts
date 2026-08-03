import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { Palette } from './palette';

const SRC = 'openmaptiles';

export function expr(value: unknown): ExpressionSpecification {
  return value as ExpressionSpecification;
}

/** Плавна величина за масштабом — ширина лінії, розмір тексту, радіус. */
export function byZoom(stops: Array<[number, number]>): ExpressionSpecification {
  const out: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [z, v] of stops) out.push(z, v);
  return expr(out);
}

/**
 * Підземне, наземне й підвісне мають різні правила малювання. Значення поля
 * `brunnel` в OpenMapTiles: bridge | tunnel | ford, порожньо — по землі.
 */
export const ON_GROUND = expr(['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]]);
export const IS_BRIDGE = expr(['==', ['get', 'brunnel'], 'bridge']);
export const IS_TUNNEL = expr(['==', ['get', 'brunnel'], 'tunnel']);

export function baseLayers(p: Palette): LayerSpecification[] {
  return [
    { id: 'bg', type: 'background', paint: { 'background-color': p.land } },
    {
      id: 'landcover',
      type: 'fill',
      source: SRC,
      'source-layer': 'landcover',
      paint: {
        'fill-color': expr([
          'match', ['get', 'class'],
          ['wood'], p.greenDeep,
          ['grass'], p.green,
          ['sand'], p.sand,
          ['wetland'], p.wetland,
          ['farmland'], p.builtup,
          ['rock', 'ice'], p.sand,
          p.green,
        ]),
        'fill-opacity': byZoom([[6, 0.5], [12, 0.8]]),
      },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: SRC,
      'source-layer': 'landuse',
      minzoom: 8,
      paint: {
        'fill-color': expr([
          'match', ['get', 'class'],
          ['industrial', 'railway', 'quarry'], p.industrial,
          ['cemetery', 'military'], p.greenDeep,
          ['residential', 'suburb', 'neighbourhood'], p.builtup,
          p.builtup,
        ]),
        'fill-opacity': 0.6,
      },
    },
    {
      id: 'park',
      type: 'fill',
      source: SRC,
      'source-layer': 'park',
      paint: { 'fill-color': p.green, 'fill-opacity': 0.7 },
    },
    {
      id: 'park-edge',
      type: 'line',
      source: SRC,
      'source-layer': 'park',
      minzoom: 12,
      paint: {
        'line-color': p.greenDeep,
        'line-width': byZoom([[12, 0.4], [16, 1.2]]),
        'line-opacity': 0.7,
      },
    },
    // Береги: спершу м'яке світло по контуру, потім сама вода. Так озеро
    // сідає в ландшафт, а не лежить на ньому наліпкою.
    {
      id: 'water-halo',
      type: 'line',
      source: SRC,
      'source-layer': 'water',
      paint: {
        'line-color': p.shore,
        'line-width': byZoom([[6, 1], [12, 4], [16, 9]]),
        'line-blur': byZoom([[6, 1], [16, 6]]),
        'line-opacity': p.dark ? 0.4 : 0.75,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: SRC,
      'source-layer': 'water',
      filter: expr(['!=', ['get', 'brunnel'], 'tunnel']),
      paint: {
        'fill-color': expr([
          'match', ['get', 'class'],
          ['ocean'], p.waterDeep,
          ['river'], p.water,
          p.water,
        ]),
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: SRC,
      'source-layer': 'waterway',
      minzoom: 8,
      filter: expr(['!=', ['get', 'brunnel'], 'tunnel']),
      paint: {
        'line-color': p.water,
        'line-width': byZoom([[8, 0.5], [14, 2.2], [18, 8]]),
      },
    },
    {
      id: 'aeroway-area',
      type: 'fill',
      source: SRC,
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: expr(['==', ['geometry-type'], 'Polygon']),
      paint: { 'fill-color': p.industrial },
    },
    {
      id: 'aeroway-runway',
      type: 'line',
      source: SRC,
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: expr(['==', ['geometry-type'], 'LineString']),
      paint: {
        'line-color': p.roadCasing,
        'line-width': byZoom([[11, 1], [14, 6], [17, 22]]),
      },
    },
  ];
}
