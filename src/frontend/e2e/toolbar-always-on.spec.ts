import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 11c.2 — toolbar Always-On toggle button.
 *
 * The new primary-toolbar button mirrors `voice_always_on_enabled` and
 * lets the operator toggle the always-on listener without diving into
 * Settings. This test exercises the real button in a real browser by
 * doing a PIN login through the UI (auto-login is not wired so just
 * stuffing the JWT into localStorage is not enough — the auth store
 * stays empty until `setUser` is called by the login flow).
 *
 * Flow:
 *   1. Read the current backend value via API.
 *   2. PIN-login through the UI (default test PIN = 000000).
 *   3. Click the toolbar button (aria-label="Always-On").
 *   4. Poll the backend until the new value is observed.
 *   5. Click again, poll back to the original value.
 *   6. Defensive restore in `finally` so a failed assertion never
 *      leaks `voice_always_on_enabled = true` into the next session.
 */

const BACKEND = process.env.PHANTOM_BACKEND ?? 'http://127.0.0.1:8000';
const USERNAME = process.env.PHANTOM_TEST_USER ?? 'phantom';
const PIN = process.env.PHANTOM_TEST_PIN ?? '000000';
const KEY = 'voice_always_on_enabled';

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
): Promise<boolean> {
  const res = await request.get(
    `${BACKEND}/api/v1/settings/_value/${encodeURIComponent(KEY)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.status()).toBe(200);
  return Boolean((await res.json()).value);
}

async function writeValue(
  request: APIRequestContext,
  token: string,
  value: boolean,
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
  expected: boolean,
  timeoutMs = 5000,
): Promise<boolean> {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = Stub;
  });
}

test.describe('Toolbar Always-On toggle (phase 11c.2)', () => {
  test('clicking the Always-On button flips voice_always_on_enabled in the backend', async ({
    page,
    request,
  }) => {
    const token = await login(request);
    const original = await readValue(request, token);

    try {
      await stubVoiceWS(page);
      await pinLogin(page);

      const button = page.getByLabel('Always-On', { exact: true });
      await expect(button).toBeVisible({ timeout: 10_000 });
      // Initial state should mirror the backend.
      await expect(button).toHaveAttribute('aria-pressed', String(original));

      // Click → optimistic flip on the client + PUT.
      await button.click();
      const afterFirstClick = await pollValue(request, token, !original);
      expect(afterFirstClick).toBe(!original);
      await expect(button).toHaveAttribute('aria-pressed', String(!original));

      // Click again → flip back.
      await button.click();
      const afterSecondClick = await pollValue(request, token, original);
      expect(afterSecondClick).toBe(original);
      await expect(button).toHaveAttribute('aria-pressed', String(original));
    } finally {
      // Defensive restore — covers the case where an expect() above bailed
      // partway through and left the backend in the flipped state.
      const final = await readValue(request, token);
      if (final !== original) {
        await writeValue(request, token, original);
      }
    }
  });
});
