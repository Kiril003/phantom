import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Ruler, X } from 'lucide-react';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { useHudMap } from './useHudMap';
import { formatAzimuth, formatKm, measurePath, type GeoPoint } from '../../../utils/geo';

/**
 * Ф2 метрологія, У6 — лінійка: відстань по сегментах і сумарна,
 * істинний азимут останнього сегмента.
 *
 * Повернення з мертвих: файл існував із фази 24-D як пасивний чип,
 * який показував суму точок, що їх ніхто ніколи не передавав — двері
 * з рейки йому так і не поставили. Від старого тіла лишився гаверсинус
 * (переїхав у utils/geo.ts і обріс тестами); решта — жива: клац по
 * мапі ставить точку, подвійний клац завершує лінію, наступний клац
 * починає нову.
 *
 * Малювання — SVG-оверлей поверх пейна: точки проєктуються через
 * map.project() і переміщуються разом із камерою (підписка на 'move').
 * Оверлей не чіпає стиль MapLibre навмисно — стиль перебудовується
 * при зміні теми/вигляду і мовчки стирає додані в нього шари
 * (див. keepTerrain у TacticalMap); SVG цієї хвороби не має.
 */

export interface RulerToolProps {
  onClose: () => void;
}

interface Px {
  x: number;
  y: number;
}

export function RulerTool({ onClose }: RulerToolProps): JSX.Element {
  const map = useHudMap();
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [cursor, setCursor] = useState<GeoPoint | null>(null);
  const [done, setDone] = useState(false);
  // Лічильник рухів камери: кожен 'move' вимагає повторної проєкції.
  const [cameraEpoch, setCameraEpoch] = useState(0);

  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    if (!map) return;

    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    // Подвійний клац завершує лінію — зум на ньому в цей час зайвий.
    const dblZoomWasOn = map.doubleClickZoom.isEnabled();
    if (dblZoomWasOn) map.doubleClickZoom.disable();

    const onClick = (e: MapLayerMouseEvent) => {
      const pt: GeoPoint = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (doneRef.current) {
        setPoints([pt]);
        setDone(false);
      } else {
        setPoints((prev) => [...prev, pt]);
      }
    };
    const onDblClick = (e: MapLayerMouseEvent) => {
      e.preventDefault();
      // Перед dblclick мапа встигає видати два click у тій самій
      // точці — другий дубль лінії не належить.
      setPoints((prev) => {
        if (prev.length >= 2) {
          const a = prev[prev.length - 1];
          const b = prev[prev.length - 2];
          if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9) {
            return prev.slice(0, -1);
          }
        }
        return prev;
      });
      setDone(true);
      setCursor(null);
    };

    let moveRaf = 0;
    let pendingCursor: GeoPoint | null = null;
    const onMouseMove = (e: MapLayerMouseEvent) => {
      if (doneRef.current) return;
      pendingCursor = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (!moveRaf) {
        moveRaf = requestAnimationFrame(() => {
          moveRaf = 0;
          setCursor(pendingCursor);
        });
      }
    };
    const onMouseOut = () => {
      pendingCursor = null;
      setCursor(null);
    };

    let cameraRaf = 0;
    const onCameraMove = () => {
      if (!cameraRaf) {
        cameraRaf = requestAnimationFrame(() => {
          cameraRaf = 0;
          setCameraEpoch((n) => n + 1);
        });
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    map.on('move', onCameraMove);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      map.off('move', onCameraMove);
      if (moveRaf) cancelAnimationFrame(moveRaf);
      if (cameraRaf) cancelAnimationFrame(cameraRaf);
      canvas.style.cursor = prevCursor;
      if (dblZoomWasOn) map.doubleClickZoom.enable();
    };
  }, [map]);

  const measure = useMemo(() => measurePath(points), [points]);
  const lastSegment = measure.segments[measure.segments.length - 1] ?? null;

  // Проєкція в пікселі пейна; перераховується на кожен рух камери.
  const px: Px[] = useMemo(() => {
    if (!map) return [];
    void cameraEpoch;
    return points.map((p) => {
      const { x, y } = map.project([p.lon, p.lat]);
      return { x, y };
    });
  }, [map, points, cameraEpoch]);

  const cursorPx: Px | null = useMemo(() => {
    if (!map || !cursor || done) return null;
    void cameraEpoch;
    const { x, y } = map.project([cursor.lon, cursor.lat]);
    return { x, y };
  }, [map, cursor, done, cameraEpoch]);

  return (
    <>
      {/* Оверлей малювання: не ловить мишу — кліки належать мапі. */}
      <svg
        data-testid="ruler-overlay"
        data-points={points.length}
        data-done={done}
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {px.length >= 2 && (
          <polyline
            points={px.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="rgba(244,175,37,0.95)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}
        {px.length >= 1 && cursorPx && (
          <line
            x1={px[px.length - 1].x}
            y1={px[px.length - 1].y}
            x2={cursorPx.x}
            y2={cursorPx.y}
            stroke="rgba(244,175,37,0.55)"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        )}
        {px.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === 0 || i === px.length - 1 ? 5 : 3.5}
            fill="rgba(244,175,37,0.95)"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={1.5}
          />
        ))}
        {/* Підпис відстані на середині кожного сегмента, з обведенням. */}
        {measure.segments.map((seg, i) => {
          const a = px[i];
          const b = px[i + 1];
          if (!a || !b) return null;
          return (
            <text
              key={`label-${i}`}
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 8}
              textAnchor="middle"
              className="select-none font-mono"
              fontSize={11}
              fill="rgba(255,255,255,0.95)"
              stroke="rgba(0,0,0,0.75)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {formatKm(seg.km)}
            </text>
          );
        })}
      </svg>

      {/* Панель вимірів — біля своєї кнопки на рейці інструментів. */}
      <div
        data-testid="ruler-panel"
        className="pointer-events-auto absolute right-[80px] top-1/2 w-[228px] -translate-y-1/2 rounded-2xl glass-elevated p-3 text-[color:var(--ink-primary)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
            <Ruler size={13} strokeWidth={2} />
            Лінійка
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити лінійку"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[color:var(--ink-secondary)] transition-colors hover:text-[color:var(--ink-primary)]"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {!map ? (
          <div className="pb-2 text-[11px] leading-relaxed text-[color:var(--ink-secondary)]">
            Мапа ще не готова — міряти нема по чому.
          </div>
        ) : points.length < 2 ? (
          <div className="pb-2 text-[11px] leading-relaxed text-[color:var(--ink-secondary)]">
            Клац по мапі — точка. Подвійний клац — кінець лінії.
            {points.length === 1 && ' Перша точка стоїть.'}
          </div>
        ) : (
          <>
            <ol className="max-h-[148px] overflow-y-auto pr-1" data-testid="ruler-segments">
              {measure.segments.map((seg, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-2 py-0.5 font-mono text-[11px] tabular-nums text-[color:var(--ink-secondary)]"
                >
                  <span className="opacity-60">{i + 1}.</span>
                  <span>{formatKm(seg.km)}</span>
                  <span>{formatAzimuth(seg.azimuthDeg)}</span>
                </li>
              ))}
            </ol>
            <div className="mt-1.5 border-t border-white/10 pt-1.5 font-mono text-[12px] tabular-nums">
              <div className="flex items-baseline justify-between">
                <span className="font-sans text-[10px] uppercase tracking-wider opacity-60">Разом</span>
                <span data-testid="ruler-total">{formatKm(measure.totalKm)}</span>
              </div>
              {lastSegment && (
                <div className="flex items-baseline justify-between">
                  <span className="font-sans text-[10px] uppercase tracking-wider opacity-60">
                    Аз. останнього (іст.)
                  </span>
                  <span data-testid="ruler-azimuth">{formatAzimuth(lastSegment.azimuthDeg)}</span>
                </div>
              )}
            </div>
          </>
        )}

        {points.length > 0 && (
          <button
            type="button"
            data-testid="ruler-reset"
            onClick={() => {
              setPoints([]);
              setDone(false);
              setCursor(null);
            }}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest text-[color:var(--ink-secondary)] transition-colors hover:text-[color:var(--ink-primary)]"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Скинути
          </button>
        )}
      </div>
    </>
  );
}
