/**
 * Face API client — Phase 08.
 *
 * Embeddings are derived browser-side from MediaPipe FaceLandmarker and
 * posted to the backend, which only stores / compares them. Raw video
 * frames never leave the device.
 */

const BASE = '/api/v1';

function _authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('phantom_token');
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export interface FaceEnrollResponse {
  ok: boolean;
  user_id: string;
  sample_count: number;
  dim: number;
}

export interface FaceRecognizeResponse {
  matched: boolean;
  user_id: string | null;
  username: string | null;
  role: string | null;
  confidence: number;
  threshold: number;
}

export interface FaceStatusResponse {
  enabled: boolean;
  auto_switch_profile: boolean;
  privacy_mode: 'off' | 'landmarks' | 'full';
  threshold: number;
  unknown_lockout_s: number;
  enrolled_users: number;
  has_my_embedding: boolean | null;
  system_state: string;
  oled_enabled: boolean;
}

export interface FaceMeResponse {
  user_id: string;
  username: string;
  has_embedding: boolean;
}

async function _parseErr(res: Response, fallback: string): Promise<Error> {
  try {
    const j = await res.json();
    return new Error(j?.detail || fallback);
  } catch {
    return new Error(`${fallback} (HTTP ${res.status})`);
  }
}

export const faceApi = {
  enroll: async (samples: number[][]): Promise<FaceEnrollResponse> => {
    const res = await fetch(`${BASE}/face/enroll`, {
      method: 'POST',
      credentials: 'include',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ samples }),
    });
    if (!res.ok) throw await _parseErr(res, 'Face enroll failed');
    return (await res.json()) as FaceEnrollResponse;
  },

  recognize: async (embedding: number[]): Promise<FaceRecognizeResponse> => {
    const res = await fetch(`${BASE}/face/recognize`, {
      method: 'POST',
      credentials: 'include',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ embedding }),
    });
    if (!res.ok) throw await _parseErr(res, 'Face recognize failed');
    return (await res.json()) as FaceRecognizeResponse;
  },

  deleteEmbedding: async (): Promise<{ ok: boolean; removed: boolean }> => {
    const res = await fetch(`${BASE}/face/embedding`, {
      method: 'DELETE',
      credentials: 'include',
      headers: _authHeaders(),
    });
    if (!res.ok) throw await _parseErr(res, 'Face delete failed');
    return (await res.json()) as { ok: boolean; removed: boolean };
  },

  status: async (): Promise<FaceStatusResponse> => {
    const res = await fetch(`${BASE}/face/status`, {
      credentials: 'include',
      headers: _authHeaders(),
    });
    if (!res.ok) throw await _parseErr(res, 'Face status failed');
    return (await res.json()) as FaceStatusResponse;
  },

  me: async (): Promise<FaceMeResponse> => {
    const res = await fetch(`${BASE}/face/me`, {
      credentials: 'include',
      headers: _authHeaders(),
    });
    if (!res.ok) throw await _parseErr(res, 'Face me failed');
    return (await res.json()) as FaceMeResponse;
  },
};
