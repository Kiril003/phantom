import type {
  User,
  ChatMessage,
  ChatSession,
  ContextSnapshot,
  SystemState,
  SettingsCategory,
  SettingDefinition,
  WardrivingRecord,
  MapPOI,
  HeatmapPoint,
  TrackPoint,
  CliffScreeFeature,
  CliffScreeKind,
} from '@shared/types';
import { apiUrl } from './backendOrigin';
import { clearToken, readToken } from './tokenStore';

/**
 * Шлях API відносно бекенда. Абсолютну адресу додає `apiUrl()` — і лише
 * там, де вона потрібна.
 *
 * Тут був просто `'/api/v1'`, і в розробці цього досить: vite проксує. У
 * запакованому застосунку фронт віддається asset-протоколом Tauri, тож
 * відносний `fetch('/api/v1/…')` іде на `tauri.localhost`, а не на
 * sidecar — тобто **жоден** виклик API не доходить.
 *
 * Виміряно 29.08.2026 на зібраному AppImage: бекенд віддавав рівно одного
 * користувача (`phantom`), а екран входу малював чотирьох (Kiril, Kyrylo,
 * Alex, Phantom). Це не бекенд помилявся — це `authApi.picker()` падав, і
 * спрацьовував демо-фолбек. Я тоді ще й зарахував той список як доказ
 * живого HTTP; він був доказом протилежного.
 */
export const BASE = '/api/v1';

/** Повна адреса ендпойнта: абсолютна в пакунку, відносна в розробці. */
const endpoint = (path: string): string => apiUrl(`${BASE}${path}`);

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(endpoint(path), {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // Phase 10.4 fix 2: on expired/invalid token, drop it so the next
    // navigation hits the login screen instead of silently 401-ing again.
    // authApi.me() is the existing auto-login probe — excluded so it
    // can still fail-normal when no valid token exists.
    if (res.status === 401 && !path.startsWith('/auth/')) {
      try {
        clearToken();
        window.dispatchEvent(new CustomEvent('phantom:unauthorized'));
      } catch {
        /* SSR / restricted storage: ignore */
      }
    }
    const err = await res.json().catch(() => ({ detail: 'Unknown error', code: 'UNKNOWN' }));
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.detail ?? 'Unknown error');
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ─── Auth ────────────────────────────────────────────────────────────────── */

export interface AuthResponse {
  user: User;
  token: string;
  expires_at: string;
}

export const authApi = {
  loginRfid: (uid: string) =>
    request<AuthResponse>('POST', '/auth/login/rfid', { uid }),
  loginPin: (username: string, pin: string) =>
    request<AuthResponse>('POST', '/auth/login/pin', { username, pin }),
  refresh: () => request<{ token: string; expires_at: string }>('POST', '/auth/refresh'),
  door: (ticket: string) => request<AuthResponse>('POST', '/auth/door', { ticket }),
  me: () => request<User>('GET', '/auth/me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  config: () =>
    request<{ max_pin_attempts: number; lockout_duration_m: number; session_timeout_m: number }>(
      'GET',
      '/auth/config'
    ),
  // Обгортку «швидкого входу» знято 29.08.2026 разом із самим маршрутом на
  // бекенді: він видавав ROOT за одним лише іменем і пускав наявного
  // користувача з неправильним ПІНом. Її ніхто не викликав — див.
  // backend/tests/test_quick_join_is_not_a_way_past_the_pin.py
  // Day-4 Wave-2 IDB-3 (ADR-IDB-003): pre-PinPad picker tiles. Public —
  // safe to call WITHOUT a bearer token. Whitelist contract pinned at
  // backend tests/test_phase_idb2_shared_pin_picker.py.
  picker: () =>
    request<Array<{ id: string; username: string; avatar_url: string | null }>>(
      'GET',
      '/auth/users/picker'
    ),
};

/* ─── Chat ────────────────────────────────────────────────────────────────── */

export interface SendMessageRequest {
  content: string;
  input_method: 'voice' | 'text' | 'encoder';
  session_id?: string | null;
}

export const chatApi = {
  sendMessage: (req: SendMessageRequest) =>
    request<{ message: ChatMessage; session_id: string }>('POST', '/chat/message', req),
  getSessions: (limit = 20, offset = 0) =>
    request<{ sessions: ChatSession[]; total: number }>(
      'GET',
      `/chat/sessions?limit=${limit}&offset=${offset}`
    ),
  getMessages: (sessionId: string) =>
    request<{ messages: ChatMessage[] }>('GET', `/chat/sessions/${sessionId}/messages`),
  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>('DELETE', `/chat/sessions/${sessionId}`),
  updateSession: (sessionId: string, updates: { summary: string }) =>
    request<{ session: ChatSession }>('PUT', `/chat/sessions/${sessionId}`, updates),
};

/* ─── Context ─────────────────────────────────────────────────────────────── */

export const contextApi = {
  current: () => request<ContextSnapshot>('GET', '/context/current'),
  history: (minutes = 60) =>
    request<{ snapshots: ContextSnapshot[]; interval_ms: number }>(
      'GET',
      `/context/history?minutes=${minutes}`
    ),
  state: () =>
    request<{ state: SystemState; since: string; previous: SystemState }>('GET', '/context/state'),
  setState: (state: SystemState, trigger = 'manual') =>
    request<{ to: SystemState }>('POST', '/context/state', { state, trigger }),
};

/* ─── Voice ───────────────────────────────────────────────────────────────── */
// Voice client lives in `services/voiceApi.ts` — it owns the canonical
// `voiceApi.transcribe` / `voiceApi.synthesize` / `voiceApi.status` shape
// (typed `VoiceSTTResponse` with `wake_word_matched`, multi-engine union).
// The previous `voiceApi`/`TTSRequest`/`STTResponse` block lived here too
// but was never imported anywhere — only the voiceApi.ts copy was used —
// so the api.ts duplicate was dropped. Closes audit B-15 + B-16.

/* ─── Settings ────────────────────────────────────────────────────────────── */

export const settingsApi = {
  getAll: () => request<{ categories: SettingsCategory[] }>('GET', '/settings'),
  get: (key: string) =>
    request<{ key: string; value: unknown; definition: SettingDefinition }>('GET', `/settings/${key}`),
  set: (key: string, value: unknown) =>
    request<{ key: string; value: unknown; requires_restart: boolean }>(
      'PUT',
      `/settings/${key}`,
      { value }
    ),
  reset: (category?: string) =>
    request<{ ok: boolean; reset_count: number }>('POST', '/settings/reset', {
      category: category ?? null,
    }),
  export: () =>
    request<{ settings: Record<string, unknown>; exported_at: string }>('POST', '/settings/export'),
  import: (settings: Record<string, unknown>) =>
    request<{ ok: boolean; imported_count: number; skipped: number }>('POST', '/settings/import', {
      settings,
    }),
};

/* ─── Map & Wardriving ────────────────────────────────────────────────────── */

export interface Bounds {
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
}

export const mapApi = {
  getWardriving: (bounds?: Bounds, since?: string, limit = 5000) => {
    const params = new URLSearchParams();
    if (bounds) params.set('bounds', `${bounds.lat1},${bounds.lon1},${bounds.lat2},${bounds.lon2}`);
    if (since) params.set('since', since);
    params.set('limit', String(limit));
    return request<{ records: WardrivingRecord[]; total: number }>(
      'GET',
      `/map/wardriving?${params}`
    );
  },
  getHeatmap: (bounds?: Bounds, minWeight = 0) => {
    const params = new URLSearchParams();
    if (bounds) params.set('bounds', `${bounds.lat1},${bounds.lon1},${bounds.lat2},${bounds.lon2}`);
    if (minWeight > 0) params.set('min_weight', String(minWeight));
    return request<{ points: HeatmapPoint[] }>('GET', `/map/heatmap?${params}`);
  },
  getCliffScree: (bounds: Bounds, kinds?: CliffScreeKind[]) => {
    const params = new URLSearchParams();
    params.set('bounds', `${bounds.lat1},${bounds.lon1},${bounds.lat2},${bounds.lon2}`);
    if (kinds?.length) params.set('kinds', kinds.join(','));
    return request<{ type: 'FeatureCollection'; features: CliffScreeFeature[]; total: number }>(
      'GET',
      `/map/hazards/cliff_scree?${params}`
    );
  },
  getPOIs: (category?: string) => {
    const params = category ? `?category=${category}` : '';
    return request<{ pois: MapPOI[] }>('GET', `/map/pois${params}`);
  },
  createPOI: (poi: Omit<MapPOI, 'id' | 'created_at' | 'user_id'>) =>
    request<MapPOI>('POST', '/map/pois', poi),
  deletePOI: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/map/pois/${id}`),
  getTrack: (hours = 2) =>
    request<{ points: TrackPoint[] }>('GET', `/map/track?hours=${hours}`),
  getLocationHistory: (fromIso?: string, toIso?: string, limit = 500) => {
    const params = new URLSearchParams();
    if (fromIso) params.set('from', fromIso);
    if (toIso) params.set('to', toIso);
    params.set('limit', String(limit));
    return request<{ entries: LocationHistoryEntry[]; total: number }>(
      'GET',
      `/map/location_history?${params}`,
    );
  },
  getNearby: (lat: number, lon: number, radiusM = 500) => {
    const params = new URLSearchParams();
    params.set('lat', String(lat));
    params.set('lon', String(lon));
    params.set('radius_m', String(radiusM));
    return request<NearbyResponse>('GET', `/map/nearby?${params}`);
  },
  // Phase 24-C — forward-geocode free text → candidate coordinates.
  geocode: (query: string, limit = 5) =>
    request<{ results: GeocodeCandidate[] }>('POST', '/map/geocode', { query, limit }),
  // Phase 24-C — plan a route through ordered [lat, lon] waypoints.
  planRoute: (waypoints: [number, number][], profile = 'car') =>
    request<RouteResult>('POST', '/map/route', { waypoints, profile }),
  // Phase 9.4c audit Q6 — offline banner source-of-truth.
  getServicesHealth: () =>
    request<{ services: Record<string, ServiceHealth> }>('GET', '/map/services_health'),
  // Phase 9.4c audit G6 — geo-tagged MemoryFacts for the FactMarkerLayer.
  getGeoTaggedFacts: (limit = 500) =>
    request<{ facts: GeoTaggedFact[]; total: number }>(
      'GET',
      `/map/geo_tagged_facts?limit=${limit}`,
    ),
  // Phase 24-A — OmniMap Layer Registry.
  getLayers: (opts?: {
    category?: string;
    offline?: boolean;
    requireRoot?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set('category', opts.category);
    if (opts?.offline !== undefined) params.set('offline', String(opts.offline));
    if (opts?.requireRoot !== undefined) params.set('require_root', String(opts.requireRoot));
    const qs = params.toString();
    return request<LayerRegistryResponse>(
      'GET',
      `/map/layers${qs ? `?${qs}` : ''}`,
    );
  },
  enableLayer: (layerId: string) =>
    request<AttributionPayload & { activated?: { layer_id: string; via: string; activated_at: number } }>(
      'POST',
      `/map/layers/${encodeURIComponent(layerId)}/enable`,
    ),
  disableLayer: (layerId: string) =>
    request<AttributionPayload & { was_active?: boolean }>(
      'DELETE',
      `/map/layers/${encodeURIComponent(layerId)}`,
    ),
  getAttribution: () =>
    request<AttributionPayload>('GET', '/map/attribution'),

  /**
   * Що ПК може використати, щоб дізнатись своє місце: останній фікс із
   * спареного телефона і точки доступу, які він бачив. Рішення, кому
   * вірити, ухвалює клієнт — тут лише сировина.
   */
  positionSources: () =>
    request<PositionSources>('GET', '/map/position_sources'),
  // Phase 24-G — Offline region manager.
  getOfflineRegions: () =>
    request<OfflineRegionsResponse>('GET', '/map/offline/regions'),
  deleteOfflineRegion: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/map/offline/regions/${encodeURIComponent(id)}`),
  // Phase 24-I — Geofences.
  getGeofences: () =>
    request<GeofenceResponse[]>('GET', '/map/geofences/'),

  /**
   * Профіль висот уздовж шляху; точки — `[lat, lon]`.
   *
   * Тут стояли сирі `get`/`post`, які додавали лише `/api/v1` без `/map`.
   * Єдиний виклик, який ними скористався, промазав повз маршрут із першого
   * разу і 404-ив мовчки. Префікс не має бути справою того, хто викликає.
   */
  elevationProfile: (points: [number, number][]) =>
    request<{ profile: ElevationProfilePoint[] }>(
      'POST', '/map/elevation/profile', { points },
    ),
};

export interface ElevationProfilePoint {
  distance_m: number;
  elevation_m: number;
}

// ── Phase 24-I — Geofence types ──────────────────────────────────────────

export interface GeofenceResponse {
  id: string;
  label: string;
  kind: string;
  geometry: any;
  is_active: boolean;
  on_enter: any[];
  on_exit: any[];
  created_at: string;
}

// ── Phase 24-G — Offline region manager types ────────────────────────────

export interface OfflineRegion {
  id: string;
  name: string;
  file_path: string;
  size_bytes: number;
  mtime: number;
  layers: string[];
}

export interface OfflineRegionsResponse {
  regions: OfflineRegion[];
  total: number;
  capacity_bytes: number;
  used_bytes: number;
}

// ── Phase 24-A — OmniMap Layer Registry types ────────────────────────────

export type LayerCategory =
  | 'base'
  | 'terrain'
  | 'personal'
  | 'reference'
  | 'tourism'
  | 'ukraine'
  | 'live'
  | 'environment'
  | 'astronomy'
  | 'infra'
  | 'osint'
  | 'hacker'
  | 'research'
  | 'marine'
  | 'aviation'
  | 'health'
  | 'generic'
  | 'fun';

export interface LayerManifest {
  id: string;
  name_ua: string;
  name_en: string;
  category: LayerCategory;
  license: string;
  attribution: string;
  source: {
    type: string;
    url?: string | null;
    auth?: { kind: string } | null;
    poll_interval_s?: number | null;
    ttl_s: number;
    bbox_required: boolean;
    rate_limit_per_minute?: number | null;
    extras: Record<string, string | number | boolean>;
  };
  geometry: string;
  style: {
    fill?: string | null;
    fill_opacity: number;
    stroke?: string | null;
    stroke_width: number;
    point_radius: number;
    pulse: boolean;
    icon?: string | null;
    legend: Array<{ label: string; color: string }>;
  };
  agent_verbs: string[];
  require_internet: boolean;
  require_setting?: string | null;
  require_root: boolean;
  private: boolean;
  priority: 'background' | 'normal' | 'elevated' | 'critical';
  default_active: boolean;
  available_offline: boolean;
  tags: string[];
  active: boolean;
}

export interface LayerRegistryResponse {
  layers: LayerManifest[];
  total: number;
  categories: LayerCategory[];
  load_errors: Array<{ file: string; error: string }>;
}

export interface AttributionLine {
  text: string;
  license: string;
  layer_ids: string[];
}

export interface AttributionPayload {
  session_id: string;
  active_layer_ids: string[];
  attribution: AttributionLine[];
}

export interface GeoTaggedFact {
  id: string;
  content: string;
  category: string;
  importance: number;
  place_name: string | null;
  place_lat: number;
  place_lon: number;
  place_source: string | null;
  place_confidence: number | null;
  created_at: string;
}

export type ServiceStatus = 'ok' | 'stale' | 'down' | 'unknown';

export interface ServiceHealth {
  status: ServiceStatus;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_reason: string | null;
  seconds_since_success: number | null;
}

export interface LocationHistoryEntry {
  id: string;
  lat: number;
  lon: number;
  source: string;
  confidence: number;
  accuracy_m: number | null;
  place_name: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  timestamp: string;
}

export interface NearbyRememberedItem {
  id: string;
  content: string;
  category: string;
  importance: number;
  place_name: string | null;
  place_lat: number | null;
  place_lon: number | null;
  place_source: string | null;
  place_confidence: number | null;
  distance_m: number;
  created_at: string;
}

export interface NearbyOsmItem {
  osm_id: number;
  name: string | null;
  type: string | null;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  distance_m: number;
}

export interface NearbyPoiItem {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  distance_m: number;
}

export interface NearbyResponse {
  remembered: NearbyRememberedItem[];
  osm: NearbyOsmItem[];
  pois: NearbyPoiItem[];
}

/* ─── Routing / geocoding ───────────────────────────────────────────────── */

export interface PositionSourceAp {
  mac: string;
  ssid: string;
  rssi: number;
  lat: number | null;
  lon: number | null;
}

export interface PositionSourcePhone {
  device_id: string;
  device_name: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  motion_class: string | null;
  age_s: number;
}

export interface PositionSources {
  phone: PositionSourcePhone | null;
  aps: PositionSourceAp[];
  paired_devices: number;
}

export interface GeocodeCandidate {
  lat: number;
  lon: number;
  display_name: string;
  type: string | null;
  importance: number | null;
}

/** GeoJSON LineString: coordinates are [lon, lat] pairs. */
export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteAlternative {
  distance_m: number;
  duration_s: number;
  geometry: RouteGeometry;
  summary: string;
  extras: Record<string, unknown>;
}

export interface RouteResult {
  primary: RouteAlternative;
  alternatives: RouteAlternative[];
  profile: string;
  engine: string;
  cached: boolean;
  extras: Record<string, unknown>;
}

/* ─── Linux ───────────────────────────────────────────────────────────────── */

export interface ExecuteRequest {
  command: string;
  timeout_s?: number;
  confirmed?: boolean;
}

export interface ExecuteResponse {
  id: string;
  status: 'running' | 'completed' | 'error' | 'needs_confirm';
  stdout: string;
  stderr: string;
  exit_code: number | null;
  dangerous: boolean;
  explanation: string;
}

export const linuxApi = {
  execute: (req: ExecuteRequest) =>
    request<ExecuteResponse>('POST', '/linux/execute', req),
  resources: () =>
    request<{
      cpu_percent: number;
      ram_used_mb: number;
      ram_total_mb: number;
      disk_used_gb: number;
      disk_total_gb: number;
      temperature_c: number | null;
      load_average: [number, number, number];
    }>('GET', '/linux/resources'),
};

/* ─── AI ──────────────────────────────────────────────────────────────────── */

export interface OllamaModelInfo {
  name: string;
  size?: number | null;
  parameter_size?: string | null;
  quantization?: string | null;
  family?: string | null;
}

export interface AIModelsResponse {
  ok: boolean;
  host: string;
  models: OllamaModelInfo[];
  error?: string | null;
}

export interface AITestResponse {
  ok: boolean;
  provider: string;
  latency_ms: number;
  reply_preview?: string | null;
  error?: string | null;
}

export const aiApi = {
  listModels: () => request<AIModelsResponse>('GET', '/ai/models'),
  test: (provider: 'ollama' | 'gemini') =>
    request<AITestResponse>('POST', '/ai/test', { provider }),
  reset: () =>
    request<{ ok: boolean; message: string }>('POST', '/ai/reset'),
};

/* ─── Tools ───────────────────────────────────────────────────────────────── */

export const toolsApi = {
  createTimer: (duration_s: number, label: string) =>
    request<{ id: string; ends_at: string }>('POST', '/tools/timer', { duration_s, label }),
  createAlarm: (time: string, repeat: 'daily' | 'weekdays' | 'once', label: string) =>
    request<{ id: string; next_trigger: string }>('POST', '/tools/alarm', { time, repeat, label }),
  getCalendar: (range: 'day' | 'week' | 'month' = 'week') =>
    request<{ events: unknown[] }>('GET', `/tools/calendar?range=${range}`),
  createEvent: (event: unknown) =>
    request<unknown>('POST', '/tools/calendar/events', event),
};

/* ─── Pair (Phase 19 Mobile Companion) ───────────────────────────────────── */

export interface PairQrPayload {
  v: number;
  host: string;
  ip: string;
  port: number;
  pair_id: string;
  server_pub: string;
  server_cert_sha256: string;
  exp: number;
  nonce: string;
}

export interface PairInitResponse {
  pair_id: string;
  expires_in_seconds: number;
  qr: PairQrPayload;
  qr_svg_data_url: string;
}

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
}

export const pairApi = {
  init: () => request<PairInitResponse>('POST', '/pair/init'),
  status: (pairId: string) =>
    request<{ pair_id: string; status: 'pending' | 'closed'; device_id: string | null }>(
      'GET',
      `/pair/status?pair_id=${encodeURIComponent(pairId)}`
    ),
  listDevices: (includeRevoked = false) =>
    request<PairedDeviceRow[]>(
      'GET',
      `/pair/devices${includeRevoked ? '?include_revoked=true' : ''}`
    ),
  revoke: (deviceId: string, reason?: string) =>
    request<{ ok: boolean; already_revoked?: boolean }>(
      'DELETE',
      `/pair/devices/${encodeURIComponent(deviceId)}${
        reason ? `?reason=${encodeURIComponent(reason)}` : ''
      }`
    ),
};

// ─── Phase 25-E — Personal Vault ─────────────────────────────────────────────

export type VaultCardKind =
  | 'email_account' | 'service_login' | 'messenger' | 'phone'
  | 'company' | 'payment_method' | 'api_key' | 'document'
  | 'contact' | 'wifi_network' | 'crypto_wallet' | 'custom';

export interface VaultCard {
  id: string;
  kind: VaultCardKind;
  label: string;
  tags: string[];
  ai_writable: boolean;
  fields: Record<string, string>;          // plain values OR "***" for secrets
  field_kinds: Record<string, 'plain' | 'secret'>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

export interface VaultFieldInput {
  value: string;
  secret: boolean;
}

export interface VaultCardCreate {
  kind: VaultCardKind;
  label: string;
  fields: Record<string, VaultFieldInput>;
  tags?: string[];
  ai_writable?: boolean;
}

export interface VaultCardPatch {
  label?: string;
  fields?: Record<string, VaultFieldInput>;
  tags?: string[];
  ai_writable?: boolean;
}

export interface VaultAuditEntry {
  id: string;
  user_id: string;
  card_id: string | null;
  action: string;
  actor: 'user' | 'ai';
  details: Record<string, unknown>;
  created_at: string;
}

export const vaultApi = {
  list: (opts: { kind?: VaultCardKind; tag?: string; includeDeleted?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (opts.kind) qs.set('kind', opts.kind);
    if (opts.tag) qs.set('tag', opts.tag);
    if (opts.includeDeleted) qs.set('include_deleted', 'true');
    const tail = qs.toString();
    return request<{ cards: VaultCard[] }>(
      'GET', `/vault/cards${tail ? `?${tail}` : ''}`,
    );
  },
  get: (cardId: string) =>
    request<VaultCard>('GET', `/vault/cards/${encodeURIComponent(cardId)}`),
  create: (payload: VaultCardCreate) =>
    request<VaultCard>('POST', '/vault/cards', payload),
  patch: (cardId: string, payload: VaultCardPatch) =>
    request<VaultCard>('PATCH', `/vault/cards/${encodeURIComponent(cardId)}`, payload),
  remove: (cardId: string) =>
    request<void>('DELETE', `/vault/cards/${encodeURIComponent(cardId)}`),
  restore: (cardId: string) =>
    request<VaultCard>('POST', `/vault/cards/${encodeURIComponent(cardId)}/restore`),
  reveal: (cardId: string, fieldName: string, justification: string) =>
    request<{
      card_id: string;
      field_name: string;
      value: string;
      revealed_at: string;
    }>('POST', `/vault/cards/${encodeURIComponent(cardId)}/reveal`, {
      field_name: fieldName,
      justification,
    }),
  audit: (cardId?: string, limit = 100) => {
    const qs = new URLSearchParams();
    if (cardId) qs.set('card_id', cardId);
    qs.set('limit', String(limit));
    return request<{ entries: VaultAuditEntry[] }>(
      'GET', `/vault/audit?${qs.toString()}`,
    );
  },
};


export { ApiError };
