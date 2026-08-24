// Крупний план групи кнопок дзвінка: жива розмова проти показової.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const OUT = process.argv[2], SCRATCH = process.argv[3];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const MARTA = 'dedfa7da-d960-4292-978e-41b41123e052';
const DEMO = 'b96f6b96-f1c1-459e-a4a1-486a4471c181';

const br = await chromium.launch({ args: ['--force-device-scale-factor=3'] });
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
await ctx.addInitScript((t) => {
  localStorage.setItem('phantom_token', t);
  localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
}, TOK_A);
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5173/messenger', { waitUntil: 'networkidle' });
await p.waitForTimeout(7000);

const crop = async (chatId, name) => {
  await p.click(`#chat-item-${chatId}`);
  await p.waitForTimeout(1200);
  const box = await p.locator('[data-call-start="audio"]').first().evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect();
    return { x: r.x - 60, y: r.y - 14, width: r.width + 120, height: r.height + 28 };
  });
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: box });
  return p.evaluate(() =>
    [...document.querySelectorAll('[data-call-start]')].map((b) => ({
      kind: b.getAttribute('data-call-start'),
      disabled: b.disabled,
      colour: getComputedStyle(b).color,
      title: b.title,
    })),
  );
};

console.log(JSON.stringify({
  live: await crop(MARTA, 'a_buttons_live_3x'),
  demo: await crop(DEMO, 'c_buttons_demo_3x'),
}, null, 2));
await br.close();
