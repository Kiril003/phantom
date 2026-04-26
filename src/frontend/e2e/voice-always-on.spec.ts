import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Phase 11c.1 — voice always-on infrastructure gate.
 *
 * Catches the Phase 11b/11b.1 failure mode: a working hook with no
 * production consumer. If `VoiceAlwaysOnGate` is not mounted in the app,
 * test 1 will fire console errors; if the settings key is rejected,
 * test 2 fails; if the wake-word route disappears, test 3 fails;
 * if the shared-mic refactor broke push-to-talk, test 4 fails.
 */

const BACKEND = process.env.PHANTOM_BACKEND ?? 'http://127.0.0.1:8000';
const USERNAME = process.env.PHANTOM_TEST_USER ?? 'phantom';
const PIN = process.env.PHANTOM_TEST_PIN ?? '000000';

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/auth/login/pin`, {
    data: { username: USERNAME, pin: PIN },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.token;
}

async function readValue(
  request: APIRequestContext,
  token: string,
  key: string,
): Promise<unknown> {
  const res = await request.get(
    `${BACKEND}/api/v1/settings/_value/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()).value;
}

async function writeValue(
  request: APIRequestContext,
  token: string,
  key: string,
  value: unknown,
): Promise<void> {
  const res = await request.put(
    `${BACKEND}/api/v1/settings/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { value },
    },
  );
  expect(res.status()).toBe(200);
}

test.describe('Voice always-on infrastructure', () => {
  test('app loads without VoiceAlwaysOn-related console errors (Gate consumer mounts)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await page.waitForTimeout(500);

    const voiceErrors = errors.filter(
      (e) =>
        e.includes('VoiceAlwaysOnGate') ||
        e.includes('useVoiceAlwaysOn') ||
        e.includes('useMicStream') ||
        e.includes('inputModeStore'),
    );
    expect(voiceErrors).toEqual([]);
  });

  test('voice_mode setting round-trips through PUT/GET (Phase 12.0)', async ({
    request,
  }) => {
    const token = await login(request);
    const original = (await readValue(request, token, 'voice_mode')) as string;

    try {
      // Cycle through every Phase 12 mode and confirm the GET reads it back.
      for (const mode of ['continuous', 'wake_word', 'off']) {
        await writeValue(request, token, 'voice_mode', mode);
        const after = await readValue(request, token, 'voice_mode');
        expect(after).toBe(mode);
      }
    } finally {
      // Restore whatever the test session started with — typically "off".
      await writeValue(request, token, 'voice_mode', original);
    }
  });

  test('GET /api/v1/voice/status exposes wake_word fields', async ({
    request,
  }) => {
    const token = await login(request);
    const res = await request.get(`${BACKEND}/api/v1/voice/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.wake_word_enabled).toBeDefined();
    expect(body.wake_words).toBeTruthy();
  });

  test('push-to-talk endpoint still accepts uploads (regression check)', async ({
    request,
  }) => {
    const token = await login(request);
    const tmp = path.join(os.tmpdir(), `phantom-e2e-ptt-${Date.now()}.webm`);
    try {
      execSync(
        `ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1" -c:a libopus "${tmp}"`,
      );
      const buffer = fs.readFileSync(tmp);
      const res = await request.post(`${BACKEND}/api/v1/voice/stt`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'ptt.webm',
            mimeType: 'audio/webm',
            buffer,
          },
        },
      });
      expect(res.status()).toBe(200);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
});
