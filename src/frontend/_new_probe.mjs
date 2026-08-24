import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const TOKEN = readFileSync(process.argv[3], 'utf8').trim();
const PEER_KEY = readFileSync(process.argv[4], 'utf8').trim();
const SCENARIO = process.argv[5] || 'new';

let clicks = 0;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const click = async (loc, label) => {
  await loc.click({ force: true });
  clicks += 1;
  console.log(`клік ${clicks}: ${label}`);
};

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
  localStorage.setItem('phantom_token', t);
  localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
}, TOKEN);
await page.goto('http://127.0.0.1:5173/messenger', { waitUntil: 'networkidle' });
await page.waitForTimeout(7000);

if (SCENARIO === 'new' || SCENARIO === 'e2e') {
  await click(page.locator('[title="Новий діалог"]:visible').first(), 'Новий');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/new_card.png` });
  console.log(`знято: ${OUT}/new_card.png`);
}

if (SCENARIO === 'e2e') {
  await page.getByTestId('peer-name').fill(`Вузол B ${Date.now().toString().slice(-4)}`);
  await page.getByTestId('peer-address').fill('127.0.0.1:8001');
  await page.getByTestId('peer-key').fill(PEER_KEY);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/new_filled.png` });
  await click(page.getByTestId('open-conversation'), 'Відкрити розмову');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/e2e_open.png` });
  console.log(`знято: ${OUT}/e2e_open.png`);
  const composer = await page.locator('textarea').count();
  console.log(`композер на екрані: ${composer > 0}`);
  console.log(`ВСЬОГО КЛІКІВ від «Новий» до розмови: ${clicks}`);

  // Головне звинувачення панелі: «створене зникає від F5». Перевіряємо.
  const before = await page.locator('[title="Новий діалог"]:visible').count();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  const survived = await page.getByText('Марта', { exact: false }).count();
  console.log(`після F5: сайдбар живий=${before > 0}, розмов «Марта» у списку=${survived}`);
  await page.screenshot({ path: `${OUT}/e2e_after_f5.png` });
  console.log(`знято: ${OUT}/e2e_after_f5.png`);
}

if (SCENARIO === 'forward') {
  // Відкриваємо ПОКАЗОВУ розмову — тоді в цілях пересилання лишиться справжня
  // «Марта», і видно, що вона стоїть вище демо, а не навпаки.
  const chat = page.locator('text=Рідний Дім').first();
  if (await chat.count()) { await chat.click({ force: true }); await page.waitForTimeout(2500); }
  const bubble = page.locator('.group\\/msg, [class*="rounded"]').filter({ hasText: /./ });
  // Контекстне меню повідомлення — правою кнопкою по бульбашці.
  const msgs = page.locator('p, span').filter({ hasText: /\S{6,}/ });
  const target = page.locator('[data-msg-id]').last();
  if (await target.count()) {
    await target.click({ button: 'right', force: true });
  } else {
    await msgs.last().click({ button: 'right', force: true });
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/forward_menu.png` });
  const fwd = page.getByText('Переслати', { exact: true }).first();
  if (await fwd.count()) { await fwd.click({ force: true }); await page.waitForTimeout(1500); }
  await page.screenshot({ path: `${OUT}/forward_modal.png` });
  console.log(`знято: ${OUT}/forward_modal.png`);
}

await browser.close();
