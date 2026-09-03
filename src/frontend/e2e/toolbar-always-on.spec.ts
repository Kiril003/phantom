import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 12.0 — toolbar Voice mode cycle button.
 *
 * The toolbar button (formerly "Always-On") cycles voice_mode through
 *   off → continuous → wake_word → off
 * Each click optimistically flips the local store and PUTs the new value
 * to the backend. This test exercises the real button in a real browser
 * by doing a PIN login through the UI (auto-login is not wired so just
 * stuffing the JWT into localStorage is not enough — the auth store
 * stays empty until `setUser` is called by the login flow).
 *
 * Flow:
 *   1. Read the current backend voice_mode via API.
 *   2. PIN-login through the UI (default test PIN = 000000).
 *   3. Click the toolbar button (aria-label="Voice mode").
 *   4. Poll the backend until the new mode is observed.
 *   5. Defensive restore in `finally` so a failed assertion never
 *      leaks the test's mode into the next session.
 */

const BACKEND = process.env.PHANTOM_BACKEND ?? 'http://127.0.0.1:8000';
const USERNAME = process.env.PHANTOM_TEST_USER ?? 'phantom';
const PIN = process.env.PHANTOM_TEST_PIN ?? '000000';
const KEY = 'voice_mode';

type VoiceMode = 'off' | 'continuous' | 'wake_word';

function nextMode(mode: VoiceMode): VoiceMode {
  return mode === 'off' ? 'continuous' : mode === 'continuous' ? 'wake_word' : 'off';
}

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/auth/login/pin`, {
    data: { username: USERNAME, pin: PIN },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).token;
}

async function readValue(
  request: APIRequestContext,
  token: string,
): Promise<VoiceMode> {
  const res = await request.get(
    `${BACKEND}/api/v1/settings/_value/${encodeURIComponent(KEY)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()).value as VoiceMode;
}

async function writeValue(
  request: APIRequestContext,
  token: string,
  value: VoiceMode,
): Promise<void> {
  const res = await request.put(
    `${BACKEND}/api/v1/settings/${encodeURIComponent(KEY)}`,
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

async function pollValue(
  request: APIRequestContext,
  token: string,
  expected: VoiceMode,
  timeoutMs = 5000,
): Promise<VoiceMode> {
  const deadline = Date.now() + timeoutMs;
  let last = await readValue(request, token);
  while (last !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = await readValue(request, token);
  }
  return last;
}

async function pinLogin(page: Page): Promise<void> {
  await page.goto('/');
  // The "operator id" textbox is pre-filled with "phantom" — leave it.
  // Click each PIN digit. Default test PIN is six zeros.
  for (const digit of PIN) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  // After the sixth digit the LoginScreen submits automatically and the
  // app navigates to the SHADOW home — toolbar then becomes visible.
  // We don't wait on networkidle here because the WS hub keeps the page
  // never-idle; just wait for the toolbar to appear.
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Phase 11c.3 — `VoiceAlwaysOnGate` is now mounted globally, so clicking
 * the Always-On button immediately tries to open `/ws/voice` and stream
 * audio frames. The backend always-on STT/wake-word pipeline blocks the
 * event loop while ingesting frames (a separate, pre-existing bug from
 * Phase 11c.1 — see docs/phase-11c.3/README.md "Known issues"). Until
 * that backend bug is fixed (Phase 11c.4), this e2e stubs the WS
 * constructor for `/ws/voice` URLs so the click only exercises the
 * frontend toggle path — which is what this test cares about anyway.
 * The voice-always-on.spec.ts uses pure API/HTTP and is unaffected.
 */
async function stubVoiceWS(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = window.WebSocket;
     
    const Stub: any = function (url: string) {
      if (typeof url === 'string' && url.includes('/ws/voice')) {
        return {
          binaryType: 'arraybuffer',
          readyState: 0,
          url,
          send: () => {},
          close: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
        };
      }
      return new Original(url);
    };
    Stub.OPEN = Original.OPEN;
    Stub.CLOSED = Original.CLOSED;
    Stub.CONNECTING = Original.CONNECTING;
    Stub.CLOSING = Original.CLOSING;
     
    (window as any).WebSocket = Stub;
  });
}

test.describe('Toolbar Voice mode cycle (Phase 12.0)', () => {
  test('clicking the Voice mode button cycles voice_mode in the backend', async ({
    page,
    request,
  }) => {
    const token = await login(request);
    // Force a known starting state so the cycle assertions are deterministic.
    await writeValue(request, token, 'off');
    const original = await readValue(request, token);
    expect(original).toBe('off');

    try {
      await stubVoiceWS(page);
      await pinLogin(page);

      const button = page.getByLabel('Voice mode', { exact: true });
      await expect(button).toBeVisible({ timeout: 10_000 });
      // off → not active in the toolbar.
      await expect(button).toHaveAttribute('aria-pressed', 'false');

      // Click 1 → continuous (active).
      await button.click();
      const afterFirstClick = await pollValue(request, token, 'continuous');
      expect(afterFirstClick).toBe('continuous');
      await expect(button).toHaveAttribute('aria-pressed', 'true');

      // Click 2 → wake_word (still active — both non-off modes are active).
      await button.click();
      const afterSecondClick = await pollValue(request, token, 'wake_word');
      expect(afterSecondClick).toBe('wake_word');
      await expect(button).toHaveAttribute('aria-pressed', 'true');

      // Click 3 → back to off.
      await button.click();
      const afterThirdClick = await pollValue(request, token, 'off');
      expect(afterThirdClick).toBe('off');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    } finally {
      // Defensive restore — leave the backend at "off" regardless of how
      // the test exited so the next session starts from a known state.
      const final = await readValue(request, token);
      if (final !== 'off') {
        await writeValue(request, token, 'off');
      }
      // Suppress the unused-helper lint — nextMode is a documentation
      // helper for readers.
      void nextMode;
    }
  });
});
