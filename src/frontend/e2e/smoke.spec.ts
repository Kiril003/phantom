import { test, expect } from '@playwright/test';

const BACKEND = process.env.PHANTOM_BACKEND ?? 'http://127.0.0.1:8000';

test.describe('Smoke', () => {
  test('app loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');

    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const realErrors = errors.filter(
      (e) =>
        !e.includes('DevTools') &&
        !e.includes('favicon') &&
        !e.toLowerCase().includes('websocket') &&
        !e.includes('Failed to load resource'),
    );
    expect(realErrors).toEqual([]);
  });

  test('backend health is reachable', async ({ request }) => {
    const res = await request.get(`${BACKEND}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.ai_active).toBeTruthy();
  });
});
