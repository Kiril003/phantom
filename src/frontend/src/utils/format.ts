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

export function formatRelativeClock(secondsAgo: number): string {
  if (secondsAgo < 60) return 'щойно';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)} хв`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)} год`;
  return `${Math.floor(secondsAgo / 86400)} дн`;
}

export function sanitizeInput(text: string): string {
  // Basic prompt injection deterrent: strip suspicious control chars
  // and limit length.
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
