// Перевірка боргів довіри: QR-звірка, стан «числа різні», рядок звірки в
// дзвінку, тип ICE-кандидата в телеметрії, чесний стан без TURN.
// Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const PHASE = process.argv[3] || 'verify';
const SCRATCH = process.argv[4];

const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b`, 'utf8').trim();
const A = 'http://127.0.0.1:5173';
const B = 'http://127.0.0.1:5174';

const MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

const browser = await chromium.launch({ args: MEDIA_ARGS });
const log = {};

const openNode = async (origin, token, tag) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);
  log[`${tag}_errors`] = errs;
  return { ctx, page, errs };
};

const contactsOf = async (port, token) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/messenger/contacts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

const shot = async (page, name, locator) => {
  const target = locator ?? page;
  await target.screenshot({ path: `${OUT}/${name}.png` });
  log[`shot_${name}`] = `${OUT}/${name}.png`;
};

/* ── а, б: картка звірки — QR і «числа різні» ─────────────────────────── */
if (PHASE === 'verify') {
  const { page } = await openNode(A, TOK_A, 'a');

  const chat = page.locator('text=Марта').first();
  if (await chat.count()) {
    await chat.click({ force: true });
    await page.waitForTimeout(2500);
  }
  log.chat_opened = await chat.count();

  // Картка співрозмовника: з шапки — кнопкою стану звірки.
  let opened = false;
  const badge = page.locator('button:has-text("Не звірено")').first();
  if (await badge.count()) {
    await badge.click();
    await page.waitForTimeout(1200);
    opened = (await page.locator('[aria-label="Картка співрозмовника"]').count()) > 0;
  }
  if (!opened) {
    const dots = page.locator('[title="Більше дій"]').first();
    if (await dots.count()) {
      await dots.click();
      await page.waitForTimeout(800);
      const item = page.locator('text=Звірити число безпеки').first();
      if (await item.count()) {
        await item.click();
        await page.waitForTimeout(1200);
      }
    }
  }
  const sheet = page.locator('[aria-label="Картка співрозмовника"]').first();
  log.sheet_visible = await sheet.count();

  await page.locator('button:has-text("Порівняти QR-кодом")').first().click();
  await page.waitForTimeout(1500);
  log.qr_img = await page.locator('img[alt="QR власного числа безпеки"]').count();
  await shot(page, 'a_verify_qr_page');
  if (await sheet.count()) await shot(page, 'a_verify_qr', sheet);

  // Скан «не того» числа: камера у стенді фейкова, тож число вписуємо руками —
  // тією самою дорогою, якою його вводить людина без камери.
  await page.locator('button:has-text("Сканувати код співрозмовника")').first().click();
  // Чекаємо, поки відео камери займе свою висоту: інакше клік летить у місце,
  // яке після появи кадру належить уже іншій кнопці.
  await page.waitForTimeout(4000);
  log.scan_open = await page.locator('[data-safety-scan-open]').count();
  const wrong = '9'.repeat(60);
  await page.locator('[data-safety-manual]').first().fill(wrong);
  await page.waitForTimeout(600);
  await page.locator('[data-safety-compare-btn]').scrollIntoViewIfNeeded();
  await page.locator('[data-safety-compare-btn]').click();
  await page.waitForTimeout(1500);
  log.mismatch_shown = await page.locator('[data-safety-compare="mismatch"]').count();
  log.mismatch_text = log.mismatch_shown
    ? (await page.locator('[data-safety-compare="mismatch"]').first().innerText()).replace(/\n/g, ' ')
    : null;

  await page.locator('[data-safety-help]').first().click();
  await page.waitForTimeout(600);
  await shot(page, 'b_mismatch_page');
  if (await sheet.count()) await shot(page, 'b_mismatch', sheet);

  log.verified_after_mismatch = await page.locator('text=Звірено голосом').count();
}

/* ── в, г: дзвінок між вузлами — рядок звірки і тип кандидата ─────────── */
if (PHASE === 'call') {
  const a = await openNode(A, TOK_A, 'a');
  const b = await openNode(B, TOK_B, 'b');

  const chat = a.page.locator('text=Марта').first();
  if (await chat.count()) {
    await chat.click({ force: true });
    await a.page.waitForTimeout(2500);
  }

  const [contact] = await contactsOf(8000, TOK_A);
  log.contact = { name: contact.display_name, verified: contact.verified };

  await a.page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', { detail: { contactId: id, video: false } }),
    );
  }, contact.id);

  await b.page.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
  log.b_ringing = true;
  await shot(b.page, 'v_ringing_b');

  await b.page.locator('button[title="Прийняти"]').click();
  await a.page.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
  await b.page.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
  log.both_active = true;

  // Даємо getStats кілька періодів: телеметрія малюється лише з виміряного.
  await a.page.waitForTimeout(7000);

  const statsA = await a.page.locator('[data-call-stats]').first().innerText();
  const trustA = await a.page.locator('[data-call-trust]').first().getAttribute('data-call-trust');
  const trustText = await a.page.locator('[data-call-trust]').first().innerText();
  log.stats_a = statsA;
  log.trust_a = { flag: trustA, text: trustText };

  await shot(a.page, 'v_call_active_a');
  const header = a.page.locator('[data-call-overlay] .border-b').first();
  if (await header.count()) await shot(a.page, 'g_telemetry', header);
  await shot(b.page, 'v_call_active_b');
}

/* ── д: без TURN — чесний стан замість вічного «набираю…» ─────────────── */
if (PHASE === 'stall') {
  const a = await openNode(A, TOK_A, 'a');
  const chat = a.page.locator('text=Марта').first();
  if (await chat.count()) {
    await chat.click({ force: true });
    await a.page.waitForTimeout(2500);
  }
  const [contact] = await contactsOf(8000, TOK_A);

  // Нікого немає на тому боці: вузол Б без відкритого браузера сигнал прийме,
  // але доріжка не встане — саме той випадок, про який мовчали.
  await a.page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', { detail: { contactId: id, video: false } }),
    );
  }, contact.id);

  await a.page.waitForTimeout(4000);
  await shot(a.page, 'd_calling_before');
  await a.page.waitForSelector('[data-call-stalled]', { timeout: 20000 });
  log.stall_kind = await a.page.locator('[data-call-stalled]').getAttribute('data-call-stalled');
  log.stalled_text = (await a.page.locator('[data-call-stalled]').innerText()).replace(/\n/g, ' ');
  const card = a.page.locator('[data-call-overlay] > div').first();
  if (await card.count()) await shot(a.page, 'd_no_answer', card);
}

/* ── д2: відповідь є, а дороги немає — саме той випадок, де винен TURN ── */
if (PHASE === 'nopath') {
  const a = await openNode(A, TOK_A, 'a');
  const b = await openNode(B, TOK_B, 'b');

  // Кандидати не доїжджають у жодному напрямку: пари не складуться, і це
  // рівно та ситуація, яку в реальності створює суворий NAT без TURN.
  for (const p of [a.page, b.page]) {
    await p.route('**/messenger/call/ice', (route) => route.abort());
  }

  const chat = a.page.locator('text=Марта').first();
  if (await chat.count()) {
    await chat.click({ force: true });
    await a.page.waitForTimeout(2500);
  }
  const [contact] = await contactsOf(8000, TOK_A);
  await a.page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', { detail: { contactId: id, video: false } }),
    );
  }, contact.id);

  await b.page.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
  await b.page.locator('button[title="Прийняти"]').click();
  log.b_accepted = true;

  await a.page.waitForSelector('[data-call-stalled="no-path"]', { timeout: 25000 });
  log.stall_kind = await a.page.locator('[data-call-stalled]').getAttribute('data-call-stalled');
  log.stalled_text = (await a.page.locator('[data-call-stalled]').innerText()).replace(/\n/g, ' ');
  log.a_state = await a.page.locator('[data-call-overlay]').getAttribute('data-call-state');

  const card = a.page.locator('[data-call-overlay] > div').first();
  if (await card.count()) await shot(a.page, 'd_no_path_turn', card);
  await shot(a.page, 'd_no_path_page');
}

/* ── контроль: як виглядає зелений бік того самого рядка ──────────────── */
if (PHASE === 'trustok') {
  // Дзвінок справжній, синтетичний тут лише прапорець звірки в detail — саме
  // тим полем його передає застосунок із chat.contactVerified.
  const a = await openNode(A, TOK_A, 'a');
  const [contact] = await contactsOf(8000, TOK_A);
  await a.page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', {
        detail: { contactId: id, video: false, verified: true },
      }),
    );
  }, contact.id);
  await a.page.waitForTimeout(4000);
  log.trust_flag = await a.page.locator('[data-call-trust]').first().getAttribute('data-call-trust');
  log.trust_text = await a.page.locator('[data-call-trust]').first().innerText();
  const card = a.page.locator('[data-call-overlay] > div').first();
  if (await card.count()) await shot(a.page, 'v_trust_verified_synthetic', card);
}

console.log(JSON.stringify(log, null, 2));
await browser.close();
