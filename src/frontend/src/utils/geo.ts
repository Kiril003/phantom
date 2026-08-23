/**
 * Сферична геодезія для вимірювань HUD: відстань (гаверсинус) і
 * істинний азимут (початковий курс великого кола). Сфера радіуса
 * 6371.0088 км (середній радіус IUGG) дає похибку відстані < 0.5%
 * проти еліпсоїда — чесно для лінійки; сантиметрова геодезія тут
 * не обіцяється і не малюється.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

const R_KM = 6371.0088;
const D2R = Math.PI / 180;

/** Відстань великого кола між точками, км. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Істинний азимут з a на b — початковий курс великого кола,
 * градуси 0…360 від географічної півночі за годинниковою стрілкою.
 */
export function initialBearingDeg(a: GeoPoint, b: GeoPoint): number {
  const phi1 = a.lat * D2R;
  const phi2 = b.lat * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface PathSegment {
  from: GeoPoint;
  to: GeoPoint;
  km: number;
  azimuthDeg: number;
}

export interface PathMeasure {
  segments: PathSegment[];
  totalKm: number;
}

/** Ламана лінійки: посегментні відстані/азимути й сума. */
export function measurePath(points: GeoPoint[]): PathMeasure {
  const segments: PathSegment[] = [];
  let totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const km = haversineKm(from, to);
    segments.push({ from, to, km, azimuthDeg: initialBearingDeg(from, to) });
    totalKm += km;
  }
  return { segments, totalKm };
}

/** «843 м» до кілометра, «2.41 км» до 10 км, далі «12.4 км», «843 км». */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} м`;
  if (km < 10) return `${km.toFixed(2)} км`;
  if (km < 100) return `${km.toFixed(1)} км`;
  return `${Math.round(km)} км`;
}

/** «213°» — цілі градуси, три знаки для моно-вирівнювання. */
export function formatAzimuth(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}

/**
 * «50.45013° пн · 30.52341° сх» — п'ять знаків після коми (~1 м).
 * Від'ємні значення підписуються пд/зх, знак у число не тягнеться.
 */
export function formatLatLonUa(lat: number, lon: number): string {
  const ns = lat < 0 ? 'пд' : 'пн';
  const ew = lon < 0 ? 'зх' : 'сх';
  return `${Math.abs(lat).toFixed(5)}° ${ns} · ${Math.abs(lon).toFixed(5)}° ${ew}`;
}
