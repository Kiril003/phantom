export const WS_BASE = import.meta.env.AEGIS_BACKEND ?? 'ws://127.0.0.1:8000';

// Dev is served by Vite on another port, so REST goes through the proxy in
// vite.config.ts — the backend's CORS allow-list has no entry for it.
const API = import.meta.env.DEV ? '' : WS_BASE.replace(/^ws/, 'http');

const TOKEN_KEY = 'aegis.token';
const USER_KEY = 'aegis.user';

export interface PickerUser {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface AuthConfig {
  maxPinAttempts: number;
  lockoutMinutes: number;
}

export type LoginResult =
  | { ok: true; token: string; username: string }
  | { ok: false; kind: 'offline' }
  | { ok: false; kind: 'wrong' }
  | { ok: false; kind: 'locked'; seconds: number }
  | { ok: false; kind: 'refused'; detail: string };

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storedUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function rememberSession(token: string, username: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
  } catch {
    /* private-mode storage: the session simply does not survive a restart */
  }
}

export function forgetSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* nothing to forget */
  }
}

export async function fetchPicker(): Promise<PickerUser[] | null> {
  try {
    const res = await fetch(`${API}/api/v1/auth/users/picker`);
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    return Array.isArray(rows) ? (rows as PickerUser[]) : [];
  } catch {
    return null;
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${API}/api/v1/auth/config`);
    const body = (await res.json()) as Record<string, unknown>;
    return {
      maxPinAttempts: typeof body.max_pin_attempts === 'number' ? body.max_pin_attempts : 5,
      lockoutMinutes: typeof body.lockout_duration_m === 'number' ? body.lockout_duration_m : 15,
    };
  } catch {
    return { maxPinAttempts: 5, lockoutMinutes: 15 };
  }
}

function detailOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const d = (body as Record<string, unknown>).detail;
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && d !== null) {
    const msg = (d as Record<string, unknown>).message ?? (d as Record<string, unknown>).code;
    if (typeof msg === 'string') return msg;
  }
  return '';
}

export async function loginPin(username: string, pin: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/v1/auth/login/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    });
  } catch {
    return { ok: false, kind: 'offline' };
  }

  if (res.ok) {
    const body = (await res.json()) as { token?: unknown; user?: { username?: unknown } };
    if (typeof body.token !== 'string') return { ok: false, kind: 'refused', detail: '' };
    const name = typeof body.user?.username === 'string' ? body.user.username : username;
    rememberSession(body.token, name);
    return { ok: true, token: body.token, username: name };
  }

  const body = await res.json().catch(() => null);
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After'));
    return { ok: false, kind: 'locked', seconds: Number.isFinite(retry) && retry > 0 ? retry : 900 };
  }
  if (res.status === 401) return { ok: false, kind: 'wrong' };
  return { ok: false, kind: 'refused', detail: detailOf(body) };
}

/** Trade an expired-but-recent token for a fresh one; null when the grace window has passed. */
export async function refreshToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    if (typeof body.token !== 'string') return null;
    const name = storedUser();
    if (name) rememberSession(body.token, name);
    return body.token;
  } catch {
    return null;
  }
}
