// Чи справді довшає пакет. Головне питання фізики: на вузькому каналі виграш
// дає не бітрейт, а ptime. Міряємо пакети/с — це і є ptime навиворіт.
// Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b2`, 'utf8').trim();
const CHAT_ON_A = 'f575c904-943e-487f-a4d0-e310b6c1e9d0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { rows: [], sdp: {} };

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const open = async (origin, token) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.grantPermissions(['microphone'], { origin });
  await ctx.addInitScript((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  const page = await ctx.newPage();
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  return page;
};

const rtp = (p) => p.evaluate(() => window.__phantomCallRtp?.() ?? null);

const [pageA, pageB] = await Promise.all([
  open('http://127.0.0.1:5173', TOK_A),
  open('http://127.0.0.1:5174', TOK_B),
]);

await pageA.click(`#chat-item-${CHAT_ON_A}`);
await pageA.waitForTimeout(1200);
await pageA.click('[data-call-start="audio"]');
await pageB.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
await pageB.click('button[aria-label="Прийняти"]');
await pageA.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
await pageB.waitForSelector('[data-call-state="active"]', { timeout: 25000 });

const measure = async (label, seconds = 8) => {
  const a0 = await rtp(pageA);
  await sleep(seconds * 1000);
  const a1 = await rtp(pageA);
  if (!a0 || !a1 || a1.at <= a0.at) return null;
  const ms = a1.at - a0.at;
  const pps = ((a1.packetsSent - a0.packetsSent) * 1000) / ms;
  const kbps = ((a1.bytesSent - a0.bytesSent) * 8) / ms;
  // Обгортка: IP(20)+UDP(8)+RTP(12) = 40 байтів на кожен пакет, плюс SRTP.
  const overheadKbps = (pps * 40 * 8) / 1000;
  const row = {
    label,
    packets_per_s: Math.round(pps * 10) / 10,
    ptime_ms: Math.round(1000 / pps),
    payload_kbps: Math.round(kbps),
    header_overhead_kbps: Math.round(overheadKbps * 10) / 10,
    maxBitrate: a1.maxBitrate,
    at: new Date().toISOString(),
  };
  log.rows.push(row);
  console.error(
    `  ${label}: ${row.packets_per_s} пак/с (ptime≈${row.ptime_ms}мс) ` +
      `голос ${row.payload_kbps} кбіт/с + обгортка ${row.header_overhead_kbps} кбіт/с`,
  );
  return row;
};

console.error('обидві сторони на своїх сходинках…');
await measure('обидві: повний');

// Ключове: сходинку тиснемо на ОБОХ. Свій ptime кодек бере з того, що
// оголосила ІНША сторона, тож одностороння сходинка його не рухає.
console.error('обидві → економний');
await Promise.all([
  pageA.evaluate(() => window.__phantomCallLadder('thrifty')),
  pageB.evaluate(() => window.__phantomCallLadder('thrifty')),
]);
await sleep(4000);
await measure('обидві: економний');

console.error('обидві → вузький');
await Promise.all([
  pageA.evaluate(() => window.__phantomCallLadder('narrow')),
  pageB.evaluate(() => window.__phantomCallLadder('narrow')),
]);
await sleep(4000);
await measure('обидві: вузький');

log.sdp.remote_on_A = await pageA.evaluate(async () => {
  const rows = [];
  // Що САМЕ оголосила інша сторона — з цього кодек і бере свій ptime.
  const pcs = window.__phantomCallState?.();
  return pcs ? null : rows;
});
log.header_a = await pageA.locator('[data-call-level]').first().innerText().catch(() => null);
await pageA.screenshot({ path: `${OUT}/ptime_narrow_a.png` });

console.log(JSON.stringify(log, null, 2));
await browser.close();
