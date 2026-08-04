import { distanceM } from './fuse';
import type { PositionCandidate } from './types';

export interface SeenAp {
  bssid: string;
  ssid?: string;
  rssiDbm: number;
  /** Координати точки доступу, якщо ми її колись бачили й записали. */
  lat?: number;
  lon?: number;
}

/**
 * Груба оцінка відстані до точки доступу за рівнем сигналу.
 *
 * Це не вимірювання, а модель втрат у вільному просторі — стіни, люди й
 * інша техніка легко дають удвічі більше. Тому число повертаємо як
 * ПОХИБКУ, а не як відстань, якою можна щось стверджувати.
 */
export function apDistanceM(rssiDbm: number, freqMhz = 2437): number {
  const exp = (27.55 - 20 * Math.log10(freqMhz) + Math.abs(rssiDbm)) / 20;
  return Math.min(500, Math.max(3, 10 ** exp));
}

/**
 * Місце за видимими точками доступу.
 *
 * Мережа на пів району дає одну координату на всю мережу — і людину
 * ставить у її умовний центр, за кілометр від того місця, де вона стоїть.
 * Тому вагу дає не сам факт «мережу видно», а сила сигналу: найближча
 * точка тягне сильніше за решту разом узяту.
 */
export function positionFromAps(aps: SeenAp[], at: number = Date.now()): PositionCandidate | null {
  const known = aps.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
  if (known.length === 0) return null;

  const strongest = known.reduce((a, b) => (b.rssiDbm > a.rssiDbm ? b : a));

  // Вага падає з квадратом оцінки відстані: точка за п'ять метрів важить
  // у сотні разів більше за точку за сто.
  let wsum = 0;
  let lat = 0;
  let lon = 0;
  for (const ap of known) {
    const d = apDistanceM(ap.rssiDbm);
    const w = 1 / (d * d);
    wsum += w;
    lat += ap.lat! * w;
    lon += ap.lon! * w;
  }
  lat /= wsum;
  lon /= wsum;

  // Похибка — не менша за оцінку відстані до найближчої точки, і не
  // менша за розкид самих точок навколо результату.
  const spread = known.length > 1
    ? Math.max(...known.map((a) => distanceM(lat, lon, a.lat!, a.lon!)))
    : 0;
  const accuracyM = Math.max(apDistanceM(strongest.rssiDbm), spread * 0.6, 25);

  return {
    kind: 'wifi',
    lat,
    lon,
    accuracyM,
    at,
    label: known.length === 1
      ? `за точкою «${strongest.ssid ?? strongest.bssid}»`
      : `за ${known.length} точками Wi-Fi`,
    strongestAp: {
      bssid: strongest.bssid,
      rssiDbm: strongest.rssiDbm,
      lat: strongest.lat,
      lon: strongest.lon,
    },
  };
}

/**
 * Чи схоже, що мережа накриває надто велику площу, щоб її центр щось
 * означав. Саме цей випадок owner описав: «якщо мережа обширна — то
 * визначення по найближчому вайфай».
 */
export function networkIsWide(aps: SeenAp[]): boolean {
  const known = aps.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
  if (known.length < 2) return false;
  let max = 0;
  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      max = Math.max(max, distanceM(known[i].lat!, known[i].lon!, known[j].lat!, known[j].lon!));
    }
  }
  return max > 800;
}
