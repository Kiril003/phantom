/**
 * УСК-2000 — Українська система координат 2000 року, площинні
 * координати Гаусса–Крюгера в 6°-зонах (EPSG:5562–5565).
 *
 * Ланцюг конверсії з WGS84:
 *   1. геодезичні → геоцентричні XYZ на еліпсоїді WGS84 (h = 0);
 *   2. зсув датуму — EPSG:5840 «UCS-2000 to WGS 84 (2)», метод
 *      Geocentric translations: dX = +24 м, dY = −121 м, dZ = −76 м
 *      у напрямку УСК-2000 → WGS84 (тут застосовується обернено);
 *      заявлена точність трансформації — 1.0 м;
 *   3. XYZ → геодезичні на еліпсоїді Красовського 1940
 *      (a = 6378245, 1/f = 298.3);
 *   4. проєкція Гаусса–Крюгера: осьовий меридіан 6n−3, k0 = 1,
 *      умовний схід n·1 000 000 + 500 000 (звірено з EPSG:5564 —
 *      «UCS-2000 / Gauss-Kruger zone 6», ОМ 33°, FE 6 500 000).
 *
 * Зона чинності — територія України за EPSG:5840
 * (43.18…52.38° пн. ш., 22.15…40.18° сх. д.). Поза нею конверсія
 * чесно повертає null: продовжувати трансформацію, параметри якої
 * визначені лише для України, було б вигаданою координатою.
 *
 * Запис координат — за традицією Гаусса–Крюгера: X — на північ від
 * екватора, Y — на схід із префіксом номера зони.
 */

import {
  KRASOVSKY_1940,
  WGS84,
  tmForward,
  tmInverse,
  type Ellipsoid,
  type TmProjection,
} from './tm';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** EPSG:5840, напрямок УСК-2000 → WGS84, метри. */
const DX = 24;
const DY = -121;
const DZ = -76;

/** Зона чинності EPSG:5840 — Україна, суходіл і море. */
export const USK2000_AREA = {
  latMin: 43.18,
  latMax: 52.38,
  lonMin: 22.15,
  lonMax: 40.18,
} as const;

export function withinUsk2000Area(latDeg: number, lonDeg: number): boolean {
  return (
    latDeg >= USK2000_AREA.latMin &&
    latDeg <= USK2000_AREA.latMax &&
    lonDeg >= USK2000_AREA.lonMin &&
    lonDeg <= USK2000_AREA.lonMax
  );
}

/** Геодезичні (h=0) → геоцентричні XYZ, м. */
export function geodeticToEcef(
  ell: Ellipsoid,
  latDeg: number,
  lonDeg: number,
): [number, number, number] {
  const e2 = ell.f * (2 - ell.f);
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const sinLat = Math.sin(lat);
  const N = ell.a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return [
    N * Math.cos(lat) * Math.cos(lon),
    N * Math.cos(lat) * Math.sin(lon),
    N * (1 - e2) * sinLat,
  ];
}

/** Геоцентричні XYZ → геодезичні (ітеративно; збіжність — частки мм). */
export function ecefToGeodetic(
  ell: Ellipsoid,
  x: number,
  y: number,
  z: number,
): { latDeg: number; lonDeg: number } {
  const e2 = ell.f * (2 - ell.f);
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(lat);
    const N = ell.a / Math.sqrt(1 - e2 * sinLat * sinLat);
    lat = Math.atan2(z + e2 * N * sinLat, p);
  }
  return { latDeg: lat * R2D, lonDeg: lon * R2D };
}

function gkProjection(zone: number): TmProjection {
  return {
    lon0Deg: zone * 6 - 3,
    k0: 1,
    falseEasting: zone * 1_000_000 + 500_000,
    falseNorthing: 0,
  };
}

export interface UskPoint {
  /** Номер 6°-зони Гаусса–Крюгера (Україна — 4…7). */
  zone: number;
  /** X — відстань на північ від екватора, м. */
  x: number;
  /** Y — схід із префіксом зони (зона 6 → 6 5xx xxx), м. */
  y: number;
}

/**
 * WGS84 → УСК-2000. Поза зоною чинності трансформації — null.
 * Сукупна точність обмежена EPSG:5840 — близько 1 м.
 */
export function wgs84ToUsk2000(latDeg: number, lonDeg: number): UskPoint | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if (!withinUsk2000Area(latDeg, lonDeg)) return null;
  const [xw, yw, zw] = geodeticToEcef(WGS84, latDeg, lonDeg);
  // Обернений напрямок EPSG:5840: WGS84 → УСК-2000.
  const kras = ecefToGeodetic(KRASOVSKY_1940, xw - DX, yw - DY, zw - DZ);
  const zone = Math.floor(kras.lonDeg / 6) + 1;
  const { easting, northing } = tmForward(
    KRASOVSKY_1940,
    gkProjection(zone),
    kras.latDeg,
    kras.lonDeg,
  );
  return { zone, x: northing, y: easting };
}

/** УСК-2000 → WGS84 (для тестів кругового обходу та сітки). */
export function usk2000ToWgs84(p: UskPoint): { latDeg: number; lonDeg: number } {
  const kras = tmInverse(KRASOVSKY_1940, gkProjection(p.zone), p.y, p.x);
  const [xk, yk, zk] = geodeticToEcef(KRASOVSKY_1940, kras.latDeg, kras.lonDeg);
  // Прямий напрямок EPSG:5840: УСК-2000 → WGS84.
  return ecefToGeodetic(WGS84, xk + DX, yk + DY, zk + DZ);
}

/** Читабельний запис: `зона 6 · X 5 590 128 · Y 6 324 041` (метри цілі). */
export function formatUsk(p: UskPoint): string {
  const num = (v: number): string =>
    Math.round(v).toLocaleString('uk-UA').replace(/ /g, ' ');
  return `зона ${p.zone} · X ${num(p.x)} · Y ${num(p.y)}`;
}
