import type { MapTokens } from '../mapTokens';

/** Родини POI. Більше шести — і мапа стає рябою, менше — нечитабельною. */
export interface PoiFamilies {
  food: string;
  shop: string;
  transit: string;
  health: string;
  civic: string;
  leisure: string;
}

export interface Palette {
  land: string;
  water: string;
  waterDeep: string;
  waterLine: string;
  shore: string;
  green: string;
  greenDeep: string;
  sand: string;
  wetland: string;
  builtup: string;
  industrial: string;
  roadHi: string;
  roadMid: string;
  roadLow: string;
  roadPath: string;
  roadCasing: string;
  roadCasingSoft: string;
  tunnel: string;
  rail: string;
  railTies: string;
  building: string;
  buildingTop: string;
  buildingFlat: string;
  buildingShadow: string;
  roofEdge: string;
  boundary: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  halo: string;
  disc: string;
  discRing: string;
  glyph: string;
  skyLow: string;
  skyHigh: string;
  fog: string;
  poi: PoiFamilies;
  dark: boolean;
}

/**
 * Іконки спрайту OpenMapTiles — СВІТЛІ (заміряно: середній піксель ~#e9d5bf).
 * На кремовому папері вони зникають, тому кожна сидить на темному кружку.
 * Звідси `disc` темний у всіх темах, а `glyph` — те, чим ми його обводимо.
 */
const DAY_POI: PoiFamilies = {
  food: '#b9201f',
  shop: '#a8690b',
  transit: '#2f5d7c',
  health: '#0d7a55',
  civic: '#4a3f2e',
  leisure: '#3f6b2a',
};

const NIGHT_POI: PoiFamilies = {
  food: '#d64b3c',
  shop: '#e0a020',
  transit: '#4d86ad',
  health: '#1aa878',
  civic: '#8a7a5c',
  leisure: '#5d9440',
};

export function palette(tokens: MapTokens): Palette {
  const night = tokens.theme === 'amber-night' || tokens.theme === 'ghost';
  const cold = tokens.theme === 'cyberdeck-cold';

  if (night) {
    return {
      land: '#12100c', water: '#08131d', waterDeep: '#050d16', waterLine: '#1a3a52',
      shore: '#22405a',
      green: '#131a11', greenDeep: '#17200f', sand: '#1d1a12', wetland: '#141a16',
      builtup: '#171410', industrial: '#1a1611',
      roadHi: '#6b5527', roadMid: '#4a3c1d', roadLow: '#2f2718', roadPath: '#3a3122',
      roadCasing: '#0b0906', roadCasingSoft: '#100d09', tunnel: '#241d12',
      rail: '#3a3428', railTies: '#544a38',
      building: '#221c14', buildingTop: '#31281b', buildingFlat: '#1c1710',
      buildingShadow: '#000000', roofEdge: '#4a3d29',
      boundary: '#4a3d22', ink: '#ece1cb', inkSoft: '#a2937a', inkFaint: '#6e6352',
      halo: 'rgba(8,6,4,0.92)',
      disc: '#20190f', discRing: 'rgba(236,225,203,0.28)', glyph: '#ece1cb',
      skyLow: '#1a1206', skyHigh: '#05070f', fog: '#0b0a08',
      poi: NIGHT_POI, dark: true,
    };
  }
  if (cold) {
    return {
      land: '#0a0f1a', water: '#061220', waterDeep: '#040c17', waterLine: '#0f2a3d',
      shore: '#1b4258',
      green: '#0b1417', greenDeep: '#0e1a1d', sand: '#141a1f', wetland: '#0d1a1c',
      builtup: '#0d131d', industrial: '#101720',
      roadHi: '#256a80', roadMid: '#1a4a5b', roadLow: '#133240', roadPath: '#1a3a46',
      roadCasing: '#04080e', roadCasingSoft: '#070d15', tunnel: '#0f2530',
      rail: '#20303b', railTies: '#33485a',
      building: '#121e2a', buildingTop: '#1a2b38', buildingFlat: '#0f1924',
      buildingShadow: 'rgba(0,0,0,0.6)', roofEdge: '#27404f',
      boundary: '#1f4d5c', ink: '#dfeef5', inkSoft: '#8aa2b2', inkFaint: '#5c7284',
      halo: 'rgba(4,8,14,0.92)',
      disc: '#0d1a24', discRing: 'rgba(223,238,245,0.3)', glyph: '#dfeef5',
      skyLow: '#062230', skyHigh: '#020610', fog: '#071018',
      poi: NIGHT_POI, dark: true,
    };
  }
  return {
    land: '#f8f4ea', water: '#bcd7e8', waterDeep: '#9fc4da', waterLine: '#7ea8c0',
    shore: '#dceaf1',
    green: '#e0e9cf', greenDeep: '#d0deb9', sand: '#f0e6cf', wetland: '#dde6d9',
    builtup: '#f1e8d8', industrial: '#eae1d1',
    roadHi: '#f5c65e', roadMid: '#ffffff', roadLow: '#fdfaf4', roadPath: '#e5d8bf',
    roadCasing: '#cfbfa2', roadCasingSoft: '#e0d4bd', tunnel: '#efe7d9',
    rail: '#bfb29a', railTies: '#a3947a',
    building: '#dccdb4', buildingTop: '#efe4cf', buildingFlat: '#e4d9c2',
    buildingShadow: '#6b5330', roofEdge: '#fdf8ee',
    boundary: '#c2a86f', ink: '#241c13', inkSoft: '#6b6050', inkFaint: '#948875',
    halo: 'rgba(255,252,246,0.94)',
    disc: '#33291b', discRing: 'rgba(255,252,246,0.85)', glyph: '#fdf6e9',
    skyLow: '#cfe3f2', skyHigh: '#8fb8dc', fog: '#efe7d8',
    poi: DAY_POI, dark: false,
  };
}
