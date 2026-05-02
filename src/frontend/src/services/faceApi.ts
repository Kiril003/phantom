/**
 * Face API client — Phase 08.
 *
 * Embeddings are derived browser-side from MediaPipe FaceLandmarker and
 * posted to the backend, which only stores / compares them. Raw video
 * frames never leave the device.
 */

import { request } from './api';

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



export const faceApi = {
  enroll: (samples: number[][]) =>
    request<FaceEnrollResponse>('POST', '/face/enroll', { samples }),

  recognize: (embedding: number[]) =>
    request<FaceRecognizeResponse>('POST', '/face/recognize', { embedding }),

  deleteEmbedding: () =>
    request<{ ok: boolean; removed: boolean }>('DELETE', '/face/embedding'),

  status: () =>
    request<FaceStatusResponse>('GET', '/face/status'),

  me: () =>
    request<FaceMeResponse>('GET', '/face/me'),
};
