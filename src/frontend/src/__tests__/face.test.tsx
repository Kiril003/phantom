/**
 * Phase 08 — Face API + store + OLED preview rendering tests.
 *
 * We cover the boundaries, not the MediaPipe ML pipeline (jsdom can't
 * load CDN WASM in unit tests):
 *   * faceApi HTTP contract (enroll / recognize / delete / status).
 *   * faceStore state machine for enrollment.
 *   * computeEmbedding deterministic + L2-normalised.
 *   * OledEyePreview renders different geometries per eye_state.
 */
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { faceApi } from '../services/faceApi';
import { useFaceStore } from '../stores/faceStore';
import { useOledStore } from '../stores/oledStore';
import { computeEmbedding } from '../hooks/useFaceDetection';
import { OledEyePreview } from '../components/core/OledEyePreview';
import { SystemState } from '@shared/types';
import { useSystemStore } from '../stores/systemStore';

/* ─── fetch stubbing helper ────────────────────────────────────────────── */

function mockFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const status = response.status ?? 200;
  const res = new Response(JSON.stringify(response.body ?? {}), {
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...(response.headers ?? {}) }),
  });
  return vi.fn().mockResolvedValue(res);
}

/* ═══════════════════════════════════════════════════════════════════════════
   faceApi contract
   ═══════════════════════════════════════════════════════════════════════════ */

describe('faceApi', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('enroll posts JSON samples to /face/enroll', async () => {
    const stub = mockFetch({
      body: { ok: true, user_id: 'u1', sample_count: 5, dim: 60 },
    });
    globalThis.fetch = stub as unknown as typeof fetch;

    const samples = [[0.1, 0.2, 0.3], [0.15, 0.22, 0.31]];
    const res = await faceApi.enroll(samples);
    expect(res.ok).toBe(true);
    expect(res.sample_count).toBe(5);

    const [url, init] = stub.mock.calls[0];
    expect(url).toBe('/api/v1/face/enroll');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.samples).toEqual(samples);
  });

  it('recognize returns matched+confidence', async () => {
    const stub = mockFetch({
      body: {
        matched: true,
        user_id: 'u1',
        username: 'phantom',
        role: 'ROOT',
        confidence: 0.93,
        threshold: 0.75,
      },
    });
    globalThis.fetch = stub as unknown as typeof fetch;

    const resp = await faceApi.recognize([0.1, 0.2, 0.3]);
    expect(resp.matched).toBe(true);
    expect(resp.username).toBe('phantom');
    expect(resp.confidence).toBe(0.93);
  });

  it('propagates backend error detail on non-2xx', async () => {
    const stub = mockFetch({
      status: 503,
      body: { detail: 'GHOST state forces camera off' },
    });
    globalThis.fetch = stub as unknown as typeof fetch;
    await expect(faceApi.recognize([0.1])).rejects.toThrow(/GHOST/);
  });

  it('deleteEmbedding DELETEs and returns removed flag', async () => {
    const stub = mockFetch({ body: { ok: true, removed: true } });
    globalThis.fetch = stub as unknown as typeof fetch;
    const res = await faceApi.deleteEmbedding();
    expect(res.removed).toBe(true);
    const [, init] = stub.mock.calls[0];
    expect(init.method).toBe('DELETE');
  });

  it('status GETs /face/status', async () => {
    const stub = mockFetch({
      body: {
        enabled: true,
        auto_switch_profile: true,
        privacy_mode: 'landmarks',
        threshold: 0.75,
        unknown_lockout_s: 10,
        enrolled_users: 1,
        has_my_embedding: null,
        system_state: 'SHADOW',
        oled_enabled: true,
      },
    });
    globalThis.fetch = stub as unknown as typeof fetch;
    const s = await faceApi.status();
    expect(s.enabled).toBe(true);
    expect(s.privacy_mode).toBe('landmarks');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   computeEmbedding — math properties
   ═══════════════════════════════════════════════════════════════════════════ */

describe('computeEmbedding', () => {
  /** Build a fake 468-landmark array. Same "face" produces same embedding. */
  function fakeLandmarks(seed: number): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 468; i++) {
      out.push({
        x: seed + 0.001 * i,
        y: 0.5 + 0.0005 * i,
        z: 0.01 * Math.sin(i + seed),
      });
    }
    return out;
  }

  it('returns a fixed-dim L2-normalised vector', () => {
    const emb = computeEmbedding(fakeLandmarks(0.3));
    // Fixed anchor set — length is stable. Currently 21 landmarks × 3 dims.
    expect(emb.length).toBe(63);
    const norm = Math.sqrt(emb.reduce((a, v) => a + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('is deterministic for the same input', () => {
    const a = computeEmbedding(fakeLandmarks(0.4));
    const b = computeEmbedding(fakeLandmarks(0.4));
    expect(a).toEqual(b);
  });

  it('differs for clearly different faces', () => {
    const a = computeEmbedding(fakeLandmarks(0.4));
    const b = computeEmbedding(fakeLandmarks(0.9));
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-6) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it('returns empty for short landmark list', () => {
    expect(computeEmbedding([{ x: 0, y: 0, z: 0 }])).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   faceStore — enrollment state machine
   ═══════════════════════════════════════════════════════════════════════════ */

describe('faceStore', () => {
  beforeEach(() => {
    // Reset the store between tests.
    useFaceStore.setState({
      enabled: true,
      running: false,
      ready: false,
      lastDetection: null,
      recognized: null,
      unknownSince: null,
      enrollSamples: [],
      enrollStatus: 'idle',
      enrollError: null,
      cameraError: null,
      threshold: 0.75,
      privacyMode: 'landmarks',
    });
  });

  it('startEnrollment clears samples and moves to collecting', () => {
    const { result } = renderHook(() => useFaceStore());
    act(() => {
      result.current.pushEnrollmentSample([0.1, 0.2]);
      result.current.pushEnrollmentSample([0.2, 0.3]);
      result.current.startEnrollment();
    });
    expect(result.current.enrollSamples.length).toBe(0);
    expect(result.current.enrollStatus).toBe('collecting');
  });

  it('pushEnrollmentSample appends samples while collecting', () => {
    const { result } = renderHook(() => useFaceStore());
    act(() => {
      result.current.startEnrollment();
      result.current.pushEnrollmentSample([0.1]);
      result.current.pushEnrollmentSample([0.2]);
    });
    expect(result.current.enrollSamples.length).toBe(2);
  });

  it('setEnrollStatus propagates error text', () => {
    const { result } = renderHook(() => useFaceStore());
    act(() => {
      result.current.setEnrollStatus('error', 'backend blew up');
    });
    expect(result.current.enrollStatus).toBe('error');
    expect(result.current.enrollError).toBe('backend blew up');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   OledEyePreview — SVG renders different frames
   ═══════════════════════════════════════════════════════════════════════════ */

describe('OledEyePreview', () => {
  beforeEach(() => {
    useSystemStore.setState({ state: SystemState.SHADOW });
    useOledStore.setState({ frame: null });
  });

  it('renders default calm preview when no WS frame yet', () => {
    const { container } = render(<OledEyePreview />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const ellipses = container.querySelectorAll('ellipse');
    expect(ellipses.length).toBe(2);
  });

  it('applies frame dimensions from the oledStore', () => {
    useOledStore.setState({
      frame: {
        eye_state: 'alert',
        eye_l: { cx: 30, cy: 28, rx: 11, ry: 15, opacity: 1 },
        eye_r: { cx: 70, cy: 28, rx: 11, ry: 15, opacity: 1 },
        brightness: 255,
        ts_ms: 1,
        system_state: 'SENTINEL',
        mood: 'alert',
      },
    });
    const { container } = render(<OledEyePreview />);
    const ellipses = container.querySelectorAll('ellipse');
    expect(ellipses[0].getAttribute('rx')).toBe('11');
    expect(ellipses[0].getAttribute('ry')).toBe('15');
  });

  it('renders nothing in GHOST state', () => {
    useSystemStore.setState({ state: SystemState.GHOST });
    const { container } = render(<OledEyePreview />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
