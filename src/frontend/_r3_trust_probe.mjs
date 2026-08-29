// Раунд 3, борги довіри: hard-stop після «числа різні», чесний «шлях листа»,
// однобічна звірка в дзвінку. Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const PHASE = process.argv[4] || 'all';

const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const A = 'http://127.0.0.1:5173';
const log = {};

const contacts = async () => {
  const res = await fetch('http://127.0.0.1:8000/api/v1/messenger/contacts', {
    headers: { Authorization: `Bearer ${TOK_A}` },
  });
  return res.json();
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['camera', 'microphone'], { origin: A });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto(`${A}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
  localStorage.setItem('phantom_token', t);
  localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
}, TOK_A);
await page.goto(`${A}/messenger`, { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);

const [contact] = await contacts();
log.contact_before = { name: contact.display_name, verified: contact.verified };

const shot = async (name, locator) => {
  await (locator ?? page).screenshot({ path: `${OUT}/${name}.png` });
  log[`shot_${name}`] = `${OUT}/${name}.png`;
};

const openChat = async () => {
  const chat = page.locator(`text=${contact.display_name}`).first();
  if (await chat.count()) {
    await chat.click({ force: true });
    await page.waitForTimeout(2500);
  }
};

/* ── а, б: замок після «числа різні» і зняття його новим циклом ────────── */
if (PHASE === 'all' || PHASE === 'verify') {
  await openChat();

  const badge = page.locator('button:has-text("Не звірено")').first();
  if (await badge.count()) {
    await badge.click();
    await page.waitForTimeout(1200);
  }
  const sheet = page.locator('[aria-label="Картка співрозмовника"]').first();
  log.sheet_visible = await sheet.count();

  await page.locator('button:has-text("Порівняти QR-кодом")').first().click();
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Сканувати код співрозмовника")').first().click();
  await page.waitForTimeout(4000);

  // Чуже число тією самою дорогою, якою його вписує людина без камери.
  await page.locator('[data-safety-manual]').first().fill('9'.repeat(60));
  await page.locator('[data-safety-compare-btn]').scrollIntoViewIfNeeded();
  await page.locator('[data-safety-compare-btn]').click();
  await page.waitForTimeout(1500);

  log.mismatch_shown = await page.locator('[data-safety-compare="mismatch"]').count();
  log.confirm_disabled = await page.locator('[data-safety-confirm]').first().isDisabled();
  log.lock_note = (await page.locator('[data-safety-lock-note]').first().innerText()).replace(/\n/g, ' ');
  await shot('a_mismatch_locked_page');
  if (await sheet.count()) await shot('a_mismatch_locked', sheet);

  // Клік по заблокованій кнопці має бути порожнім — питаємо вузол, а не UI.
  await page.locator('[data-safety-confirm]').first().click({ force: true });
  await page.waitForTimeout(1500);
  const [afterClick] = await contacts();
  log.verified_after_forced_click = afterClick.verified;
  log.verified_badge_after_click = await page.locator('text=Звірено голосом').count();

  // Новий цикл: людина сама просить порівняти заново і цього разу вписує своє число.
  await page.locator('[data-safety-recompare]').first().click();
  await page.waitForTimeout(1200);
  log.recompare_scan_open = await page.locator('[data-safety-scan-open]').count();
  await page.locator('[data-safety-manual]').first().fill(contact.safety_number);
  await page.locator('[data-safety-compare-btn]').scrollIntoViewIfNeeded();
  await page.locator('[data-safety-compare-btn]').click();
  await page.waitForTimeout(2500);

  const [afterMatch] = await contacts();
  log.verified_after_match = afterMatch.verified;
  log.verified_badge_after_match = await page.locator('text=Звірено голосом').count();
  await shot('b_recompare_match_page');
  if (await sheet.count()) await shot('b_recompare_match', sheet);

  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 700, y: 60 } });
  await page.waitForTimeout(800);
}

/* ── а2: закрив/відкрив картку — свідомий новий цикл знімає замок ──────── */
if (PHASE === 'reopen') {
  await openChat();
  const badge = page.locator('button:has-text("Не звірено")').first();
  await badge.click();
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Порівняти QR-кодом")').first().click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Сканувати код співрозмовника")').first().click();
  await page.waitForTimeout(3500);
  await page.locator('[data-safety-manual]').first().fill('9'.repeat(60));
  await page.locator('[data-safety-compare-btn]').scrollIntoViewIfNeeded();
  await page.locator('[data-safety-compare-btn]').click();
  await page.waitForTimeout(1200);
  log.locked_before_reopen = await page.locator('[data-safety-confirm]').first().isDisabled();

  await page.locator('[aria-label="Закрити"]').first().click();
  await page.waitForTimeout(800);
  log.sheet_closed = (await page.locator('[aria-label="Картка співрозмовника"]').count()) === 0;

  await page.locator('button:has-text("Не звірено")').first().click();
  await page.waitForTimeout(1500);
  log.locked_after_reopen = await page.locator('[data-safety-confirm]').first().isDisabled();
  log.lock_note_after_reopen = await page.locator('[data-safety-lock-note]').count();
  const sheet2 = page.locator('[aria-label="Картка співрозмовника"]').first();
  if (await sheet2.count()) await shot('a2_reopened_clean', sheet2);
}

/* ── в: «шлях листа» з чесною межею довіри ────────────────────────────── */
if (PHASE === 'all' || PHASE === 'path') {
  await openChat();
  const marks = page.locator('button[title="Шлях листа"]');
  log.path_marks = await marks.count();
  if (log.path_marks) {
    await marks.last().click();
    await page.waitForTimeout(1000);
    const card = page.locator('[data-path-card]').first();
    log.path_card_text = (await card.innerText()).replace(/\n/g, ' ');
    const box = await card.boundingBox();
    if (box) {
      await page.screenshot({
        path: `${OUT}/v_path_card.png`,
        clip: {
          x: Math.max(0, box.x - 12),
          y: Math.max(0, box.y - 12),
          width: box.width + 24,
          height: box.height + 24,
        },
      });
      log.shot_v_path_card = `${OUT}/v_path_card.png`;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

/* ── г: стан звірки в дзвінку — чий саме ──────────────────────────────── */
if (PHASE === 'all' || PHASE === 'call') {
  await openChat();
  for (const [tag, verified] of [['g_call_not_verified', false], ['g_call_verified', true]]) {
    await page.evaluate(
      ([id, v]) => {
        window.dispatchEvent(
          new CustomEvent('phantom:start-call', {
            detail: { contactId: id, video: false, verified: v },
          }),
        );
      },
      [contact.id, verified],
    );
    await page.waitForTimeout(4000);
    const trust = page.locator('[data-call-trust]').first();
    log[`${tag}_flag`] = await trust.getAttribute('data-call-trust');
    log[`${tag}_text`] = await trust.innerText();
    log[`${tag}_title`] = await trust.getAttribute('title');
    const card = page.locator('[data-call-overlay] > div').first();
    if (await card.count()) await shot(tag, card);
    const hangup = page.locator('button[title="Завершити"]').first();
    if (await hangup.count()) await hangup.click();
    await page.waitForTimeout(2500);
  }
}

/* ── д: банер моделі довіри в налаштуваннях ───────────────────────────── */
if (PHASE === 'all' || PHASE === 'settings') {
  await page.locator('button[title="Налаштування застосунку"]').first().click();
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Мережа & P2P")').first().click();
  await page.waitForTimeout(1000);
  const banner = page.locator('text=Листи запечатані між вузлами').first();
  log.settings_banner = (await banner.count())
    ? (await banner.locator('xpath=ancestor::div[1]/..').innerText()).replace(/\n/g, ' ')
    : null;
  const box = await banner.locator('xpath=ancestor::div[2]').boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/d_settings_trust.png`,
      clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
    });
    log.shot_d_settings_trust = `${OUT}/d_settings_trust.png`;
  }
}

log.page_errors = errs;
console.log(JSON.stringify(log, null, 2));
await browser.close();
