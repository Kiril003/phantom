/** ПОЛІС palette — bound to the app's warm sunrise token system, never
 * hardcoded. Domains map onto the sanctioned --chart-N series; statuses
 * onto --signal-*. Canvas resolves the live computed values (theme has
 * light + dark variants) via a short-lived cache. */

export type PolisDomainKey =
  | 'dev'
  | 'research'
  | 'analytics'
  | 'document'
  | 'game'
  | 'generic'
  | 'plaza';

/** CSS var name per domain — resolved at render time so light/dark both work. */
export const DOMAIN_VAR: Record<string, string> = {
  dev: '--chart-1',       // amber
  research: '--chart-4',  // azure
  analytics: '--chart-2', // orange
  document: '--chart-3',  // green/mint
  game: '--chart-5',      // coral
  generic: '--ink-muted', // warm neutral
  plaza: '--ink-faint',
};

export const STATUS_VAR: Record<string, string> = {
  running: '--accent',
  review: '--signal-warn',
  done: '--signal-ok',
  failed: '--signal-alert',
  blocked: '--signal-alert',
  pending: '--ink-muted',
  ready: '--ink-secondary',
  skipped: '--ink-faint',
};

/** DOM helper: `token('--accent')` → `var(--accent)`. */
export const token = (name: string) => `var(${name})`;
export const domainToken = (domain: string) =>
  token(DOMAIN_VAR[domain] ?? DOMAIN_VAR.generic);
export const statusToken = (status: string) =>
  token(STATUS_VAR[status] ?? '--ink-muted');

/* ── Canvas side: resolve computed hex/rgb from the live root ──────────── */

let _cache: Record<string, string> = {};
let _cacheAt = 0;

function readVar(name: string): string {
  const now = performance.now();
  if (now - _cacheAt > 1000) {
    _cache = {};
    _cacheAt = now;
  }
  if (_cache[name]) return _cache[name];
  const el = document.documentElement;
  const v = getComputedStyle(el).getPropertyValue(name).trim() || '#8a7758';
  _cache[name] = v;
  return v;
}

export const domainColor = (domain: string) =>
  readVar(DOMAIN_VAR[domain] ?? DOMAIN_VAR.generic);
export const statusColor = (status: string) =>
  readVar(STATUS_VAR[status] ?? '--ink-muted');
export const themeColor = (name: string) => readVar(name);

/** Add an alpha channel to a resolved hex color for canvas fills. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
