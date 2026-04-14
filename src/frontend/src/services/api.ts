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
  loginRfid: (uid_hash: string) =>
    request<AuthResponse>('POST', '/auth/login/rfid', { uid_hash }),
  loginPin: (username: string, pin: string) =>
    request<AuthResponse>('POST', '/auth/login/pin', { username, pin }),
  refresh: () => request<{ token: string; expires_at: string }>('POST', '/auth/refresh'),
  me: () => request<User>('GET', '/auth/me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
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
  getWardriving: (bounds?: Bounds, since?: string) => {
    const params = new URLSearchParams();
    if (bounds) params.set('bounds', `${bounds.lat1},${bounds.lon1},${bounds.lat2},${bounds.lon2}`);
    if (since) params.set('since', since);
    return request<{ records: WardrivingRecord[]; total: number }>(
      'GET',
      `/map/wardriving?${params}`
    );
  },
  getHeatmap: (bounds?: Bounds) => {
    const params = new URLSearchParams();
    if (bounds) params.set('bounds', `${bounds.lat1},${bounds.lon1},${bounds.lat2},${bounds.lon2}`);
    return request<{ points: Array<{ lat: number; lon: number; weight: number }> }>(
      'GET',
      `/map/heatmap?${params}`
    );
  },
  getPOIs: (category?: string) => {
    const params = category ? `?category=${category}` : '';
    return request<{ pois: MapPOI[] }>('GET', `/map/pois${params}`);
  },
  createPOI: (poi: Omit<MapPOI, 'id' | 'created_at'>) =>
    request<MapPOI>('POST', '/map/pois', poi),
  getTrack: (hours = 2) =>
    request<{ points: Array<{ lat: number; lon: number; ts: string; speed: number }> }>(
      'GET',
      `/map/track?hours=${hours}`
    ),
};

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
