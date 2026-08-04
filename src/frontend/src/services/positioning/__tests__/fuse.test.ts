import { describe, expect, it } from 'vitest';
import { consistencyGate, distanceM, fuse } from '../fuse';
import { apDistanceM, networkIsWide, positionFromAps } from '../wifi';
import type { PositionCandidate } from '../types';

const NOW = Date.parse('2026-07-21T12:00:00Z');
const KYIV = { lat: 50.4501, lon: 30.5234 };
const LIMA = { lat: -12.0464, lon: -77.0428 };

const cand = (p: Partial<PositionCandidate> & Pick<PositionCandidate, 'kind' | 'lat' | 'lon'>): PositionCandidate => ({
  accuracyM: 20,
  at: NOW,
  ...p,
});

describe('відстань', () => {
  it('рахує знайому пару з точністю до кілометра', () => {
    const d = distanceM(KYIV.lat, KYIV.lon, LIMA.lat, LIMA.lon);
    expect(d / 1000).toBeGreaterThan(11_800);
    expect(d / 1000).toBeLessThan(12_400);
  });
});

describe('ворота узгодженості', () => {
  it('ловить живий запис 21.07.2026: приймач у Лімі, мережа в Києві', () => {
    const out = consistencyGate([
      cand({ kind: 'gnss', ...LIMA, accuracyM: 998_389 }),
      cand({ kind: 'wifi', ...KYIV, accuracyM: 120 }),
    ], NOW);
    expect(out.spoofSuspected).toBe(true);
    expect(out.distrust.has('gnss')).toBe(true);
    expect(out.findings.some((f) => f.level === 'alarm')).toBe(true);
  });

  it('мовчить, коли джерела згодні', () => {
    const out = consistencyGate([
      cand({ kind: 'gnss', lat: 50.4501, lon: 30.5234, accuracyM: 8 }),
      cand({ kind: 'wifi', lat: 50.4503, lon: 30.5239, accuracyM: 90 }),
    ], NOW);
    expect(out.spoofSuspected).toBe(false);
    expect(out.distrust.size).toBe(0);
  });

  it('не б’є на сполох через саму лише широку похибку', () => {
    const out = consistencyGate([cand({ kind: 'browser', ...KYIV, accuracyM: 2300 })], NOW);
    expect(out.spoofSuspected).toBe(false);
  });

  it('відкидає стрибок, якого не буває', () => {
    const previous = fuse([cand({ kind: 'phone', ...KYIV, accuracyM: 10 })], NOW)!;
    const out = consistencyGate(
      [cand({ kind: 'phone', lat: 51.5, lon: 31.9, accuracyM: 10, at: NOW + 4000 })],
      NOW + 4000,
      previous,
    );
    expect(out.distrust.has('phone')).toBe(true);
    expect(out.findings.some((f) => /км\/год/.test(f.text))).toBe(true);
  });
});

describe('злиття', () => {
  it('віддає перевагу телефону перед браузером, коли вони згодні', () => {
    const f = fuse([
      cand({ kind: 'browser', lat: 50.5039, lon: 30.4095, accuracyM: 2300, label: 'браузер' }),
      cand({ kind: 'phone', lat: 50.4501, lon: 30.5234, accuracyM: 12 }),
    ], NOW)!;
    expect(f.kind).toBe('phone');
    expect(f.accuracyM).toBe(12);
    expect(f.confidence).toBeGreaterThan(0.4);
  });

  it('під час підміни лишається на мережі й падає в упевненості', () => {
    const f = fuse([
      cand({ kind: 'gnss', ...LIMA, accuracyM: 998_389 }),
      cand({ kind: 'wifi', ...KYIV, accuracyM: 120 }),
    ], NOW)!;
    expect(f.spoofSuspected).toBe(true);
    expect(f.kind).toBe('wifi');
    expect(distanceM(f.lat, f.lon, KYIV.lat, KYIV.lon)).toBeLessThan(200);
    expect(f.confidence).toBeLessThan(0.4);
  });

  it('свіже грубе джерело б’є застаріле точне', () => {
    const f = fuse([
      cand({ kind: 'gnss', lat: 50.40, lon: 30.40, accuracyM: 8, at: NOW - 20 * 60_000 }),
      cand({ kind: 'wifi', ...KYIV, accuracyM: 150, at: NOW }),
    ], NOW)!;
    expect(f.kind).toBe('wifi');
  });

  it('без жодного джерела повертає null, а не вигадану точку', () => {
    expect(fuse([], NOW)).toBeNull();
    expect(fuse([cand({ kind: 'gnss', lat: NaN, lon: 30 })], NOW)).toBeNull();
  });
});

describe('Wi-Fi', () => {
  it('тягнеться до найсильнішої точки, а не в центр мережі', () => {
    const near = { bssid: 'aa', ssid: 'під’їзд', rssiDbm: -42, lat: 50.4501, lon: 30.5234 };
    const far = { bssid: 'bb', ssid: 'той самий провайдер', rssiDbm: -86, lat: 50.4600, lon: 30.5400 };
    const p = positionFromAps([near, far], NOW)!;
    expect(distanceM(p.lat, p.lon, near.lat, near.lon)).toBeLessThan(
      distanceM(p.lat, p.lon, far.lat, far.lon),
    );
    expect(p.strongestAp?.bssid).toBe('aa');
  });

  it('оцінка відстані росте зі слабшим сигналом', () => {
    expect(apDistanceM(-40)).toBeLessThan(apDistanceM(-70));
    expect(apDistanceM(-95)).toBeLessThanOrEqual(500);
  });

  it('впізнає мережу, розтягнуту на район', () => {
    expect(networkIsWide([
      { bssid: 'a', rssiDbm: -50, lat: 50.4501, lon: 30.5234 },
      { bssid: 'b', rssiDbm: -70, lat: 50.4601, lon: 30.5434 },
    ])).toBe(true);
    expect(networkIsWide([
      { bssid: 'a', rssiDbm: -50, lat: 50.4501, lon: 30.5234 },
      { bssid: 'b', rssiDbm: -70, lat: 50.4503, lon: 30.5237 },
    ])).toBe(false);
  });

  it('без відомих координат точок не вигадує місце', () => {
    expect(positionFromAps([{ bssid: 'a', rssiDbm: -50 }], NOW)).toBeNull();
  });
});
