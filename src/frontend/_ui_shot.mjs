import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const TOKEN = readFileSync(process.argv[3], 'utf8').trim();
const SCENARIO = process.argv[4] || 'chat';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
  localStorage.setItem('phantom_token', t);
  localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
}, TOKEN);
await page.goto('http://127.0.0.1:5173/messenger', { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);

if (SCENARIO === 'chat' || SCENARIO === 'menu') {
  const chat = page.locator('text=Марта').first();
  if (await chat.count()) { await chat.click({ force: true }); await page.waitForTimeout(2000); }
}
if (SCENARIO === 'menu') {
  const dots = page.locator('[title="Більше дій"]').first();
  if (await dots.count()) { await dots.click(); await page.waitForTimeout(1200); }
}
if (SCENARIO === 'settings') {
  const gear = page.locator('[title="Налаштування застосунку"]').first();
  if (await gear.count()) { await gear.click(); await page.waitForTimeout(1000); }
  const tab = page.getByText('Мережа & P2P').first();
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(1200); }
}
await page.screenshot({ path: `${OUT}/${SCENARIO}.png` });
await browser.close();
console.log(`знято: ${OUT}/${SCENARIO}.png`);
