// Візуальний доказ: фото в стрічці A і B → «Видалити для всіх» РУКАМИ в UI →
// надгробок на A і на B. Вузол A на :5173, вузол B через проксі на :5174.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SP = '/tmp/claude-1000/-home-kyrylo-phantom-ai-PHANTOM-OS-BLUEPRINT-phantom-companion/9bec203a-b123-4bde-9247-7bb1b755354e/scratchpad';
const TITLE = process.argv[2];
const OUT = `${SP}/delete_shots`;

const TOK_A = readFileSync(`${SP}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SP}/tok_b`, 'utf8').trim();

const browser = await chromium.launch();

const openNode = async (origin, token) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  return page;
};

const openChat = async (page, name) => {
  const row = page.locator(`text=${name}`).first();
  if (await row.count()) {
    await row.click({ force: true });
    await page.waitForTimeout(2500);
  }
};

const report = {};

// ── Вузол A ──────────────────────────────────────────────────────────────────
const a = await openNode('http://127.0.0.1:5173', TOK_A);
await openChat(a, TITLE);
report.a_before_media = await a.locator('[data-testid="media-image"], [data-testid="media-file"], [data-testid="media-waiting"]').count();
report.a_before_tombstones = await a.locator('[data-testid="message-tombstone"]').count();
await a.screenshot({ path: `${OUT}/1_A_before.png` });

// ── Вузол B ──────────────────────────────────────────────────────────────────
const b = await openNode('http://127.0.0.1:5174', TOK_B);
await openChat(b, 'А');
report.b_before_media = await b.locator('[data-testid="media-image"], [data-testid="media-file"], [data-testid="media-waiting"]').count();
report.b_before_tombstones = await b.locator('[data-testid="message-tombstone"]').count();
await b.screenshot({ path: `${OUT}/2_B_before.png` });

// ── Видаляємо РУКАМИ в UI вузла A ────────────────────────────────────────────
const bubble = a.locator('[data-testid="media-image"], [data-testid="media-file"], [data-testid="media-waiting"]').first();
await bubble.click({ button: 'right', force: true });
await a.waitForTimeout(1200);
await a.screenshot({ path: `${OUT}/3_A_context_menu.png` });

await a.locator('text=Видалити повідомлення').first().click({ force: true });
await a.waitForTimeout(1200);
report.modal_has_for_everyone = await a.locator('text=Видалити для всіх учасників').count();
await a.screenshot({ path: `${OUT}/4_A_delete_modal.png` });

// «Видалити для всіх учасників» — обране за замовчуванням; тиснемо явно.
await a.locator('text=Видалити для всіх учасників').first().click({ force: true });
await a.waitForTimeout(400);

const requests = [];
a.on('request', (r) => {
  if (r.method() === 'DELETE') requests.push(`${r.method()} ${r.url()}`);
});

await a.locator('button:has-text("Видалити")').last().click({ force: true });
await a.waitForTimeout(3000);

report.delete_requests = requests;
report.a_after_media = await a.locator('[data-testid="media-image"], [data-testid="media-file"], [data-testid="media-waiting"]').count();
report.a_after_tombstones = await a.locator('[data-testid="message-tombstone"]').count();
report.a_tombstone_text = report.a_after_tombstones
  ? await a.locator('[data-testid="message-tombstone"]').first().innerText()
  : '(немає)';
await a.screenshot({ path: `${OUT}/5_A_tombstone.png` });

// ── Що тепер бачить B ────────────────────────────────────────────────────────
await b.reload({ waitUntil: 'networkidle' });
await b.waitForTimeout(6000);
await openChat(b, 'А');
report.b_after_media = await b.locator('[data-testid="media-image"], [data-testid="media-file"], [data-testid="media-waiting"]').count();
report.b_after_tombstones = await b.locator('[data-testid="message-tombstone"]').count();
report.b_tombstone_text = report.b_after_tombstones
  ? await b.locator('[data-testid="message-tombstone"]').first().innerText()
  : '(немає)';
await b.screenshot({ path: `${OUT}/6_B_tombstone.png` });

console.log(JSON.stringify(report, null, 2));
await browser.close();
