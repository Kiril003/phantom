/**
 * Ф2 метрологія — UTM/MGRS проти зовнішніх еталонів.
 *
 * Джерела контрольних точок:
 *  1. CN Tower — Wikipedia, «Universal Transverse Mercator coordinate
 *     system»: 43°38′33.24″N 79°23′13.7″W (43.6425667, −79.387139) →
 *     зона 17, 630084 м сх., 4833438 м пн.
 *  2. Приклади man-сторінки GeoConvert (GeographicLib,
 *     geographiclib.sourceforge.io/C++/doc/GeoConvert.1.html):
 *       · 38SMB4488 ↔ 33.33424 44.40363 ↔ UTM 38n 444500 3688500
 *       · 79.9S 6.1E → 32CMS4328
 *       · lat −1, lon 3 → UTM 31s 500000 9889470
 *  3. Гонолулу — Wikipedia, «Military Grid Reference System»:
 *     зона 4Q, квадрат FJ.
 */
import { describe, expect, it } from 'vitest';

import {
  e100kLetter,
  latitudeBand,
  latLonToMgrs,
  latLonToMgrsRef,
  latLonToUtm,
  formatMgrs,
  n100kLetter,
  utmToLatLon,
  utmZone,
} from '../mgrs';
import { KRASOVSKY_1940, WGS84, meridianArc, tmForward } from '../tm';

describe('latLonToUtm — зовнішні еталони', () => {
  it('CN Tower (Wikipedia UTM): зона 17N, 630084 сх, 4833438 пн (±1.5 м)', () => {
    const utm = latLonToUtm(43.6425667, -79.387139);
    expect(utm).not.toBeNull();
    expect(utm!.zone).toBe(17);
    expect(utm!.hemisphere).toBe('N');
    expect(Math.abs(utm!.easting - 630084)).toBeLessThan(1.5);
    expect(Math.abs(utm!.northing - 4833438)).toBeLessThan(1.5);
  });

  it('GeoConvert: 33.33424N 44.40363E → 38n 444500 3688500 (±2 м)', () => {
    // Дві метрові координати «444500 3688500» — центр кілометрового
    // квадрата MB4488; широта/довгота в еталоні дані до 1e-5° (~1 м).
    const utm = latLonToUtm(33.33424, 44.40363);
    expect(utm).not.toBeNull();
    expect(utm!.zone).toBe(38);
    expect(utm!.hemisphere).toBe('N');
    expect(Math.abs(utm!.easting - 444500)).toBeLessThan(2);
    expect(Math.abs(utm!.northing - 3688500)).toBeLessThan(2);
  });

  it('GeoConvert: −1°, 3° → 31s 500000 9889470 (осьовий меридіан, південь)', () => {
    const utm = latLonToUtm(-1, 3);
    expect(utm).not.toBeNull();
    expect(utm!.zone).toBe(31);
    expect(utm!.hemisphere).toBe('S');
    // На осьовому меридіані easting точний за побудовою.
    expect(Math.abs(utm!.easting - 500000)).toBeLessThan(0.01);
    expect(Math.abs(utm!.northing - 9889470)).toBeLessThan(1);
  });
});

describe('latLonToMgrs — зовнішні еталони', () => {
  it('GeoConvert: центр 38SMB4488 повертається в 38SMB4488', () => {
    expect(latLonToMgrs(33.33424, 44.40363, 2)).toBe('38SMB4488');
  });

  it('GeoConvert: 79.9S 6.1E → 32CMS4328 (південь, смуга C)', () => {
    expect(latLonToMgrs(-79.9, 6.1, 2)).toBe('32CMS4328');
  });

  it('Wikipedia MGRS: Гонолулу лежить у 4QFJ', () => {
    expect(latLonToMgrs(21.3, -157.85, 5)).toMatch(/^4QFJ/);
  });

  it('formatMgrs розставляє пробіли: `38S MB 44 88`', () => {
    const ref = latLonToMgrsRef(33.33424, 44.40363, 2);
    expect(ref).not.toBeNull();
    expect(formatMgrs(ref!)).toBe('38S MB 44 88');
  });
});

describe('межі й винятки зон', () => {
  it('поза 80S…84N — null, а не вигадана координата', () => {
    expect(latLonToMgrs(85, 0)).toBeNull();
    expect(latLonToMgrs(-81, 0)).toBeNull();
    expect(latLonToUtm(84.1, 10)).toBeNull();
  });

  it('виняток Норвегії: 60N 5E → зона 32 (не 31)', () => {
    expect(utmZone(60, 5)).toBe(32);
    expect(utmZone(40, 5)).toBe(31);
  });

  it('виняток Шпіцбергена: 75N — зони 31/33/35/37', () => {
    expect(utmZone(75, 5)).toBe(31);
    expect(utmZone(75, 20)).toBe(33);
    expect(utmZone(75, 30)).toBe(35);
    expect(utmZone(75, 40)).toBe(37);
  });

  it('Україна: Київ у 36U, Львів у 35U', () => {
    expect(latitudeBand(50.45)).toBe('U');
    expect(utmZone(50.45, 30.52)).toBe(36);
    expect(utmZone(49.84, 24.03)).toBe(35);
  });
});

describe('літери 100-км квадратів (схема AA)', () => {
  it('перший рядок на північ від екватора: A в непарних зонах, F у парних', () => {
    expect(n100kLetter(1, 50000)).toBe('A');
    expect(n100kLetter(2, 50000)).toBe('F');
  });

  it('колонки циклюються через три зони: зона 1 → A…H, зона 2 → J…, зона 3 → S…', () => {
    expect(e100kLetter(1, 150000)).toBe('A');
    expect(e100kLetter(2, 150000)).toBe('J');
    expect(e100kLetter(3, 150000)).toBe('S');
    expect(e100kLetter(4, 150000)).toBe('A');
  });

  it('easting поза робочим діапазоном зони — null', () => {
    expect(e100kLetter(1, 50000)).toBeNull();
    expect(e100kLetter(1, 950000)).toBeNull();
  });
});

describe('круговий обхід і незалежні перевірки ядра', () => {
  it('latlon → utm → latlon сходиться краще за 5 мм по землі по сітці точок', () => {
    // Метрика — відстань по землі, не градуси: градус довготи на 80-й
    // широті у шість разів коротший, і допуск у градусах там бреше.
    // Обрізання серій Снайдера на краю зони лишає ~1 мм — на три
    // порядки краще за метрову роздільність MGRS.
    for (let lat = -76; lat <= 80; lat += 13) {
      for (let lon = -177; lon <= 177; lon += 23.5) {
        const utm = latLonToUtm(lat, lon);
        expect(utm).not.toBeNull();
        const back = utmToLatLon(utm!);
        const dNorth = (back.latDeg - lat) * 111132;
        const dEast = (back.lonDeg - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
        expect(Math.hypot(dNorth, dEast)).toBeLessThan(0.005);
      }
    }
  });

  it('серія дуги меридіана сходиться з чисельним інтегруванням (WGS84 і Красовський)', () => {
    // Незалежна постановка: M(φ) = ∫ a(1−e²)/(1−e²sin²φ)^{3/2} dφ,
    // інтегруємо Сімпсоном — жодного спільного коду з серією.
    const simpson = (ell: { a: number; f: number }, latDeg: number): number => {
      const e2 = ell.f * (2 - ell.f);
      const m = (phi: number): number =>
        (ell.a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(phi) ** 2, 1.5);
      const n = 20000;
      const h = (latDeg * Math.PI) / 180 / n;
      let sum = m(0) + m(latDeg * (Math.PI / 180));
      for (let i = 1; i < n; i++) sum += m(i * h) * (i % 2 === 0 ? 2 : 4);
      return (sum * h) / 3;
    };
    for (const ell of [WGS84, KRASOVSKY_1940]) {
      for (const lat of [10, 45, 50.45, 79.9]) {
        const series = meridianArc(ell, (lat * Math.PI) / 180);
        expect(Math.abs(series - simpson(ell, lat))).toBeLessThan(0.01);
      }
    }
  });

  it('northing на осьовому меридіані — рівно k0·M(φ)', () => {
    const proj = { lon0Deg: 33, k0: 0.9996, falseEasting: 500000, falseNorthing: 0 };
    const { easting, northing } = tmForward(WGS84, proj, 50.45, 33);
    expect(Math.abs(easting - 500000)).toBeLessThan(1e-6);
    expect(Math.abs(northing - 0.9996 * meridianArc(WGS84, (50.45 * Math.PI) / 180))).toBeLessThan(1e-6);
  });
});
