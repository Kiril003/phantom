// Перевірка чесності приймання дзвінка: після «Прийняти» кнопка мусить зникнути
// одразу, картка — казати «зʼєднуємось…», а сторож stall — покривати новий стан
// 'connecting'. Доказ — часовий ряд станів, не один кадр.
// Тимчасовий інструмент, у коміт не йде.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const PHASE = process.argv[3] || 'accept';
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

const shot = async (page, name, locator) => {
  const target = locator ?? page;
  await target.screenshot({ path: `${OUT}/${name}.png` });
  log[`shot_${name}`] = `${OUT}/${name}.png`;
};

// Часовий ряд: кожна зміна оверлея — рядок {t, state, accept, end, connectingText}.
const armTrace = (page) =>
  page.evaluate(() => {
    window.__callTrace = [];
    const rec = () => {
      const overlay = document.querySelector('[data-call-overlay]');
      const entry = {
        t: Math.round(performance.now()),
        state: overlay?.getAttribute('data-call-state') ?? 'none',
        accept: !!document.querySelector('button[title="Прийняти"]'),
        end: !!document.querySelector('button[title="Завершити"]'),
        connectingText: (overlay?.textContent ?? '').includes('єднуємось'),
        incomingText: (overlay?.textContent ?? '').includes('вхідний'),
      };
      const last = window.__callTrace[window.__callTrace.length - 1];
      if (
        !last ||
        ['state', 'accept', 'end', 'connectingText', 'incomingText'].some(
          (k) => last[k] !== entry[k],
        )
      ) {
        window.__callTrace.push(entry);
      }
    };
    rec();
    new MutationObserver(rec).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });

const contactAtoB = async () => {
  const idB = await (
    await fetch('http://127.0.0.1:8001/api/v1/messenger/identity', {
      headers: { Authorization: `Bearer ${TOK_B}` },
    })
  ).json();
  const contacts = await (
    await fetch('http://127.0.0.1:8000/api/v1/messenger/contacts', {
      headers: { Authorization: `Bearer ${TOK_A}` },
    })
  ).json();
  const contact = contacts.find((c) => c.peer_node_id === idB.node_id);
  if (!contact) throw new Error('контакт A→B не знайдено');
  return contact;
};

const startCall = (page, contactId) =>
  page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', { detail: { contactId: id, video: false } }),
    );
  }, contactId);

/* ── приймання: кнопка зникає одразу, «зʼєднуємось…» чесне, потім active ── */
if (PHASE === 'accept') {
  const a = await openNode(A, TOK_A, 'a');
  const b = await openNode(B, TOK_B, 'b');

  // Реальна мережа, а не локальний стенд: кожен ICE-кандидат їде 1500 мс.
  // Саме в цьому вікні людина раніше бачила «вхідний дзвінок» після відповіді.
  for (const p of [a.page, b.page]) {
    await p.route('**/messenger/call/ice', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
  }

  await armTrace(b.page);
  const contact = await contactAtoB();
  log.contact = { name: contact.display_name, id: contact.id };
  await startCall(a.page, contact.id);

  await b.page.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
  await shot(b.page, 'accept_1_ringing', b.page.locator('[data-call-overlay] > div').first());

  await b.page.locator('button[title="Прийняти"]').click();
  await b.page.waitForSelector('[data-call-state="connecting"]', { timeout: 5000 });
  log.connecting = {
    accept_btn: await b.page.locator('button[title="Прийняти"]').count(),
    end_btn: await b.page.locator('button[title="Завершити"]').count(),
    subtitle_connecting: (await b.page.locator('[data-call-overlay]').innerText()).includes(
      'єднуємось',
    ),
  };
  // Друге натискання: кнопки вже немає — клік фізично неможливий.
  log.second_press = await b.page
    .locator('button[title="Прийняти"]')
    .click({ timeout: 400 })
    .then(() => 'ПРОЙШОВ — ПОГАНО')
    .catch(() => 'неможливий: кнопки немає');
  await shot(b.page, 'accept_2_connecting', b.page.locator('[data-call-overlay] > div').first());

  await a.page.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
  await b.page.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
  log.both_active = true;
  await shot(b.page, 'accept_3_active');

  log.trace_b = await b.page.evaluate(() => window.__callTrace);
  await b.page.locator('button[title="Завершити"]').first().click();
}

/* ── сторож: зʼєднання не встає ПІСЛЯ відповіді — stall у стані connecting ── */
if (PHASE === 'stall') {
  const a = await openNode(A, TOK_A, 'a');
  const b = await openNode(B, TOK_B, 'b');

  // Кандидати не доїжджають взагалі — суворий NAT без TURN.
  for (const p of [a.page, b.page]) {
    await p.route('**/messenger/call/ice', (route) => route.abort());
  }

  const contact = await contactAtoB();
  await startCall(a.page, contact.id);

  await b.page.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
  await b.page.locator('button[title="Прийняти"]').click();
  await b.page.waitForSelector('[data-call-state="connecting"]', { timeout: 5000 });

  // Сторож мусить спрацювати В НОВОМУ стані, не лише в ringing/calling.
  await b.page.waitForSelector('[data-call-stalled]', { timeout: 20000 });
  log.b_stall = {
    state: await b.page.locator('[data-call-overlay]').getAttribute('data-call-state'),
    kind: await b.page.locator('[data-call-stalled]').getAttribute('data-call-stalled'),
    text: (await b.page.locator('[data-call-stalled]').innerText()).replace(/\n/g, ' '),
  };
  await shot(b.page, 'stall_connecting_b', b.page.locator('[data-call-overlay] > div').first());

  // Той, хто набирав, отримує ту саму правду — це не мало зламатись.
  await a.page.waitForSelector('[data-call-stalled]', { timeout: 20000 });
  log.a_stall = {
    state: await a.page.locator('[data-call-overlay]').getAttribute('data-call-state'),
    kind: await a.page.locator('[data-call-stalled]').getAttribute('data-call-stalled'),
  };
  await b.page.locator('button[title="Завершити"]').first().click();
}

console.log(JSON.stringify(log, null, 2));
await browser.close();
