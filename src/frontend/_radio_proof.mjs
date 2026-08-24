// Живий дзвінок A↔B: драбина під вимір, потім убита доріжка і рація.
// Доказ — часовий ряд, не знімок. Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b2`, 'utf8').trim();

const A_ORIGIN = 'http://127.0.0.1:5173';
const B_ORIGIN = 'http://127.0.0.1:5174';
// Розмова A з вузлом Б (контакт e8535293) — саме там живе кнопка дзвінка.
const CHAT_ON_A = 'f575c904-943e-487f-a4d0-e310b6c1e9d0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { ladder: [], radio: [], errors: {} };

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
  await ctx.addInitScript((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  log.errors[tag] = errs;
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  return page;
};

const state = (page) => page.evaluate(() => window.__phantomCallState?.() ?? null);
const rtp = (page) => page.evaluate(() => window.__phantomCallRtp?.() ?? null);

const [pageA, pageB] = await Promise.all([
  open(A_ORIGIN, TOK_A, 'a'),
  open(B_ORIGIN, TOK_B, 'b'),
]);

/* ── дзвінок ────────────────────────────────────────────────────────────── */

await pageA.click(`#chat-item-${CHAT_ON_A}`);
await pageA.waitForTimeout(1200);
await pageA.click('[data-call-start="audio"]');

// Б бере слухавку, щойно вона задзвонила.
await pageB.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
await pageB.click('button[aria-label="Прийняти"]');

await pageA.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
await pageB.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
log.connected = { a: await state(pageA), b: await state(pageB) };

/* ── сходинки під вимір ─────────────────────────────────────────────────── */

// Бітрейт міряємо як РІЗНИЦЮ байтів за проміжок — це єдиний чесний спосіб.
const measure = async (label, seconds = 6) => {
  const a0 = await rtp(pageA);
  const b0 = await state(pageB);
  await sleep(seconds * 1000);
  const a1 = await rtp(pageA);
  const b1 = await state(pageB);

  const outKbps =
    a0 && a1 && a1.at > a0.at
      ? Math.round(((a1.bytesSent - a0.bytesSent) * 8) / (a1.at - a0.at))
      : null;
  const pps =
    a0 && a1 && a1.at > a0.at
      ? Math.round(((a1.packetsSent - a0.packetsSent) * 1000) / (a1.at - a0.at))
      : null;

  const row = {
    label,
    seconds,
    a_level: (await state(pageA))?.audioLevel ?? null,
    a_out_kbps: outKbps,
    a_packets_per_s: pps,
    a_maxBitrate: a1?.maxBitrate ?? null,
    a_targetBitrate: a1?.targetBitrate ?? null,
    b_in_kbps: b1?.stats?.kbps ?? null,
    b_rtt_ms: b1?.stats?.rttMs ?? null,
    b_level: b1?.audioLevel ?? null,
    at: new Date().toISOString(),
  };
  log.ladder.push(row);
  console.error(`  ${label}: out=${outKbps}kbps pps=${pps} in(B)=${row.b_in_kbps}kbps`);
  return row;
};

console.error('вимірюю драбину…');
await measure('повний (за замовчуванням)');

await pageA.evaluate(() => window.__phantomCallLadder('thrifty'));
await sleep(2500);
await measure('економний (форсовано)');

await pageA.evaluate(() => window.__phantomCallLadder('narrow'));
await sleep(2500);
await measure('вузький (форсовано)');

await pageA.screenshot({ path: `${OUT}/ladder_narrow_a.png` });
log.narrow_header = await pageA
  .locator('[data-call-level]')
  .first()
  .innerText()
  .catch(() => null);
log.narrow_stats = await pageA
  .locator('[data-call-stats]')
  .first()
  .innerText()
  .catch(() => null);

// Назад угору — драбина ходить в обидва боки, а не лише вниз.
await pageA.evaluate(() => window.__phantomCallLadder('full'));
await sleep(2500);
await measure('повний (повернення)');

/* ── рація ──────────────────────────────────────────────────────────────── */

console.error('вбиваю доріжку…');
log.kill = await pageA.evaluate(() => window.__phantomCallKillLink());
log.kill_at = new Date().toISOString();

// Часовий ряд рації: що з нею відбувається щосекунди на ОБОХ боках.
for (let i = 0; i < 45; i += 1) {
  await sleep(1000);
  const [sa, sb] = await Promise.all([state(pageA), state(pageB)]);
  // Доріжка сама себе лікує кожні 20 с — а нам треба довгий безперервний
  // ряд рації. Тож щоразу, як вона ожила, вбиваємо її знову: імітуємо мережу,
  // яка не тримає, а не одноразовий обрив.
  if (!sa?.radio && i > 2 && i < 40) {
    await pageA.evaluate(() => window.__phantomCallKillLink());
    log.rekills = (log.rekills ?? 0) + 1;
  }
  log.radio.push({
    t: i + 1,
    a: sa?.radio
      ? { sent: sa.radio.sent, delivered: sa.radio.delivered, played: sa.radio.played,
          lastSeq: sa.radio.lastSeq, missing: sa.radio.missing, speaking: sa.radio.speaking }
      : null,
    b: sb?.radio
      ? { sent: sb.radio.sent, delivered: sb.radio.delivered, played: sb.radio.played,
          lastSeq: sb.radio.lastSeq, missing: sb.radio.missing, speaking: sb.radio.speaking }
      : null,
    a_state: sa?.state ?? null,
    b_state: sb?.state ?? null,
  });
  if (i === 12) {
    await pageA.screenshot({ path: `${OUT}/radio_a.png` });
    await pageB.screenshot({ path: `${OUT}/radio_b.png` });
    log.banner_a = await pageA
      .locator('[data-call-radio="on"]')
      .first()
      .innerText()
      .catch(() => null);
    log.banner_b = await pageB
      .locator('[data-call-radio="on"]')
      .first()
      .innerText()
      .catch(() => null);
  }
}

log.audio_ctx = {
  a: await pageA.evaluate(() => window.__phantomCallState?.()?.radio ?? null),
  b: await pageB.evaluate(() => window.__phantomCallState?.()?.radio ?? null),
};
log.mode_attr = {
  a: await pageA.getAttribute('[data-call-overlay]', 'data-call-mode').catch(() => null),
  b: await pageB.getAttribute('[data-call-overlay]', 'data-call-mode').catch(() => null),
};

console.log(JSON.stringify(log, null, 2));
await browser.close();
