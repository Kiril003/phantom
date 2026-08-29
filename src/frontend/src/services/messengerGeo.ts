/**
 * Точка «я тут» у стрічці: розбір тіла кадру і ЧЕСНИЙ вік.
 *
 * Закон №3 контракту симбіозу: вік точки видимий, і в нього є числа. Свіжою
 * точка лишається 90 секунд від часу ВИМІРУ; далі — приглушений тон і підпис
 * «станом на 14:32». Точка, що приїхала зі скриньки, народжується застарілою
 * завжди: вона з минулого відносно каналу, який щойно був мертвий, — навіть
 * якщо доїхала за секунду після виміру.
 */

import type { GeoPoint } from '../types/messenger';

export const FRESH_WINDOW_MS = 90_000;

const finite = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

/** Тіло кадру → точка. Неповне або несхоже на координати — null, без вигадок. */
export function parseGeoPoint(body?: string | null): GeoPoint | null {
  if (!body) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const row = raw as Record<string, unknown>;
  const lat = finite(row.lat);
  const lon = finite(row.lon);
  const at = finite(row.at);
  if (lat === null || lon === null || at === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || at <= 0) return null;

  const acc = finite(row.acc);
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  return {
    lat,
    lon,
    atMs: Math.round(at),
    ...(acc !== null && acc >= 0 ? { accuracyM: acc } : {}),
    ...(label ? { label: label.slice(0, 120) } : {}),
  };
}

/** Тіло для відправки. Імена полів на дроті — як у контракті. */
export function geoPointBody(point: GeoPoint): string {
  return JSON.stringify({
    lat: point.lat,
    lon: point.lon,
    at: point.atMs,
    ...(point.accuracyM !== undefined ? { acc: point.accuracyM } : {}),
    ...(point.label ? { label: point.label } : {}),
  });
}

export interface GeoAgeInput {
  nowMs?: number;
  /** Кадр приїхав дорогою «скринька» — див. transport рядка з вузла. */
  viaMailbox?: boolean;
}

export function isStale(point: GeoPoint, { nowMs, viaMailbox }: GeoAgeInput = {}): boolean {
  if (viaMailbox) return true;
  return (nowMs ?? Date.now()) - point.atMs > FRESH_WINDOW_MS;
}

const clock = (atMs: number): string =>
  new Date(atMs).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

/** Підпис віку: «щойно · 14:32» або «станом на 14:32». Час — завжди виміру. */
export function ageLabel(point: GeoPoint, input: GeoAgeInput = {}): string {
  return isStale(point, input)
    ? `станом на ${clock(point.atMs)}`
    : `щойно · ${clock(point.atMs)}`;
}

export const coordsLabel = (point: GeoPoint): string =>
  `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;

/**
 * Куди веде «Відкрити на мапі». Мапу малює ATLAS — тут лише передача точки
 * параметрами, без жодного зовнішнього запиту по її координатах (закон №1).
 */
export function mapHref(point: GeoPoint): string {
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lon),
    at: String(point.atMs),
  });
  if (point.label) params.set('label', point.label);
  return `/map?${params.toString()}`;
}
