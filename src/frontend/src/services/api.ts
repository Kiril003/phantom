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
} from '@shared/types';

const BASE = '/api/v1';

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = localStorage.getItem('phantom_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
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
    if (res.status === 401 && path !== '/auth/me') {
      try {
        localStorage.removeItem('phantom_token');
        localStorage.removeItem('phantom_token_expires');
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
  me: () => request<User>('GET', '/auth/me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  config: () =>
    request<{ max_pin_attempts: number; lockout_duration_m: number; session_timeout_m: number }>(
      'GET',
      '/auth/config'
    ),
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
};

/* ─── Voice ───────────────────────────────────────────────────────────────── */

export interface TTSRequest {
  text: string;
  voice: string;
  speed: number;
  emotion_scale: number;
}

export interface STTResponse {
  text: string;
  confidence: number;
  engine: 'whisper' | 'vosk';
  language: string;
}

export const voiceApi = {
  tts: async (req: TTSRequest): Promise<Blob> => {
    const token = localStorage.getItem('phantom_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}/voice/tts`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new ApiError(res.status, 'TTS_ERROR', 'TTS request failed');
    return res.blob();
  },
  stt: async (audioBlob: Blob): Promise<STTResponse> => {
    const token = localStorage.getItem('phantom_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const form = new FormData();
    form.append('file', audioBlob, 'audio.wav');

    const res = await fetch(`${BASE}/voice/stt`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
    if (!res.ok) throw new ApiError(res.status, 'STT_ERROR', 'STT request failed');
    return res.json();
  },
};

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
  // Phase 9.4c audit Q6 — offline banner source-of-truth.
  getServicesHealth: () =>
    request<{ services: Record<string, ServiceHealth> }>('GET', '/map/services_health'),
  // Phase 9.4c audit G6 — geo-tagged MemoryFacts for the FactMarkerLayer.
  getGeoTaggedFacts: (limit = 500) =>
    request<{ facts: GeoTaggedFact[]; total: number }>(
      'GET',
      `/map/geo_tagged_facts?limit=${limit}`,
    ),
};

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

export { ApiError };
