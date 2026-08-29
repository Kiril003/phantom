// Живий дзвінок A↔B через TURN: доказ, що медіа ЇДЕ крізь ретранслятор.
// Часовий ряд, не знімок: пара кандидатів, адреси й байти щоп'ять секунд.
// Аргументи: <out-dir> <scratch> <relay|direct>. Тимчасовий інструмент.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const MODE = process.argv[4] ?? 'relay';
const FORCE_RELAY = MODE === 'relay';

const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b2`, 'utf8').trim();

const A_ORIGIN = 'http://127.0.0.1:5173';
const B_ORIGIN = 'http://127.0.0.1:5174';
const CHAT_ON_A = 'f575c904-943e-487f-a4d0-e310b6c1e9d0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { mode: MODE, forceRelay: FORCE_RELAY, series: [], errors: {} };

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const open = async (origin, token, tag) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.grantPermissions(['microphone', 'camera'], { origin });
  await ctx.addInitScript(
    ({ t, force }) => {
      localStorage.setItem('phantom_token', t);
      localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
      if (force) window.__phantomForceRelay = true;
    },
    { t: token, force: FORCE_RELAY },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  log.errors[tag] = errs;
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  return page;
};

const path = (page) => page.evaluate(() => window.__phantomCallPath?.() ?? null);
const state = (page) => page.evaluate(() => window.__phantomCallState?.() ?? null);

const [pageA, pageB] = await Promise.all([
  open(A_ORIGIN, TOK_A, 'a'),
  open(B_ORIGIN, TOK_B, 'b'),
]);

// Що вузол каже про дороги — до всякого дзвінка.
log.ice = {
  a: await pageA.evaluate(() => window.__phantomIce?.() ?? null),
  b: await pageB.evaluate(() => window.__phantomIce?.() ?? null),
};
console.error('ice A:', JSON.stringify(log.ice.a));

/* ── дзвінок ────────────────────────────────────────────────────────────── */

await pageA.click(`#chat-item-${CHAT_ON_A}`);
await pageA.waitForTimeout(1200);
const dialedAt = Date.now();
await pageA.click('[data-call-start="audio"]');

await pageB.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
await pageB.click('button[aria-label="Прийняти"]');

await pageA.waitForSelector('[data-call-state="active"]', { timeout: 30000 });
await pageB.waitForSelector('[data-call-state="active"]', { timeout: 30000 });
log.connected_after_ms = Date.now() - dialedAt;
console.error(`зʼєднались за ${log.connected_after_ms} мс`);

/* ── часовий ряд: 7 вимірів по 5 секунд ─────────────────────────────────── */

const shot = (row) =>
  `t=${String(row.t).padStart(2)}s  A ${row.a?.local?.type ?? '?'}↔${row.a?.remote?.type ?? '?'}` +
  ` @${row.a?.local?.address ?? '?'}  sent=${row.a?.bytesSent ?? '?'} recv=${row.a?.bytesReceived ?? '?'}` +
  `  |  B sent=${row.b?.bytesSent ?? '?'} recv=${row.b?.bytesReceived ?? '?'}  |  UI(A): ${row.ui_a ?? '—'}`;

for (let i = 0; i < 7; i += 1) {
  await sleep(5000);
  const [pa, pb, sa, sb] = await Promise.all([path(pageA), path(pageB), state(pageA), state(pageB)]);
  const row = {
    t: (i + 1) * 5,
    at: new Date().toISOString(),
    a: pa,
    b: pb,
    a_stats: sa?.stats ?? null,
    b_stats: sb?.stats ?? null,
    a_state: sa?.state ?? null,
    b_state: sb?.state ?? null,
    ui_a: await pageA.locator('[data-call-stats]').first().innerText().catch(() => null),
    ui_b: await pageB.locator('[data-call-stats]').first().innerText().catch(() => null),
  };
  log.series.push(row);
  console.error(shot(row));

  if (i === 3) {
    await pageA.screenshot({ path: `${OUT}/${MODE}_a.png` });
    await pageB.screenshot({ path: `${OUT}/${MODE}_b.png` });
  }
}

/* ── чи справді росли байти ─────────────────────────────────────────────── */

const first = log.series[0];
const last = log.series[log.series.length - 1];
log.verdict = {
  seconds: last.t - first.t,
  a_sent_delta: (last.a?.bytesSent ?? 0) - (first.a?.bytesSent ?? 0),
  a_recv_delta: (last.a?.bytesReceived ?? 0) - (first.a?.bytesReceived ?? 0),
  b_sent_delta: (last.b?.bytesSent ?? 0) - (first.b?.bytesSent ?? 0),
  b_recv_delta: (last.b?.bytesReceived ?? 0) - (first.b?.bytesReceived ?? 0),
  a_pair: [last.a?.local?.type ?? null, last.a?.remote?.type ?? null],
  b_pair: [last.b?.local?.type ?? null, last.b?.remote?.type ?? null],
  a_addresses: [last.a?.local?.address ?? null, last.a?.remote?.address ?? null],
  b_addresses: [last.b?.local?.address ?? null, last.b?.remote?.address ?? null],
};

await pageA.click('button[aria-label="Завершити"]').catch(() => {});
console.log(JSON.stringify(log, null, 2));
await browser.close();
