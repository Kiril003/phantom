/**
 * UTM і MGRS на WGS84 — власна реалізація без залежностей.
 *
 * Верифікація — utils/__tests__/mgrs.test.ts, проти зовнішніх
 * еталонів (CN Tower з Wikipedia-статті про UTM; приклади man-сторінки
 * GeoConvert із GeographicLib; Гонолулу з Wikipedia-статті про MGRS).
 *
 * Літерування 100-км квадратів — схема AA («MGRS-New», чинна для
 * WGS84): колонки A–Z без I та O з циклом у три зони; рядки
 * A–V без I та O, непарні зони починаються з A, парні — з F.
 */

import { WGS84, tmForward, tmInverse, normalizeLonDeg, type TmProjection } from './tm';

export type Hemisphere = 'N' | 'S';

export interface UtmPoint {
  zone: number;
  hemisphere: Hemisphere;
  /** М від осьового меридіана + 500 000. */
  easting: number;
  /** М від екватора; південна півкуля — від 10 000 000 донизу. */
  northing: number;
}

/** MGRS визначений лише між 80° пд. ш. і 84° пн. ш. */
export function withinUtmLatitude(latDeg: number): boolean {
  return latDeg >= -80 && latDeg <= 84;
}

/**
 * Номер зони UTM з винятками Норвегії (32V) і Шпіцбергена (31X–37X).
 * Винятки України не стосуються, але правило без них — неправильне.
 */
export function utmZone(latDeg: number, lonDeg: number): number {
  const lon = normalizeLonDeg(lonDeg);
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (latDeg >= 56 && latDeg < 64 && lon >= 3 && lon < 12) zone = 32;
  if (latDeg >= 72 && latDeg <= 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

/** Літера 8°-смуги широти (X — розширена, 72…84°). Поза межами — null. */
export function latitudeBand(latDeg: number): string | null {
  if (!withinUtmLatitude(latDeg)) return null;
  return BANDS[Math.min(19, Math.floor((latDeg + 80) / 8))] ?? null;
}

function utmProjection(zone: number, hemisphere: Hemisphere): TmProjection {
  return {
    lon0Deg: zone * 6 - 183,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: hemisphere === 'S' ? 10000000 : 0,
  };
}

/** WGS84 → UTM. Поза смугою 80S…84N — null (там працює UPS, не UTM). */
export function latLonToUtm(latDeg: number, lonDeg: number): UtmPoint | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if (!withinUtmLatitude(latDeg)) return null;
  const zone = utmZone(latDeg, lonDeg);
  const hemisphere: Hemisphere = latDeg < 0 ? 'S' : 'N';
  const { easting, northing } = tmForward(WGS84, utmProjection(zone, hemisphere), latDeg, lonDeg);
  return { zone, hemisphere, easting, northing };
}

/** UTM → WGS84 (потрібна сітці: лінії сталого easting/northing). */
export function utmToLatLon(p: UtmPoint): { latDeg: number; lonDeg: number } {
  return tmInverse(WGS84, utmProjection(p.zone, p.hemisphere), p.easting, p.northing);
}

const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'] as const;
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/** Літера колонки 100-км квадрата за easting. Поза 100…900 км — null. */
export function e100kLetter(zone: number, easting: number): string | null {
  const idx = Math.floor(easting / 100000);
  if (idx < 1 || idx > 8) return null;
  return COL_SETS[(zone - 1) % 3]?.[idx - 1] ?? null;
}

/** Літера рядка 100-км квадрата за northing (цикл 2000 км). */
export function n100kLetter(zone: number, northing: number): string | null {
  if (!Number.isFinite(northing) || northing < 0) return null;
  const idx = Math.floor(northing / 100000) % 20;
  const offset = zone % 2 === 0 ? 5 : 0;
  return ROW_LETTERS[(idx + offset) % 20] ?? null;
}

export type MgrsDigits = 1 | 2 | 3 | 4 | 5;

export interface MgrsRef {
  zone: number;
  band: string;
  square: string;
  /** Числові частини вже усічені до digits знаків. */
  easting: string;
  northing: string;
}

/**
 * WGS84 → MGRS. digits: 5 → 1 м, 4 → 10 м, … 1 → 10 км.
 * Числа УСІКАЮТЬСЯ (floor), не округлюються — так вимагає стандарт:
 * посилання називає квадрат, у якому лежить точка.
 */
export function latLonToMgrsRef(
  latDeg: number,
  lonDeg: number,
  digits: MgrsDigits = 5,
): MgrsRef | null {
  const band = latitudeBand(latDeg);
  const utm = latLonToUtm(latDeg, lonDeg);
  if (!band || !utm) return null;
  const col = e100kLetter(utm.zone, utm.easting);
  const row = n100kLetter(utm.zone, utm.northing);
  if (!col || !row) return null;
  const div = 10 ** (5 - digits);
  const e = Math.floor((utm.easting % 100000) / div);
  const n = Math.floor((utm.northing % 100000) / div);
  return {
    zone: utm.zone,
    band,
    square: `${col}${row}`,
    easting: String(e).padStart(digits, '0'),
    northing: String(n).padStart(digits, '0'),
  };
}

/** Компактний запис: `36UUA1234567890`. */
export function latLonToMgrs(
  latDeg: number,
  lonDeg: number,
  digits: MgrsDigits = 5,
): string | null {
  const ref = latLonToMgrsRef(latDeg, lonDeg, digits);
  if (!ref) return null;
  return `${ref.zone}${ref.band}${ref.square}${ref.easting}${ref.northing}`;
}

/** Читабельний запис із пробілами: `36U UA 12345 67890`. */
export function formatMgrs(ref: MgrsRef): string {
  return `${ref.zone}${ref.band} ${ref.square} ${ref.easting} ${ref.northing}`;
}
