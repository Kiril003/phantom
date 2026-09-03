/**
 * cockpitApi — типізовані фетчі для пейнів «Кокпіта» (Ф4).
 *
 * Та сама доктрина Pulse, що в organismApi: кожне джерело або
 * відповідає реальними даними, або чесно «мовчить з причиною»; фетч
 * НІКОЛИ не кидає — кокпіт не має права впасти через мертве ядро.
 * СВІДОМО не через services/api.ts request(): той на 401 зносить
 * phantom_token і вибиває власника із сесії — фоновий полінг кокпіта
 * не має права на такі побічні ефекти.
 *
 * Джерела (звірені з бекендом цього дерева, 2026-08-23):
 *   GET /api/v1/cockpit/machine — api/routes_cockpit.py: CPU з
 *     system_metrics_sampler (1 Гц), RAM/диск psutil, слухачі вузла.
 *   GET /api/v1/cockpit/audit  — api/routes_cockpit.py: журнал
 *     agent_audit з курсорною пагінацією.
 *   GET /api/v1/pair/devices   — api/routes_pair.py:list_devices
 *     (require_root — оператор без root-прав чесно почує відмову).
 */

import type { Pulse } from './organismApi';
import { readToken } from './tokenStore';

/* ── Форми відповідей ─────────────────────────────────────────────────── */

export interface MachinePulse {
  sampled_at_ms: number;
  cpu: {
    /** null — сампер ще не запущений; нуль-замість-невідомо заборонений. */
    pct: number | null;
    source: string;
  };
  ram: { total: number; used: number; pct: number };
  disk: { total: number; used: number; pct: number };
  uptime: { host_s: number; backend_s: number };
  listeners: {
    /** Справжній сокет, що прийняв запит; null — ASGI-сервер його не назвав. */
    http: { host: string | null; port: number | null };
    tls: { state: string; port: number; bound: string[] };
    mdns: { state: string };
    ws_clients: number;
  };
}

export interface AuditEntry {
  id: number;
  ts_ms: number | null;
  action_name: string;
  intent: string | null;
  status: 'ok' | 'retry' | 'fail';
  elapsed_ms: number;
  task_id: string;
}

export interface AuditPage {
  total: number;
  entries: AuditEntry[];
  /** null — журнал вичерпано. */
  next_before_id: number | null;
}

/** GET /api/v1/pair/devices — рядок routes_pair.PairedDeviceRow. */
export interface PairedDeviceRow {
  id: string;
  device_name: string;
  device_model: string;
  platform: string;
  platform_version: string | null;
  paired_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  capabilities: string[];
  /** Чи тримає пристрій WS-з'єднання просто зараз. */
  online: boolean;
}

/* ── Pulse-фетч (той самий контракт, що organismApi) ──────────────────── */

const PULSE_TIMEOUT_MS = 4000;

const SILENT_UNREACHABLE = { ok: false, reason: 'unreachable' } as const;
const SILENT_UNAUTHORIZED = { ok: false, reason: 'unauthorized' } as const;

// Токен живе в sessionStorage (services/tokenStore) з того дня, коли його
// зняли з диска. Поки тут стояв власний читач localStorage, кожен фетч
// кокпіта повертав «немає доступу», НЕ спитавши ядро: власник із роллю ROOT
// читав на склі, що йому бракує прав, а в лозі бекенда не було жодного
// запиту. Єдине місце токена — tokenStore, тут лише його читач.
function token(): string | null {
  return readToken();
}

async function authedPulse<T>(url: string): Promise<Pulse<T>> {
  const t = token();
  if (!t) return SILENT_UNAUTHORIZED;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${t}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return SILENT_UNAUTHORIZED;
    if (!res.ok) return SILENT_UNREACHABLE;
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return SILENT_UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Фетчі ────────────────────────────────────────────────────────────── */

export function fetchMachine(): Promise<Pulse<MachinePulse>> {
  return authedPulse<MachinePulse>('/api/v1/cockpit/machine');
}

export function fetchAuditPage(opts?: {
  limit?: number;
  beforeId?: number;
}): Promise<Pulse<AuditPage>> {
  const params = new URLSearchParams();
  params.set('limit', String(opts?.limit ?? 20));
  if (opts?.beforeId != null) params.set('before_id', String(opts.beforeId));
  return authedPulse<AuditPage>(`/api/v1/cockpit/audit?${params.toString()}`);
}

export function fetchPairedDevices(): Promise<Pulse<PairedDeviceRow[]>> {
  return authedPulse<PairedDeviceRow[]>('/api/v1/pair/devices');
}
