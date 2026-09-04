/**
 * Чиста арифметика нижнього ряду HUD — окремо від самої поверхні.
 *
 * Жила в `HudShell.tsx` поруч із компонентом, і храповик лінту справедливо
 * червонів: файл, який експортує і компонент, і константи, ламає гаряче
 * перезавантаження. Стелю попереджень штаб свідомо НЕ підняв — узаконити
 * борг означало б зробити зелене за побудовою. Тому логіка переїхала, а не
 * дістала глушник.
 */
/**
 * Скільки треба нижньому ряду HUD, щоб три колонки не налазили одна на одну:
 * 168 (ліва) + 12 + (200 поле пошуку + 8 + 217 тулбар) + 12 + 168 (права)
 * = 785, плюс 2 на рамки — 787. Виміряно на склі 03.09.2026, WebKitGTK.
 * Рейки з'їдають по 76 px з кожного боку пейна, звідси −152.
 */
export const HUD_ROW_NEEDS_PX = 787;
export const HUD_RAILS_PX = 152;

/** Вибір у «Поруч» — джерело трьох різних форм координати. */
export type NearbyPick =
  | { kind: 'remembered'; item: { place_lat: number | null; place_lon: number | null } }
  | { kind: 'osm'; item: { lat: number; lon: number } }
  | { kind: 'poi'; item: { lat: number; lon: number } };

/**
 * Куди вести мапу за вибором у «Поруч», у порядку maplibre [lon, lat].
 * `null` — спогад без місця: він приходить із `place_lat/place_lon = null`,
 * і вести нікуди. Мовчазний рух у нуль-нуль (Гвінейська затока) був би
 * гіршим за нерух.
 */
export function nearbyPickToCenter(picked: NearbyPick): [number, number] | null {
  if (picked.kind === 'remembered') {
    const { place_lat: lat, place_lon: lon } = picked.item;
    return lat != null && lon != null ? [lon, lat] : null;
  }
  return [picked.item.lon, picked.item.lat];
}

/** Чи бракує пейну місця на повний нижній ряд. paneWidth — ширина ПЕЙНА мапи. */
export function hudIsNarrow(paneWidth: number): boolean {
  return paneWidth > 0 && paneWidth - HUD_RAILS_PX < HUD_ROW_NEEDS_PX;
}
