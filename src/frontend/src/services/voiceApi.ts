/**
 * Voice API client — talks to the Phase-07 /api/v1/voice routes.
 *
 * All calls go through the same fetch helper as the rest of api.ts (cookie
 * + bearer token, 401 propagation). STT takes a Blob (MediaRecorder output
 * or a file), TTS returns a Blob so the caller can turn it into an
 * object URL for <audio>.
 */

import { request, BASE } from './api';
import { readToken } from './tokenStore';

function _authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = readToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export interface VoiceSTTResponse {
  text: string;
  confidence: number;
  engine: 'whisper' | 'vosk' | 'noop' | string;
  language: string;
  wake_word_matched: boolean;
}

export interface VoiceStatusResponse {
  stt_engine: string;
  tts_engine: string;
  stt_mode: string;
  language: string;
  tts_enabled: boolean;
  tts_voice: string;
  wake_word_enabled: boolean;
  wake_words: string;
  /** Phase 15 — Hexagon NPU diagnostic. */
  npu_enabled: boolean;
  npu_available: boolean;
  npu_active: boolean;
  npu_encoder_loaded: boolean;
  npu_model_path: string;
  npu_compute: string;
  npu_providers: string;
}

export const voiceApi = {
  /** Upload a recorded clip and get the transcript back. */
  transcribe: async (blob: Blob, filename = 'clip.webm'): Promise<VoiceSTTResponse> => {
    const form = new FormData();
    form.append('file', blob, filename);
    const res = await fetch(`${BASE}/voice/stt`, {
      method: 'POST',
      credentials: 'include',
      headers: _authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'STT failed' }));
      throw new Error(err.detail || `STT HTTP ${res.status}`);
    }
    return (await res.json()) as VoiceSTTResponse;
  },

  /**
   * Synthesize `text` to a WAV blob. Empty voice/speed fall through to
   * whatever is set in Settings → Voice.
   */
  synthesize: async (
    text: string,
    opts: { voice?: string; speed?: number; emotionScale?: number } = {}
  ): Promise<{ blob: Blob; engine: string; sampleRate: number }> => {
    const res = await fetch(`${BASE}/voice/tts`, {
      method: 'POST',
      credentials: 'include',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        text,
        voice: opts.voice ?? '',
        speed: opts.speed ?? 1.0,
        emotion_scale: opts.emotionScale ?? 1.0,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'TTS failed' }));
      throw new Error(err.detail || `TTS HTTP ${res.status}`);
    }
    const blob = await res.blob();
    return {
      blob,
      engine: res.headers.get('X-Engine') ?? 'unknown',
      sampleRate: Number(res.headers.get('X-Sample-Rate') ?? 22050),
    };
  },

  status: () => request<VoiceStatusResponse>('GET', '/voice/status'),

  /**
   * The operator's explicit "stop talking" — the only interrupt that
   * doesn't require saying or typing something else. `stopped: false`
   * just means nothing was on air when the request landed (not an
   * error — the caller races the last sentence ending on its own).
   */
  stop: () => request<{ stopped: boolean }>('POST', '/voice/stop'),
};
