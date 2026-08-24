// Кнопка слухавки → справжній дзвінок, і його чути. Доказ — часовий ряд:
// стан оверлея, тайтл вкладки, лічильник осциляторів до/під час/після.
// Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b`, 'utf8').trim();
const A = 'http://127.0.0.1:5173';
const B = 'http://127.0.0.1:5174';

const CHAT_MARTA = 'dedfa7da-d960-4292-978e-41b41123e052';
const CHAT_DEMO = 'b96f6b96-f1c1-459e-a4a1-486a4471c181';

const browser = await chromium.launch({
  // Системні сповіщення headless-оболонка не вміє взагалі — беремо повний
  // хром, інакше «дозвіл надано» перевірити нічим.
  executablePath: '/usr/bin/chromium',
  headless: false,
  args: [
    '--window-size=1460,1000',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const log = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const openNode = async (origin, token, tag, perms) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(perms, { origin });
  await ctx.addInitScript(
    ({ t, wantNotifs }) => {
      localStorage.setItem('phantom_token', t);
      localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
      if (wantNotifs) localStorage.setItem('phantom_system_notifications', '1');
      // Ловимо кожен справжній системний банер, не заважаючи йому з'явитись.
      const Real = window.Notification;
      if (Real) {
        window.__notifs = [];
        const P = new Proxy(Real, {
          construct(target, args) {
            window.__notifs.push({ title: args[0], body: args[1]?.body ?? null });
            return new target(...args);
          },
        });
        Object.defineProperty(window, 'Notification', { value: P, configurable: true });
      }
    },
    { t: token, wantNotifs: tag === 'b' },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  log[`${tag}_errors`] = errs;
  return page;
};

const shot = async (page, name, sel) => {
  const target = sel ? page.locator(sel).first() : page;
  await target.screenshot({ path: `${OUT}/${name}.png` });
};

const audio = (page) => page.evaluate(() => window.__phantomCallAudio?.() ?? null);
const headerButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-call-start]')].map((b) => ({
      kind: b.getAttribute('data-call-start'),
      disabled: b.disabled,
      title: b.getAttribute('title'),
      wrapTitle: b.parentElement?.getAttribute('title') ?? null,
    })),
  );

const a = await openNode(A, TOK_A, 'a', ['camera', 'microphone']);
const b = await openNode(B, TOK_B, 'b', ['camera', 'microphone', 'notifications']);

/* ── 1. шапка живої розмови: дві робочі кнопки ── */
await a.click(`#chat-item-${CHAT_MARTA}`);
await a.waitForTimeout(1200);
log.header_live = await headerButtons(a);
await shot(a, 'a_header_live', 'header');
await a.locator('[data-call-start="audio"]').first().evaluate((el) => el.parentElement.setAttribute('data-shot-group', '1'));
await shot(a, 'a_header_live_zoom', '[data-shot-group]');

/* ── 2. шапка показової розмови: кнопки вимкнені й пояснюють чому ── */
await a.click(`#chat-item-${CHAT_DEMO}`);
await a.waitForTimeout(1200);
log.header_demo = await headerButtons(a);
await shot(a, 'c_header_demo', 'header');
await a.locator('[data-call-start="audio"]').first().evaluate((el) => el.parentElement.setAttribute('data-shot-group', '1'));
await shot(a, 'c_header_demo_zoom', '[data-shot-group]');
// Наведення, щоб підказка була не лише в DOM, а й на екрані.
await a.hover('[data-call-start="audio"]');
await a.waitForTimeout(1400);
await shot(a, 'c_header_demo_tooltip');

/* ── 3. натискаємо слухавку на А — і дивимось, що прилетіло на Б ── */
await a.click(`#chat-item-${CHAT_MARTA}`);
await a.waitForTimeout(1000);
log.audio_before = { a: await audio(a), b: await audio(b) };
log.title_b_before = await b.title();

await a.click('[data-call-start="audio"]');

await b.waitForSelector('[data-call-state="ringing"]', { timeout: 25000 });
await b.waitForTimeout(900);

log.ringing = {
  b_audio: await audio(b),
  b_title_1: await b.title(),
  b_notifs: await b.evaluate(() => window.__notifs ?? []),
  b_permission: await b.evaluate(() => Notification.permission),
  a_audio: await audio(a),
  a_state: await a.getAttribute('[data-call-overlay]', 'data-call-state'),
};
await shot(b, 'b_incoming_card');
await shot(b, 'b_incoming_card_zoom', '[data-call-overlay] > div');

// Блимання: та сама вкладка, різні тайтли з інтервалом менше секунди.
const titles = [];
for (let i = 0; i < 8; i += 1) {
  titles.push(await b.title());
  await sleep(450);
}
log.title_blink = [...new Set(titles)];

/* ── 4. беремо слухавку: рінгтон мусить стихнути саме тут ── */
await b.click('button[title="Прийняти"]');
await b.waitForSelector('[data-call-state="connecting"]', { timeout: 8000 });
await b.waitForTimeout(600);
log.after_accept = { b_audio: await audio(b), b_title: await b.title() };

await a.waitForSelector('[data-call-state="active"]', { timeout: 30000 });
await b.waitForSelector('[data-call-state="active"]', { timeout: 30000 });
log.both_active = true;
log.active_audio = { a: await audio(a), b: await audio(b) };
await shot(b, 'b_active');

/* ── 5. кладемо слухавку: тиша і після зникнення картки ── */
await a.click('button[title="Завершити"]');
await a.waitForTimeout(1200);
log.after_hangup = { a: await audio(a), b: await audio(b), b_title: await b.title() };
await a.waitForTimeout(3500);
log.after_card_gone = {
  a: await audio(a),
  b: await audio(b),
  overlay_a: await a.locator('[data-call-overlay]').count(),
  overlay_b: await b.locator('[data-call-overlay]').count(),
  b_title: await b.title(),
};

/* ── 6. відхилення: рінтон стихає і на цьому шляху ── */
await a.click('[data-call-start="video"]');
await b.waitForSelector('[data-call-state="ringing"]', { timeout: 25000 });
await b.waitForTimeout(700);
log.video_ringing = { b_audio: await audio(b), b_title: await b.title() };
await b.click('button[title="Відхилити"]');
await b.waitForTimeout(1000);
log.after_decline = { b_audio: await audio(b), a_audio: await audio(a) };
await a.waitForTimeout(3200);

/* ── 7. налаштування: справжній стан дозволу ── */
await b.click(`#chat-item-c2989f51-e4e1-4105-8778-1a676f08fbdf`).catch(() => {});
await b.waitForTimeout(600);
await b.evaluate(() => window.dispatchEvent(new Event('resize')));
const moreBtn = b.locator('button[title="Більше дій"]').first();
await moreBtn.click();
await b.waitForTimeout(400);
await b.locator('text=Налаштування месенджера').first().click();
await b.waitForTimeout(700);
await b.locator('text=Сповіщення & Звук').first().click();
await b.waitForTimeout(700);
log.settings = await b.evaluate(() => {
  const note = document.querySelector('[data-notif-state]');
  const toggle = document.querySelector('[data-notif-toggle]');
  return {
    access: note?.getAttribute('data-notif-state') ?? null,
    note: note?.textContent ?? null,
    toggle: toggle?.getAttribute('data-notif-toggle') ?? null,
    toggle_disabled: toggle?.disabled ?? null,
  };
});
await shot(b, 'd_settings_notifications');
await shot(b, 'd_settings_notifications_zoom', '[data-notif-toggle]  >> xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

console.log(JSON.stringify(log, null, 2));
await browser.close();
