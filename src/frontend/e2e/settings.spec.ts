import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = process.env.PHANTOM_BACKEND ?? 'http://127.0.0.1:8000';
const USERNAME = process.env.PHANTOM_TEST_USER ?? 'phantom';
const PIN = process.env.PHANTOM_TEST_PIN ?? '000000';
const TEST_KEY = 'voice_tts_enabled';

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

test.describe('Settings reactivity', () => {
  test('PUT settings round-trips through GET', async ({ request }) => {
    const token = await login(request);

    const original = (await readValue(request, token, TEST_KEY)) as boolean;
    const flipped = !original;

    try {
      await writeValue(request, token, TEST_KEY, flipped);
      const after = await readValue(request, token, TEST_KEY);
      expect(after).toBe(flipped);
    } finally {
      // Always restore so we don't leave the system in an unintended state.
      await writeValue(request, token, TEST_KEY, original);
    }
  });
});
