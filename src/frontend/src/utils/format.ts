/**
 * Shared UI formatting utilities.
 */

/** Українське відмінювання числівників: 1 місце, 2 місця, 5 місць. */
export function pluralUa(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Байти двійковими одиницями — КіБ/МіБ/ГіБ, як їх називає бекенд у своїх
 * українських реченнях про диск і памʼять. Змішувати з десятковими МБ на
 * одному екрані означало б показати два різні числа для одного файла.
 */
export function formatBytesUa(n: number | null | undefined): string {
  const KIB = 1024;
  if (n == null) return '—';
  if (n >= KIB ** 3) return `${(n / KIB ** 3).toFixed(1)} ГіБ`;
  if (n >= KIB ** 2) return `${(n / KIB ** 2).toFixed(1)} МіБ`;
  if (n >= KIB) return `${(n / KIB).toFixed(0)} КіБ`;
  return `${n} Б`;
}

/**
 * Точна тривалість — на відміну від `formatRelativeClock`, який округлює до
 * найбільшої одиниці. Коли людина дивиться на роботу, що триває просто
 * зараз, «40 хв» і «40 хв 12 с» — різні відповіді на «чи воно рухається».
 */
export function formatDurationUa(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} хв ${String(s % 60).padStart(2, '0')} с`;
  return `${Math.floor(m / 60)} год ${String(m % 60).padStart(2, '0')} хв`;
}

export function formatRelativeClock(secondsAgo: number): string {
  if (secondsAgo < 60) return 'щойно';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)} хв`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)} год`;
  return `${Math.floor(secondsAgo / 86400)} дн`;
}

export function sanitizeInput(text: string): string {
  // Basic prompt injection deterrent: strip suspicious control chars
  // and limit length.
  //
  // Керівні символи тут навмисні — вони і є те, що ми вирізаємо. Правило
  // `no-control-regex` застерігає від випадкових; глушимо прицільно й з
  // причиною, а не вимикаємо правило на все дерево.
  // eslint-disable-next-line no-control-regex
  return text.trim().slice(0, 5000).replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '');
}

export function localizedTime(ts: number | string | Date): string {
  const date = typeof ts === 'number' || typeof ts === 'string' ? new Date(ts) : ts;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
