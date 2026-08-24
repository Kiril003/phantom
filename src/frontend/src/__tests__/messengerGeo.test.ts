/**
 * Закон №3 контракту симбіозу: вік точки видимий, і в нього є числа.
 *
 * Свіжа — не старша за 90 секунд від часу ВИМІРУ. Точка зі скриньки застаріла
 * завжди, навіть якщо доїхала за секунду: вона з минулого відносно каналу,
 * який щойно був мертвий.
 */
import { describe, it, expect } from 'vitest';
import {
  FRESH_WINDOW_MS,
  ageLabel,
  geoPointBody,
  isStale,
  mapHref,
  parseGeoPoint,
} from '../services/messengerGeo';

const NOW = Date.UTC(2026, 7, 24, 11, 32, 0);
const point = (atMs: number) => ({ lat: 50.4501, lon: 30.5234, atMs });

describe('розбір тіла geo:point', () => {
  it('читає координати, час виміру, точність і підпис', () => {
    const parsed = parseGeoPoint(
      JSON.stringify({ lat: 50.4501, lon: 30.5234, at: NOW, acc: 12, label: ' дім ' }),
    );
    expect(parsed).toEqual({
      lat: 50.4501,
      lon: 30.5234,
      atMs: NOW,
      accuracyM: 12,
      label: 'дім',
    });
  });

  it.each([
    ['порожнє тіло', ''],
    ['не JSON', 'десь поруч'],
    ['без довготи', JSON.stringify({ lat: 50.4501, at: NOW })],
    ['без часу виміру', JSON.stringify({ lat: 50.4501, lon: 30.5234 })],
    ['координати рядком', JSON.stringify({ lat: '50.45', lon: '30.52', at: NOW })],
    ['широта поза межами', JSON.stringify({ lat: 91, lon: 30.5, at: NOW })],
    ['довгота поза межами', JSON.stringify({ lat: 50.4, lon: 181, at: NOW })],
  ])('%s — це не точка', (_name, body) => {
    expect(parseGeoPoint(body)).toBeNull();
  });

  it('тіло для відправки везе `at`, а не час надсилання', () => {
    expect(JSON.parse(geoPointBody({ lat: 50.4501, lon: 30.5234, atMs: NOW, accuracyM: 9 })))
      .toEqual({ lat: 50.4501, lon: 30.5234, at: NOW, acc: 9 });
  });
});

describe('вік точки', () => {
  it('свіжа, поки не минуло 90 секунд від виміру', () => {
    expect(isStale(point(NOW - 89_000), { nowMs: NOW })).toBe(false);
    expect(isStale(point(NOW - FRESH_WINDOW_MS), { nowMs: NOW })).toBe(false);
  });

  it('за 90 секундою — застаріла', () => {
    expect(isStale(point(NOW - FRESH_WINDOW_MS - 1), { nowMs: NOW })).toBe(true);
  });

  it('свіжа каже «щойно», застаріла — «станом на» з часом виміру', () => {
    expect(ageLabel(point(NOW - 5_000), { nowMs: NOW })).toContain('щойно');
    const stale = ageLabel(point(NOW - 20 * 60_000), { nowMs: NOW });
    expect(stale).toContain('станом на');
    // Час у підписі — виміру (11:12 UTC), а не показу.
    expect(stale).toContain(
      new Date(NOW - 20 * 60_000).toLocaleTimeString('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('точка зі скриньки застаріла навіть за секунду після виміру', () => {
    expect(isStale(point(NOW - 1_000), { nowMs: NOW, viaMailbox: true })).toBe(true);
    expect(ageLabel(point(NOW - 1_000), { nowMs: NOW, viaMailbox: true })).toContain('станом на');
  });
});

describe('перехід на мапу', () => {
  it('несе координати і час виміру параметрами, без зовнішніх запитів', () => {
    const href = mapHref({ lat: 50.4501, lon: 30.5234, atMs: NOW, label: 'дім' });
    expect(href.startsWith('/map?')).toBe(true);
    const params = new URLSearchParams(href.slice('/map?'.length));
    expect(params.get('lat')).toBe('50.4501');
    expect(params.get('lon')).toBe('30.5234');
    expect(params.get('at')).toBe(String(NOW));
    expect(params.get('label')).toBe('дім');
  });
});
