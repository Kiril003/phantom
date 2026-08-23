import { useEffect, useRef, useState } from 'react';
import { useHudMap } from './useHudMap';
import { useSettingsStore } from '../../../stores/settingsStore';
import {
  e100kLetter,
  latitudeBand,
  latLonToUtmForced,
  n100kLetter,
  utmToLatLon,
  type Hemisphere,
} from '../../../utils/mgrs';

/**
 * Ф2 метрологія, У6 — графічна сітка MGRS.
 *
 * Canvas-оверлей поверх пейна (та сама причина, що й у лінійки: шари,
 * дописані в стиль MapLibre, стираються кожною перебудовою стилю).
 * Лінії — справжні лінії сталого easting/northing UTM: обчислюються
 * оберненою проєкцією (utils/mgrs.ts, з тестами проти еталонів) і
 * проєктуються назад через map.project(), тому чесно кривляться там,
 * де сітка кривиться насправді, і живуть при повороті/нахилі камери.
 *
 * Крок сітки чесний до масштабу: 100 м → 1 км → 10 км → 100 км; на
 * 100-км кроці клітини підписуються повним ідентифікатором квадрата
 * (36U CA), на дрібніших — кілометровими цифрами по краях. Коли навіть
 * 100-км лінії злипаються (дрібні зуми), сітка вимикається СЛОВОМ, а
 * не малює кашу; поза смугою UTM (84° пн — 80° пд) — теж словом.
 *
 * Відома межа: у широтах винятків UTM (Норвегія 32V, Шпіцберген) зрізи
 * зон беруться стандартними 6°-межами — для театру України винятки
 * недосяжні, а малювати їхню особливу нарізку без еталона було б
 * вигадкою.
 */

const CANDIDATE_SPACINGS = [100, 1000, 10000, 100000] as const;
/**
 * Мінімальна відстань між лініями, щоб сітка читалась, а не зливалась.
 * 60 px впускає 100-метровий крок уже на z≈16 (місто впритул) — на
 * кадрі стенда z16 із порогом 70 сітка трималась кілометрової і
 * показувала дві лінії на весь екран.
 */
const MIN_LINE_PX = 60;

/** Крок сітки (м) для масштабу; null — чесно «не малюємо». */
export function chooseGridSpacing(metersPerPixel: number): number | null {
  for (const s of CANDIDATE_SPACINGS) {
    if (s / metersPerPixel >= MIN_LINE_PX) return s;
  }
  return null;
}

/** Метрів на піксель web-mercator (та сама формула, що в ScaleBar). */
export function metersPerPixelAt(zoom: number, latDeg: number): number {
  const safeLat = Math.max(-85, Math.min(85, latDeg));
  return (40075016.686 * Math.cos((safeLat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
}

interface GridOverlayProps {
  active: boolean;
}

export function GridOverlay({ active }: GridOverlayProps): JSX.Element | null {
  const map = useHudMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [offReason, setOffReason] = useState<string | null>(null);
  // Бурштин 0.3 на бежевій підложці «вулиць» — невидима сітка (виміряно
  // кадром metrology-05): палітра їде за стилем мапи, як і сама підложка.
  const mapStyle = useSettingsStore((s) => (s.values.ui_map_style as string) || 'dark');

  useEffect(() => {
    if (!active || !map) return;
    const light = mapStyle === 'streets';
    const palette = light
      ? {
          line: 'rgba(74,56,18,0.5)',
          major: 'rgba(74,56,18,0.7)',
          seam: 'rgba(74,56,18,0.8)',
          text: 'rgba(46,34,8,0.95)',
          halo: 'rgba(255,255,255,0.9)',
        }
      : {
          line: 'rgba(244,175,37,0.3)',
          major: 'rgba(244,175,37,0.55)',
          seam: 'rgba(244,175,37,0.65)',
          text: 'rgba(255,255,255,0.92)',
          halo: 'rgba(0,0,0,0.7)',
        };

    const setOff = (reason: string | null) =>
      setOffReason((prev) => (prev === reason ? prev : reason));

    const clearCanvas = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    };

    const draw = () => {
      const c = canvasRef.current;
      if (!c) return;
      const centerLat = map.getCenter().lat;
      if (centerLat > 84 || centerLat < -80) {
        setOff('Сітка MGRS: поза смугою UTM (84° пн — 80° пд)');
        clearCanvas();
        return;
      }
      const spacing = chooseGridSpacing(metersPerPixelAt(map.getZoom(), centerLat));
      if (!spacing) {
        setOff('Сітка MGRS: замалий масштаб — наблизь мапу');
        clearCanvas();
        return;
      }
      setOff(null);

      const ctx = c.getContext('2d');
      if (!ctx) return;
      const w = c.clientWidth || c.parentElement?.clientWidth || 0;
      const h = c.clientHeight || c.parentElement?.clientHeight || 0;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bounds = map.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = Math.max(-80, bounds.getSouth());
      const north = Math.min(84, bounds.getNorth());
      if (south >= north) return;
      const hemisphere: Hemisphere = centerLat < 0 ? 'S' : 'N';

      const isMajor = spacing === 100000;
      const lineColor = palette.line;
      const majorColor = palette.major;
      const project = (latDeg: number, lonDeg: number): { x: number; y: number } =>
        map.project([lonDeg, latDeg]);

      const drawSampledLine = (
        samples: Array<{ latDeg: number; lonDeg: number }>,
        color: string,
        dashed = false,
        width = 1,
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dashed ? [6, 5] : []);
        ctx.beginPath();
        let started = false;
        for (const s of samples) {
          const p = project(s.latDeg, s.lonDeg);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const label = (text: string, x: number, y: number, size = 10) => {
        ctx.font = `${size}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette.halo;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = palette.text;
        ctx.fillText(text, x, y);
      };

      // 6°-зрізи зон, що перетинають вікно.
      const firstSlice = Math.floor((west + 180) / 6) * 6 - 180;
      for (let sliceW = firstSlice; sliceW < east; sliceW += 6) {
        const sliceE = sliceW + 6;
        const lonA = Math.max(west, sliceW);
        const lonB = Math.min(east, sliceE);
        if (lonB - lonA < 1e-9) continue;
        const midLon = (sliceW + sliceE) / 2;
        const zone = Math.floor((((midLon % 360) + 540) % 360) / 6) + 1;

        // Діапазон e/n у вікні — по кутах і серединах ребер зрізу.
        // Координати рахуємо примусово в ЦІЙ зоні: точка на краю
        // вікна може канонічно належати сусідній, а лінії на шві
        // рватись не повинні.
        let eMin = Infinity;
        let eMax = -Infinity;
        let nMin = Infinity;
        let nMax = -Infinity;
        for (const lat of [south, (south + north) / 2, north]) {
          for (const lon of [lonA, (lonA + lonB) / 2, lonB]) {
            const { easting, northing } = latLonToUtmForced(lat, lon, zone, hemisphere);
            eMin = Math.min(eMin, easting);
            eMax = Math.max(eMax, easting);
            nMin = Math.min(nMin, northing);
            nMax = Math.max(nMax, northing);
          }
        }
        if (!Number.isFinite(eMin) || !Number.isFinite(nMin)) continue;
        eMin -= spacing;
        eMax += spacing;
        nMin -= spacing;
        nMax += spacing;

        const SAMPLES = 12;
        const clampLon = (lonDeg: number) => Math.min(sliceE, Math.max(sliceW, lonDeg));

        // Вертикалі — лінії сталого easting.
        for (let e = Math.ceil(eMin / spacing) * spacing; e <= eMax; e += spacing) {
          const pts: Array<{ latDeg: number; lonDeg: number }> = [];
          for (let i = 0; i <= SAMPLES; i++) {
            const n = nMin + ((nMax - nMin) * i) / SAMPLES;
            const ll = utmToLatLon({ zone, hemisphere, easting: e, northing: n });
            if (ll.latDeg < -80 || ll.latDeg > 84) continue;
            pts.push({ latDeg: ll.latDeg, lonDeg: clampLon(ll.lonDeg) });
          }
          if (pts.length < 2) continue;
          const eIsMajor = e % 100000 === 0;
          drawSampledLine(pts, eIsMajor ? majorColor : lineColor, false, eIsMajor ? 1.5 : 1);
          if (!isMajor) {
            const top = project(pts[pts.length - 1].latDeg, pts[pts.length - 1].lonDeg);
            const kmDigits = spacing === 100
              ? String(Math.round((e % 100000) / 100)).padStart(3, '0')
              : String(Math.floor((e % 100000) / 1000)).padStart(2, '0');
            if (top.x > 14 && top.x < w - 14) label(kmDigits, top.x, 12);
          }
        }

        // Горизонталі — лінії сталого northing.
        for (let n = Math.ceil(nMin / spacing) * spacing; n <= nMax; n += spacing) {
          const pts: Array<{ latDeg: number; lonDeg: number }> = [];
          for (let i = 0; i <= SAMPLES; i++) {
            const e = eMin + ((eMax - eMin) * i) / SAMPLES;
            const ll = utmToLatLon({ zone, hemisphere, easting: e, northing: n });
            if (ll.latDeg < -80 || ll.latDeg > 84) continue;
            pts.push({ latDeg: ll.latDeg, lonDeg: clampLon(ll.lonDeg) });
          }
          if (pts.length < 2) continue;
          const nIsMajor = n % 100000 === 0;
          drawSampledLine(pts, nIsMajor ? majorColor : lineColor, false, nIsMajor ? 1.5 : 1);
          if (!isMajor) {
            const left = pts.find((p) => p.lonDeg > lonA + 1e-9) ?? pts[0];
            const px = project(left.latDeg, left.lonDeg);
            const kmDigits = spacing === 100
              ? String(Math.round((n % 100000) / 100)).padStart(3, '0')
              : String(Math.floor((n % 100000) / 1000)).padStart(2, '0');
            if (px.y > 20 && px.y < h - 8) label(kmDigits, 16, px.y);
          }
        }

        // На 100-км кроці — повний ідентифікатор квадрата в центрі клітини.
        if (isMajor) {
          for (let e = Math.floor(eMin / 100000) * 100000; e <= eMax; e += 100000) {
            for (let n = Math.floor(nMin / 100000) * 100000; n <= nMax; n += 100000) {
              const centerLl = utmToLatLon({
                zone,
                hemisphere,
                easting: e + 50000,
                northing: n + 50000,
              });
              if (centerLl.lonDeg < sliceW || centerLl.lonDeg > sliceE) continue;
              if (centerLl.latDeg < south || centerLl.latDeg > north) continue;
              const band = latitudeBand(centerLl.latDeg);
              const col = e100kLetter(zone, e + 50000);
              const row = n100kLetter(zone, n + 50000);
              if (!band || !col || !row) continue;
              const p = project(centerLl.latDeg, centerLl.lonDeg);
              label(`${zone}${band} ${col}${row}`, p.x, p.y, 12);
            }
          }
        }

        // Шов зон — штрихова межа.
        if (sliceW > west && sliceW < east) {
          const pts: Array<{ latDeg: number; lonDeg: number }> = [];
          for (let i = 0; i <= SAMPLES; i++) {
            pts.push({ latDeg: south + ((north - south) * i) / SAMPLES, lonDeg: sliceW });
          }
          drawSampledLine(pts, palette.seam, true);
        }
      }
    };

    let raf = 0;
    const schedule = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          draw();
        });
      }
    };

    draw();
    map.on('move', schedule);
    map.on('resize', schedule);
    return () => {
      map.off('move', schedule);
      map.off('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      clearCanvas();
    };
  }, [active, map, mapStyle]);

  if (!active) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="grid-overlay"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {!map ? (
        <div
          data-testid="grid-off-chip"
          className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-md border border-white/5 bg-black/55 px-3 py-1.5 text-[10px] text-white/85 backdrop-blur-md"
        >
          Сітка: мапа ще не готова
        </div>
      ) : offReason ? (
        <div
          data-testid="grid-off-chip"
          className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-md border border-white/5 bg-black/55 px-3 py-1.5 text-[10px] text-white/85 backdrop-blur-md"
        >
          {offReason}
        </div>
      ) : null}
    </>
  );
}
