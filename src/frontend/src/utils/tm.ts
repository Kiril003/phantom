/**
 * Поперечна проєкція Меркатора — спільне математичне ядро для двох
 * систем координат HUD-метрології:
 *   · UTM/MGRS на еліпсоїді WGS84 (utils/mgrs.ts);
 *   · Гаусса–Крюгера УСК-2000 на еліпсоїді Красовського 1940
 *     (utils/usk2000.ts, EPSG:5562–5565).
 *
 * Серії — Снайдер, «Map Projections: A Working Manual» (USGS PP 1395,
 * формули 8-9…8-25): точність у межах зони — міліметри, що на два
 * порядки краще за метрову роздільність MGRS і за заявлену точність
 * трансформації EPSG:5840 (1.0 м).
 *
 * Ядро одне навмисно: зовнішні контрольні точки UTM (mgrs.test.ts —
 * CN Tower з Wikipedia, приклади GeoConvert) верифікують саме ці
 * серії; шлях УСК-2000 додає до них лише інші константи еліпсоїда
 * і зсув датуму, кожен зі своїм незалежним тестом.
 */

export interface Ellipsoid {
  /** Велика піввісь, м. */
  a: number;
  /** Стиснення (1/f — обернене стиснення). */
  f: number;
}

/** WGS84: a=6378137, 1/f=298.257223563. */
export const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };

/** Красовський 1940 (ГОСТ, база УСК-2000): a=6378245, 1/f=298.3. */
export const KRASOVSKY_1940: Ellipsoid = { a: 6378245, f: 1 / 298.3 };

export interface TmProjection {
  /** Довгота осьового меридіана, градуси. */
  lon0Deg: number;
  /** Масштаб на осьовому меридіані (UTM 0.9996, Гаусс–Крюгер 1). */
  k0: number;
  falseEasting: number;
  falseNorthing: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Нормалізує довготу в діапазон [-180, 180). */
export function normalizeLonDeg(lonDeg: number): number {
  return ((lonDeg % 360) + 540) % 360 - 180;
}

/**
 * Довжина дуги меридіана від екватора до широти latRad (м).
 * Експортована окремо: usk2000.test.ts звіряє її з незалежним
 * чисельним інтегруванням M(φ) на еліпсоїді Красовського.
 */
export function meridianArc(ell: Ellipsoid, latRad: number): number {
  const { a, f } = ell;
  const e2 = f * (2 - f);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
    ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
    ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
    ((35 * e6) / 3072) * Math.sin(6 * latRad)
  );
}

export interface TmXY {
  easting: number;
  northing: number;
}

/** Пряма проєкція: широта/довгота (градуси) → площинні координати (м). */
export function tmForward(
  ell: Ellipsoid,
  proj: TmProjection,
  latDeg: number,
  lonDeg: number,
): TmXY {
  const { a, f } = ell;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat = latDeg * D2R;
  const dLon = normalizeLonDeg(lonDeg - proj.lon0Deg) * D2R;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ep2 * cosLat * cosLat;
  const A = dLon * cosLat;
  const M = meridianArc(ell, lat);

  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A2 * A2;
  const A5 = A4 * A;
  const A6 = A4 * A2;

  const easting =
    proj.falseEasting +
    proj.k0 * N * (
      A +
      ((1 - T + C) * A3) / 6 +
      ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120
    );
  const northing =
    proj.falseNorthing +
    proj.k0 * (
      M +
      N * tanLat * (
        A2 / 2 +
        ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
        ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720
      )
    );
  return { easting, northing };
}

export interface LatLonDeg {
  latDeg: number;
  lonDeg: number;
}

/** Обернена проєкція: площинні координати (м) → широта/довгота (градуси). */
export function tmInverse(
  ell: Ellipsoid,
  proj: TmProjection,
  easting: number,
  northing: number,
): LatLonDeg {
  const { a, f } = ell;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const M = (northing - proj.falseNorthing) / proj.k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_2 * e1_2;
  // Широта основи (footpoint latitude), Снайдер 3-26.
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1_3) / 32) * Math.sin(2 * mu) +
    ((21 * e1_2) / 16 - (55 * e1_4) / 32) * Math.sin(4 * mu) +
    ((151 * e1_3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1_4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = ep2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = (easting - proj.falseEasting) / (N1 * proj.k0);

  const D2 = D * D;
  const D3 = D2 * D;
  const D4 = D2 * D2;
  const D5 = D4 * D;
  const D6 = D4 * D2;

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) * (
      D2 / 2 -
      ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4) / 24 +
      ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6) / 720
    );
  const lon =
    proj.lon0Deg * D2R +
    (
      D -
      ((1 + 2 * T1 + C1) * D3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5) / 120
    ) / cosPhi1;

  return { latDeg: lat * R2D, lonDeg: normalizeLonDeg(lon * R2D) };
}
