/**
 * organismApi — типізовані фетчі для стрічки організму (Ф1 майстерплану).
 *
 * Доктрина чесності (masterplan D8): кожне джерело або відповідає
 * реальними даними, або чесно «мовчить». Жодних вигаданих чисел,
 * жодних нулів замість відсутності. Тому кожен фетч повертає Pulse<T>:
 * дискримінований union «є дані» / «мовчить з причиною», і НІКОЛИ не
 * кидає — стрічка не має права впасти через мертвий бекенд.
 *
 * СВІДОМО не використовує services/api.ts request(): той на будь-який
 * 401 зносить phantom_token і шле phantom:unauthorized — фоновий пульс,
 * який полить /linux/resources без operator-прав, вибивав би власника
 * з сесії кожні 5 секунд. Тут 401/403 — просто «немає доступу», без
 * побічних ефектів.
 *
 * Базові URL — відносні (/health, /api/v1/*): у dev їх проксює Vite
 * (див. vite.config.ts server.proxy), у Tauri вони same-origin.
 * /node/manifest СЬОГОДНІ у dev-проксі відсутній (проксюються лише
 * /api, /ws, /health, /docs, /redoc, /openapi.json) — тож у dev це
 * джерело чесно мовчить, доки власник проксі не додасть '/node'.
 */

import { readToken } from './tokenStore';

/* ─── Форми відповідей (звірені curl-ом з 127.0.0.1:8010, 2026-08-23) ── */

/** GET /health — публічний, без токена. */
export interface HealthPulse {
  status: string;
  version: string;
  hostname: string;
  ws_clients: number;
  esp32_connected: boolean;
  serial_enabled: boolean;
  /** Активний ШІ-двигун, напр. "gemini". */
  ai_active: string;
  /** Запасний двигун, напр. "ollama". */
  ai_fallback: string;
  /**
   * Придатність, а не вподобання (`ai/readiness.py`, коміт 4f68555).
   * `null` — стан не прочитано; це НЕ те саме, що `false`.
   * Ядро навмисно не ходить у хмару на кожен кадр: для Gemini дивиться
   * наявність ключа, для локальної моделі — коротка проба з кешем.
   */
  ai_ready?: boolean | null;
  /** Причина непридатності — готове речення від ядра, не наше. */
  ai_ready_reason?: string | null;
  ai_fallback_ready?: boolean | null;
  ai_fallback_reason?: string | null;
  /**
   * Чи модель уже в памʼяті. «Хост живий» і «модель завантажена» — різні
   * обіцянки людині: перший лист на холодну підіймає гігабайти.
   */
  ai_fallback_model_loaded?: boolean | null;
  /**
   * Де слухач TLS СПРАВДІ став (`bound`) і на якому порту. Єдине джерело
   * правди про адресу, за якою вузол видно іншому пристрою: браузерний
   * `location.origin` у розробці дає петлю, а в пакунку — asset-протокол.
   */
  tls_listening?: { bound: string[]; port: number; enabled: boolean } | null;
  /**
   * Стан моделі довготривалої памʼяті (Сесія 5, 604bef9). `reason` —
   * готове речення українською ДЛЯ ЛЮДИНИ; коли модель є, `present`
   * істинний і `reason` порожній. Скло не складає власного тексту:
   * ядро знає, чому саме памʼять не працює, а фронт цього не знає.
   */
  memory_model?: {
    model: string;
    present: boolean;
    path: string | null;
    download_allowed: boolean;
    searched?: string[];
    reason: string | null;
  };
}

/**
 * GET /api/v1/linux/resources — вимагає operator-токен
 * (backend/api/routes_linux.py: require_operator → resource_snapshot()).
 * Байти — сирі, форматування на боці подання.
 */
export interface LinuxResources {
  cpu_percent: number;
  ram_total: number;
  ram_used: number;
  ram_free: number;
  disk_total: number;
  disk_used: number;
  disk_free: number;
  uptime_s: number;
}

/** GET /node/manifest — публічна підписана ідентичність вузла. */
export interface NodeManifest {
  id: string;
  name: string;
  role: string;
  platform: string;
  schema: number;
  capabilities: string[];
  public_key: string;
  alg: string;
  signature: string;
}

/* ─── Pulse — «дані або чесне мовчання» ───────────────────────────────── */

export type SilenceReason =
  /** Мережа/таймаут/не-2xx — джерело недосяжне. */
  | 'unreachable'
  /** 401/403 — джерело живе, але цьому користувачу не відповідає. */
  | 'unauthorized';

export type Pulse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SilenceReason };

const SILENT_UNREACHABLE = { ok: false, reason: 'unreachable' } as const;
const SILENT_UNAUTHORIZED = { ok: false, reason: 'unauthorized' } as const;

/** Скільки чекаємо на джерело, перш ніж визнати його мовчазним. */
const PULSE_TIMEOUT_MS = 4000;

async function fetchPulse<T>(
  url: string,
  init?: RequestInit,
): Promise<Pulse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status === 401 || res.status === 403) return SILENT_UNAUTHORIZED;
    if (!res.ok) return SILENT_UNREACHABLE;
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return SILENT_UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Фетчі ───────────────────────────────────────────────────────────── */

export function fetchHealth(): Promise<Pulse<HealthPulse>> {
  return fetchPulse<HealthPulse>('/health');
}

export function fetchLinuxResources(): Promise<Pulse<LinuxResources>> {
  // sessionStorage через tokenStore — див. коментар у cockpitApi.ts:
  // читач localStorage тут мовчки віддавав «немає доступу» власникові.
  const token = readToken();
  if (!token) return Promise.resolve(SILENT_UNAUTHORIZED);
  return fetchPulse<LinuxResources>('/api/v1/linux/resources', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchNodeManifest(): Promise<Pulse<NodeManifest>> {
  return fetchPulse<NodeManifest>('/node/manifest');
}

/* ─── Ідентичність вузла: порт бекенда ────────────────────────────────── */

/**
 * Window-контракт: стартовий код (launch/desk-engine) може виставити
 * порт бекенда явно — доказ адресата, коли env недоступний.
 */
declare global {
  interface Window {
    __PHANTOM_BACKEND_PORT__?: number | string;
  }
}

/**
 * Порт бекенда, з яким реально говорить цей фронтенд.
 *
 * Ланцюг: import.meta.env.VITE_PHANTOM_BACKEND_PORT (Vite віддає
 * клієнту лише VITE_*-змінні; launch-запис стенда має ставити її поруч
 * із PHANTOM_BACKEND_PORT) → window.__PHANTOM_BACKEND_PORT__ → null.
 * null означає «порт невідомий» — стрічка показує «мовчить», НЕ
 * вигаданий дефолт: фронтенд, що мовчки бреше про адресата, — найгірший
 * клас дефекту цього дерева (див. коментар Ф0 у vite.config.ts).
 */
export function resolveBackendPort(): number | null {
  const fromEnv = import.meta.env?.VITE_PHANTOM_BACKEND_PORT as
    | string
    | undefined;
  const fromWindow =
    typeof window !== 'undefined' ? window.__PHANTOM_BACKEND_PORT__ : undefined;
  for (const raw of [fromEnv, fromWindow]) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return null;
}
