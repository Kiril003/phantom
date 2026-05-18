/**
 * Shared UI formatting utilities.
 */

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

export function formatRelativeClock(secondsAgo: number): string {
  if (secondsAgo < 60) return 'Just now';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  return `${Math.floor(secondsAgo / 3600)}h ago`;
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
