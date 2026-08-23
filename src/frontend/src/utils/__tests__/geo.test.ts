/**
 * Ф2 метрологія — сферична геодезія лінійки.
 */
import { describe, expect, it } from 'vitest';

import {
  formatAzimuth,
  formatKm,
  formatLatLonUa,
  haversineKm,
  initialBearingDeg,
  measurePath,
} from '../geo';

describe('haversineKm', () => {
  it('градус меридіана ≈ 111.2 км', () => {
    const km = haversineKm({ lat: 50, lon: 30 }, { lat: 51, lon: 30 });
    expect(km).toBeGreaterThan(111);
    expect(km).toBeLessThan(111.4);
  });

  it('Київ ↔ Львів ≈ 468 км (±5)', () => {
    const km = haversineKm({ lat: 50.4501, lon: 30.5234 }, { lat: 49.8397, lon: 24.0297 });
    expect(Math.abs(km - 468)).toBeLessThan(5);
  });

  it('нульова відстань до самої себе', () => {
    expect(haversineKm({ lat: 50, lon: 30 }, { lat: 50, lon: 30 })).toBe(0);
  });
});

describe('initialBearingDeg — істинний азимут', () => {
  it('кардинальні напрямки точні: 0, 90, 180, 270', () => {
    const o = { lat: 0, lon: 0 };
    expect(initialBearingDeg(o, { lat: 10, lon: 0 })).toBeCloseTo(0, 10);
    expect(initialBearingDeg(o, { lat: 0, lon: 10 })).toBeCloseTo(90, 10);
    expect(initialBearingDeg(o, { lat: -10, lon: 0 })).toBeCloseTo(180, 10);
    expect(initialBearingDeg(o, { lat: 0, lon: -10 })).toBeCloseTo(270, 10);
  });

  it('меридіан — 0/180 на будь-якій широті (точна властивість)', () => {
    expect(initialBearingDeg({ lat: 50.45, lon: 30.52 }, { lat: 51, lon: 30.52 })).toBeCloseTo(0, 10);
    expect(initialBearingDeg({ lat: 50.45, lon: 30.52 }, { lat: 49, lon: 30.52 })).toBeCloseTo(180, 10);
  });

  it('мала база сходиться з незалежним планарним наближенням', () => {
    // atan2(Δλ·cosφ, Δφ) — інша постановка тієї ж задачі на «пласкій»
    // землі; для бази ~100 м розбіжність зі сферою — соті градуса.
    const a = { lat: 50.45, lon: 30.52 };
    const b = { lat: 50.4507, lon: 30.5211 };
    const planar =
      ((Math.atan2(
        (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180),
        b.lat - a.lat,
      ) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(initialBearingDeg(a, b) - planar)).toBeLessThan(0.05);
  });

  it('на схід уздовж 50-ї паралелі курс > 90° не одразу: старт трохи північніше сходу', () => {
    // Велике коло на схід із півночі виходить під азимутом < 90°.
    const az = initialBearingDeg({ lat: 50, lon: 30 }, { lat: 50, lon: 40 });
    expect(az).toBeGreaterThan(85);
    expect(az).toBeLessThan(90);
  });
});

describe('measurePath', () => {
  it('порожньо і одна точка — нуль сегментів, нуль суми', () => {
    expect(measurePath([]).segments).toHaveLength(0);
    expect(measurePath([{ lat: 50, lon: 30 }]).totalKm).toBe(0);
  });

  it('три точки — два сегменти, сума збігається', () => {
    const m = measurePath([
      { lat: 50, lon: 30 },
      { lat: 50.1, lon: 30 },
      { lat: 50.1, lon: 30.2 },
    ]);
    expect(m.segments).toHaveLength(2);
    expect(m.totalKm).toBeCloseTo(m.segments[0].km + m.segments[1].km, 10);
    expect(m.segments[0].azimuthDeg).toBeCloseTo(0, 6);
    expect(m.segments[1].azimuthDeg).toBeGreaterThan(85);
    expect(m.segments[1].azimuthDeg).toBeLessThan(95);
  });
});

describe('формати', () => {
  it('formatKm: м до кілометра, далі десяті/цілі', () => {
    expect(formatKm(0.843)).toBe('843 м');
    expect(formatKm(2.412)).toBe('2.41 км');
    expect(formatKm(12.44)).toBe('12.4 км');
    expect(formatKm(843.4)).toBe('843 км');
  });

  it('formatAzimuth: три знаки, 360 → 000', () => {
    expect(formatAzimuth(7.4)).toBe('007°');
    expect(formatAzimuth(213)).toBe('213°');
    expect(formatAzimuth(359.7)).toBe('000°');
  });

  it('formatLatLonUa: півкулі словом, п’ять знаків', () => {
    expect(formatLatLonUa(50.4501, 30.5234)).toBe('50.45010° пн · 30.52340° сх');
    expect(formatLatLonUa(-33.9249, -70.6693)).toBe('33.92490° пд · 70.66930° зх');
  });
});
