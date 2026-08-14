/**
 * Скільки живе стан тривоги, і що показувати після того.
 *
 * Тиша і тривога старіють з різною швидкістю. Двогодинний «відбій»,
 * намальований зеленим, — це «тиша ≠ безпека» в найбуквальнішій формі:
 * екран стверджує безпеку, якої ніхто не підтверджував. Двогодинна
 * «тривога» помиляється в безпечний бік, тож її можна показувати далі —
 * видимо старою.
 *
 * Числа приходять з маніфесту `air_raid_ua.yaml` (staleness.asymmetric) і
 * продубльовані тут, бо рендер не має де їх спитати до першого підключення.
 */

export const QUIET_MAX_AGE_MS = 120_000;
export const ACTIVE_MAX_AGE_MS = 600_000;

export type AlertState = 'unknown' | 'quiet' | 'active' | 'active_stale';

export interface AlertAge {
  state: AlertState;
  ageMs: number;
  /** Чи чули ми взагалі щось про цей шар у цій сесії. */
  everHeard: boolean;
}

export function alertAge(args: {
  count: number;
  lastHeardAt: number;
  now: number;
}): AlertAge {
  const { count, lastHeardAt, now } = args;
  // Холодний старт і пробудження після сну — це «невідомо», а не останнє
  // відоме. Останнє відоме тут завжди старше за будь-який поріг.
  if (!lastHeardAt) return { state: 'unknown', ageMs: 0, everHeard: false };

  const ageMs = Math.max(0, now - lastHeardAt);
  if (count > 0) {
    return {
      state: ageMs <= ACTIVE_MAX_AGE_MS ? 'active' : 'active_stale',
      ageMs,
      everHeard: true,
    };
  }
  return {
    state: ageMs <= QUIET_MAX_AGE_MS ? 'quiet' : 'unknown',
    ageMs,
    everHeard: true,
  };
}

export function formatClock(atMs: number): string {
  const d = new Date(atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'щойно';
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} год тому`;
  return `${Math.floor(hours / 24)} діб тому`;
}

/** «станом на 09:14 (2 год тому)» — абсолютний час плюс вік, ніколи не сам значок. */
export function formatStamp(lastHeardAt: number, ageMs: number): string {
  if (!lastHeardAt) return 'дані не надходили';
  return `станом на ${formatClock(lastHeardAt)} (${formatAge(ageMs)})`;
}
