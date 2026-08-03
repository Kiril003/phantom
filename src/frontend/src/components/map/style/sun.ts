import type { LightSpecification } from 'maplibre-gl';
import type { Palette } from './palette';

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Градуси над обрієм. Від'ємне — сонце зайшло. */
  elevation: number;
  /** Градуси від півночі за годинниковою стрілкою. */
  azimuth: number;
}

/**
 * Положення сонця за NOAA. Тінь на будинку має падати туди, куди вона падає
 * насправді о цій годині в цьому місці — інакше об'єм читається як
 * декорація. Годинник пристрою і центр мапи, більше нічого не треба.
 */
export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const hourAngle = (((gmst + lon / 15) % 24) * 15) * RAD - ra;

  const phi = lat * RAD;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle),
  );

  return { elevation: elevation / RAD, azimuth: ((azimuth / RAD) % 360 + 360) % 360 };
}

/** Теплота світла: низьке сонце руде, високе біле, за обрієм — холодне. */
function sunColor(elevation: number): string {
  if (elevation <= -6) return '#7f93b5';
  if (elevation <= 0) return '#c98a5e';
  if (elevation < 12) return '#ffb066';
  if (elevation < 28) return '#ffd9a3';
  return '#fff6e8';
}

/**
 * MapLibre міряє `position` як [радіус, азимут від півночі, полярний кут від
 * зеніту]. Тобто азимут лягає один в один, а висота — це 90° мінус наша.
 * Нижче обрію світло почало б бити знизу, тому вночі підіймаємо його вгору
 * і гасимо: це вже не сонце, а розсіяне світло неба.
 */
export function sunLight(sun: SunPosition): LightSpecification {
  const belowHorizon = sun.elevation <= 0;
  const polar = belowHorizon ? 22 : Math.max(6, 90 - sun.elevation);
  // Контраст найбільший на світанку: довгі тіні, різкі грані.
  const intensity = belowHorizon
    ? 0.16
    : Math.min(0.78, 0.42 + (1 - Math.min(sun.elevation, 60) / 60) * 0.36);

  return {
    anchor: 'map',
    color: sunColor(sun.elevation),
    intensity,
    position: [1.4, belowHorizon ? 210 : sun.azimuth, polar],
  };
}

/**
 * Зсув тіні у пікселях. Напрямок — протилежний сонцю; довжина росте, коли
 * сонце сідає. Осі MapLibre екранні: +x на схід, +y на південь.
 */
export function shadowOffset(sun: SunPosition): [number, number] {
  if (sun.elevation <= 1) return [0, 0];
  const length = Math.min(22, 5 + 90 / Math.max(8, sun.elevation));
  const a = sun.azimuth * RAD;
  return [-length * Math.sin(a), length * Math.cos(a)];
}

/** Скільки тінь важить: опівдні бліда, на заході густа, вночі її нема. */
export function shadowOpacity(sun: SunPosition): number {
  if (sun.elevation <= 1) return 0;
  return Math.min(0.5, 0.14 + (1 - Math.min(sun.elevation, 60) / 60) * 0.34);
}

export function skyFor(p: Palette, sun: SunPosition): Record<string, unknown> {
  const dusk = sun.elevation > -8 && sun.elevation < 10;
  return {
    'sky-color': p.skyHigh,
    'horizon-color': dusk ? '#e8a05a' : p.skyLow,
    'fog-color': p.fog,
    'fog-ground-blend': 0.62,
    'horizon-fog-blend': 0.5,
    'sky-horizon-blend': dusk ? 0.75 : 0.6,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 12, 0.24, 16, 0],
  };
}
