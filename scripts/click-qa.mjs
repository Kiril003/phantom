#!/usr/bin/env node
// Клікає кожну кнопку нижнього дока й перевіряє, що розділ справді
// відкрився. Обхід за URL цього не ловить: маршрут може рендеритись, а
// кнопка до нього — ні.
//
//   node scripts/click-qa.mjs http://127.0.0.1:5201 [--out DIR]

import { chromium } from '../src/frontend/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:5201';
const i = process.argv.indexOf('--out');
const OUT = i > -1 ? process.argv[i + 1] : '/tmp/phantom-click';
const CHROME = '/home/kyrylo/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

mkdirSync(OUT, { recursive: true });
const pin = (() => {
  try {
    return readFileSync(resolve(HERE, '../.phantom-data/identity/bootstrap_pin'), 'utf8').trim();
  } catch { return null; }
})();

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const bag = [];
page.on('pageerror', (e) => bag.push(`JS  ${e.message.slice(0, 100)}`));
page.on('console', (m) => { if (m.type() === 'error') bag.push(`CON ${m.text().slice(0, 100)}`); });
page.on('response', (r) => { if (r.status() >= 400) bag.push(`NET ${r.status()} ${r.url().replace(BASE, '')}`); });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(6000);
if (pin && (await page.getByRole('button', { name: /Увійти/i }).count())) {
  const f = await page.locator('input').all();
  await f[0].fill('phantom'); await f[1].fill(pin);
  await page.getByRole('button', { name: /Увійти/i }).click();
  await page.waitForTimeout(5000);
}

const buttons = await page.evaluate(() => {
  const dock = [...document.querySelectorAll('button, [role="button"]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top > window.innerHeight - 140 && r.width > 20 && r.height > 20;
  });
  return dock.map((el, n) => ({
    n,
    label: (el.getAttribute('aria-label') || el.title || el.innerText || '').trim().slice(0, 24),
  }));
});

console.log(`кнопок у доку: ${buttons.length}\n`);
let broken = 0;

for (const b of buttons) {
  bag.length = 0;
  const before = page.url();
  const beforeText = (await page.evaluate(() => (document.body.innerText || '').length));
  try {
    const el = (await page.evaluate((n) => {
      const dock = [...document.querySelectorAll('button, [role="button"]')].filter((x) => {
        const r = x.getBoundingClientRect();
        return r.top > window.innerHeight - 140 && r.width > 20 && r.height > 20;
      });
      const t = dock[n];
      if (!t) return null;
      t.setAttribute('data-click-target', '1');
      return true;
    }, b.n));
    if (!el) { console.log(`${String(b.n).padStart(2)} ${b.label.padEnd(24)} зникла`); continue; }
    await page.locator('[data-click-target="1"]').click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.querySelector('[data-click-target]')?.removeAttribute('data-click-target'));
  } catch (e) {
    console.log(`${String(b.n).padStart(2)} ${b.label.padEnd(24)} НЕ КЛІКАЄТЬСЯ`);
    broken++;
    continue;
  }
  const after = page.url();
  const afterText = (await page.evaluate(() => (document.body.innerText || '').length));
  const moved = after !== before;
  const changed = Math.abs(afterText - beforeText) > 25;
  const flags = [];
  if (!moved && !changed) { flags.push('НІЧОГО НЕ СТАЛОСЬ'); broken++; }
  if (afterText < 40) { flags.push('ПОРОЖНЬО'); broken++; }
  if (bag.length) { flags.push(`ПОМИЛОК ${bag.length}`); broken += bag.length; }
  console.log(`${String(b.n).padStart(2)} ${b.label.padEnd(24)} ${after.replace(BASE, '') || '/'} ${flags.join(' · ') || 'ok'}`);
  bag.slice(0, 3).forEach((e) => console.log(`   ${e}`));
  await page.screenshot({ path: `${OUT}/dock-${b.n}.png` });
}

console.log(broken ? `\nПРОБЛЕМ: ${broken}` : '\nусі кнопки працюють');
await browser.close();
