import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { useHudMap } from './useHudMap';
import { useMapStore } from '../../../stores/mapStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { formatLatLonUa } from '../../../utils/geo';
import { formatMgrs, latLonToMgrsRef } from '../../../utils/mgrs';
import { formatUsk, wgs84ToUsk2000 } from '../../../utils/usk2000';

/**
 * Ф2 метрологія, У6 — координатний рядок під курсором.
 *
 * «Мапа, з якої не можна зняти й передати координату за дві секунди, —
 * туристична схема, не робочий інструмент» (гонтлет Р1). Рядок живе на
 * нижньому краї пейна: джерело (курсор чи центр екрана) — координата
 * моно-шрифтом — формат. Клац по координаті копіює її, клац по
 * формату перемикає ШИР/ДОВ → MGRS → УСК-2000; вибір їде в налаштування
 * тим самим маршрутом, що й вигляд мапи (`ui_map_style`).
 *
 * Конверсії — utils/mgrs.ts та utils/usk2000.ts, обидві з тестами
 * проти еталонів; там, де система координат не визначена (MGRS поза
 * 80°пд…84°пн, УСК-2000 поза Україною), рядок каже це словом і не
 * малює жодної вигаданої цифри.
 */

export type CoordFormat = 'latlon' | 'mgrs' | 'usk';

const FORMAT_ORDER: readonly CoordFormat[] = ['latlon', 'mgrs', 'usk'];
const FORMAT_LABEL: Record<CoordFormat, string> = {
  latlon: 'ШИР·ДОВ',
  mgrs: 'MGRS',
  usk: 'УСК-2000',
};
const SETTING_KEY = 'ui_coord_format';
/**
 * Персистентність — localStorage, не settingsApi: бекендів config не
 * знає ключа ui_coord_format, PUT /settings/ui_coord_format відповідає
 * 404 (виміряно на стенді). Реєстрація ключа в config.py — територія
 * бекенда; коли вона станеться, цей рядок переїде на спільні рейки
 * ui_map_style. Доти локальне сховище чесно переживає перезапуск.
 */
const STORAGE_KEY = 'phantom_coord_format';

/** Текст координати в обраному форматі; недоступність — словом. */
export function coordText(format: CoordFormat, lat: number, lon: number): string {
  if (format === 'mgrs') {
    const ref = latLonToMgrsRef(lat, lon, 5);
    return ref ? formatMgrs(ref) : 'MGRS: поза смугою 80° пд — 84° пн';
  }
  if (format === 'usk') {
    const p = wgs84ToUsk2000(lat, lon);
    return p ? formatUsk(p) : 'УСК-2000: поза зоною чинності (Україна)';
  }
  return formatLatLonUa(lat, lon);
}

export function CoordReadout({ className = '' }: { className?: string }): JSX.Element {
  const map = useHudMap();
  const center = useMapStore((s) => s.center);
  const setToast = useMapStore((s) => s.setToast);
  const storedFormat = useSettingsStore((s) => s.values[SETTING_KEY]);
  const setSettingValue = useSettingsStore((s) => s.setValue);
  const format: CoordFormat = useMemo(() => {
    if (FORMAT_ORDER.includes(storedFormat as CoordFormat)) return storedFormat as CoordFormat;
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (FORMAT_ORDER.includes(saved as CoordFormat)) return saved as CoordFormat;
    } catch {
      /* приватний режим / SSR — живемо з типовим */
    }
    return 'latlon';
  }, [storedFormat]);

  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    let raf = 0;
    let pending: { lat: number; lon: number } | null = null;
    const onMouseMove = (e: MapLayerMouseEvent) => {
      pending = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setCursor(pending);
        });
      }
    };
    const onMouseOut = () => {
      pending = null;
      setCursor(null);
    };
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);

  // Без курсора рядок чесно показує центр екрана — знята з нього
  // координата так само реальна, просто джерело підписане інакше.
  // Store синхронізує центр лише на moveend, тож до першого руху камери
  // він порожній — а мапа при цьому вже стоїть і центр ЗНАЄ. Питаємо її
  // саму; «координат ще немає» лишається правдою тільки без мапи.
  const liveCenter = (() => {
    if (cursor || center || !map) return null;
    try {
      const c = map.getCenter();
      return { lat: c.lat, lon: c.lng };
    } catch {
      return null;
    }
  })();
  const point = cursor ?? (center ? { lat: center[1], lon: center[0] } : liveCenter);
  const text = point ? coordText(format, point.lat, point.lon) : 'координат ще немає';

  const cycleFormat = useCallback(() => {
    const next = FORMAT_ORDER[(FORMAT_ORDER.indexOf(format) + 1) % FORMAT_ORDER.length];
    setSettingValue(SETTING_KEY, next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* сховище недоступне — вибір живе принаймні до кінця сесії */
    }
  }, [format, setSettingValue]);

  const copy = useCallback(() => {
    if (!point) return;
    const value = coordText(format, point.lat, point.lon);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      setToast('Буфер обміну недоступний');
      return;
    }
    clipboard.writeText(value).then(
      () => setToast(`Скопійовано: ${value}`),
      () => setToast('Буфер обміну недоступний'),
    );
  }, [point, format, setToast]);

  return (
    <div
      data-testid="coord-readout"
      className={`flex items-stretch overflow-hidden rounded-lg border border-white/5 bg-black/55 shadow-lg backdrop-blur-md ${className}`}
    >
      <span
        data-testid="coord-source"
        className="flex items-center border-r border-white/5 px-2 text-[9px] font-semibold uppercase tracking-wider text-white/45"
      >
        {cursor ? 'курсор' : 'центр'}
      </span>
      <button
        type="button"
        data-testid="coord-value"
        onClick={copy}
        title="Клац — скопіювати координату"
        aria-label={`Координата (${FORMAT_LABEL[format]}): ${text}. Клац — скопіювати.`}
        className="flex min-h-[44px] items-center px-3 font-mono text-[11px] tabular-nums leading-none text-white/90 transition-colors hover:bg-white/5"
      >
        {text}
      </button>
      <button
        type="button"
        data-testid="coord-format"
        onClick={cycleFormat}
        aria-label={`Формат координат: ${FORMAT_LABEL[format]}. Клац — наступний формат.`}
        title="Перемкнути формат: ШИР·ДОВ → MGRS → УСК-2000"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center border-l border-white/5 px-2.5 text-[9px] font-bold uppercase tracking-wider text-amber-300/90 transition-colors hover:bg-white/5"
      >
        {FORMAT_LABEL[format]}
      </button>
    </div>
  );
}
