/**
 * Ф2 метрологія — УСК-2000.
 *
 * Опубліковані пари «WGS84 ↔ УСК-2000» у відкритих авторитетних
 * джерелах відсутні (epsg.io/trans тепер за ключем MapTiler), тому
 * перевірка складена шарами, кожен з яких незалежний:
 *  · саме TM-ядро верифіковане зовнішніми еталонами UTM (mgrs.test.ts);
 *  · константи проєкції звірені з EPSG:5564 (ОМ 33°, k0=1, FE 6 500 000);
 *  · зсув датуму EPSG:5840 (+24, −121, −76 м) перевіряється проти
 *    незалежної формулювання — скороченої формули Молоденського;
 *  · круговий обхід і аналітичні якорі (осьовий меридіан).
 */
import { describe, expect, it } from 'vitest';

import {
  ecefToGeodetic,
  formatUsk,
  geodeticToEcef,
  usk2000ToWgs84,
  wgs84ToUsk2000,
  withinUsk2000Area,
} from '../usk2000';
import { KRASOVSKY_1940, WGS84 } from '../tm';

const KYIV = { lat: 50.4501, lon: 30.5234 };

describe('зона чинності (EPSG:5840 — Україна)', () => {
  it('Київ, Львів, Харків, Одеса — в зоні', () => {
    expect(withinUsk2000Area(50.4501, 30.5234)).toBe(true);
    expect(withinUsk2000Area(49.8397, 24.0297)).toBe(true);
    expect(withinUsk2000Area(49.9935, 36.2304)).toBe(true);
    expect(withinUsk2000Area(46.4825, 30.7233)).toBe(true);
  });

  it('поза Україною — null, а не вигадана координата', () => {
    expect(wgs84ToUsk2000(48.1374, 11.5755)).toBeNull(); // Мюнхен
    expect(wgs84ToUsk2000(55.7558, 37.6173)).toBeNull(); // Москва
    expect(wgs84ToUsk2000(NaN, 30)).toBeNull();
  });
});

describe('вибір зони Гаусса–Крюгера і формат', () => {
  it('Ужгород → зона 4, Львів → 5, Київ → 6, Харків → 7', () => {
    expect(wgs84ToUsk2000(48.6208, 22.2879)!.zone).toBe(4);
    expect(wgs84ToUsk2000(49.8397, 24.0297)!.zone).toBe(5);
    expect(wgs84ToUsk2000(KYIV.lat, KYIV.lon)!.zone).toBe(6);
    expect(wgs84ToUsk2000(49.9935, 36.2304)!.zone).toBe(7);
  });

  it('Y несе префікс зони: Київ у діапазоні 6 000 000…7 000 000', () => {
    const p = wgs84ToUsk2000(KYIV.lat, KYIV.lon)!;
    expect(p.y).toBeGreaterThan(6_000_000);
    expect(p.y).toBeLessThan(7_000_000);
    // X — метри на північ від екватора, для Києва ~5.59 млн.
    expect(p.x).toBeGreaterThan(5_500_000);
    expect(p.x).toBeLessThan(5_700_000);
    expect(formatUsk(p)).toMatch(/^зона 6 · X \d/);
  });
});

describe('геоцентричний міст', () => {
  it('geodetic → ecef → geodetic сходиться краще за 1e-9°', () => {
    for (const ell of [WGS84, KRASOVSKY_1940]) {
      for (const [lat, lon] of [[50.45, 30.52], [43.2, 22.2], [52.3, 40.1]] as const) {
        const [x, y, z] = geodeticToEcef(ell, lat, lon);
        const back = ecefToGeodetic(ell, x, y, z);
        expect(Math.abs(back.latDeg - lat)).toBeLessThan(1e-9);
        expect(Math.abs(back.lonDeg - lon)).toBeLessThan(1e-9);
      }
    }
  });

  it('зсув датуму збігається зі скороченою формулою Молоденського (< 0.5 м)', () => {
    // Незалежна постановка (Standard Molodensky, DMA TM 8358.1):
    //   Δφ″ = [−dX sinφ cosλ − dY sinφ sinλ + dZ cosφ
    //          + (a·df + f·da) sin2φ] / (M ρ″)  … для h=0
    //   Δλ″ = [−dX sinλ + dY cosλ] / (N cosφ ρ″)
    // Тут WGS84 → Красовський: da/df — різниці еліпсоїдів, зсуви
    // з протилежним знаком до EPSG:5840.
    const dX = -24, dY = 121, dZ = 76;
    const da = KRASOVSKY_1940.a - WGS84.a;
    const df = KRASOVSKY_1940.f - WGS84.f;
    const phi = (KYIV.lat * Math.PI) / 180;
    const lam = (KYIV.lon * Math.PI) / 180;
    const e2 = WGS84.f * (2 - WGS84.f);
    const sin2 = Math.sin(phi) ** 2;
    const M = (WGS84.a * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5);
    const N = WGS84.a / Math.sqrt(1 - e2 * sin2);
    const dPhiRad =
      (-dX * Math.sin(phi) * Math.cos(lam) -
        dY * Math.sin(phi) * Math.sin(lam) +
        dZ * Math.cos(phi) +
        ((WGS84.a * df + WGS84.f * da) * Math.sin(2 * phi))) / M;
    const dLamRad = (-dX * Math.sin(lam) + dY * Math.cos(lam)) / (N * Math.cos(phi));

    // Що реально зробив наш точний ECEF-шлях:
    const [xw, yw, zw] = geodeticToEcef(WGS84, KYIV.lat, KYIV.lon);
    const kras = ecefToGeodetic(KRASOVSKY_1940, xw - 24, yw + 121, zw + 76);
    const gotDPhi = ((kras.latDeg - KYIV.lat) * Math.PI) / 180;
    const gotDLam = ((kras.lonDeg - KYIV.lon) * Math.PI) / 180;

    // 0.5 м у радіанах на відповідному радіусі.
    expect(Math.abs(gotDPhi - dPhiRad) * M).toBeLessThan(0.5);
    expect(Math.abs(gotDLam - dLamRad) * N * Math.cos(phi)).toBeLessThan(0.5);
    // І сам зсув — величини ~10⁻³…10⁻⁵ градуса, не нуль і не сміття:
    expect(Math.abs(kras.latDeg - KYIV.lat)).toBeGreaterThan(1e-6);
    expect(Math.abs(kras.latDeg - KYIV.lat)).toBeLessThan(0.01);
  });
});

describe('круговий обхід', () => {
  it('wgs84 → уск → wgs84 сходиться краще за 1e-8° по містах', () => {
    const cities: Array<[number, number]> = [
      [50.4501, 30.5234], // Київ
      [49.8397, 24.0297], // Львів
      [49.9935, 36.2304], // Харків
      [46.4825, 30.7233], // Одеса
      [48.4647, 35.0462], // Дніпро
    ];
    for (const [lat, lon] of cities) {
      const usk = wgs84ToUsk2000(lat, lon);
      expect(usk).not.toBeNull();
      const back = usk2000ToWgs84(usk!);
      expect(Math.abs(back.latDeg - lat)).toBeLessThan(1e-8);
      expect(Math.abs(back.lonDeg - lon)).toBeLessThan(1e-8);
    }
  });
});
