// Двері месенджера: доказ, що людину впускають одним жестом.
// Тимчасовий інструмент, у коміт не йде.
//
//   node _door_proof.mjs <OUT_DIR> <SCRATCH_DIR> <phase>
//
// phases: invite | stranger | accept | all
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import jsQR from 'jsqr';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const PHASE = process.argv[4] || 'all';

const TOK_A = readFileSync(`${SCRATCH}/door_tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/door_tok_b`, 'utf8').trim();
const A_UI = 'http://127.0.0.1:5173';
const B_UI = 'http://127.0.0.1:5174';
const A_API = 'http://127.0.0.1:8000';
const B_API = 'http://127.0.0.1:8002';

const NEW_CHAT =
  'button:visible:has-text("Новий"), button:visible[aria-label="Створити новий діалог"]';

const log = {};
const clicks = [];

// ── той самий формат конверта, але незалежна реалізація: якщо застосунок
// прочитає цей рядок, значить формат живе не лише всередині одного файла ──
const enc = (parts) => {
  const bundle = Buffer.from(parts.compact, 'base64url');
  const addr = Buffer.from(parts.address, 'utf8');
  const who = Buffer.from(parts.name, 'utf8');
  const out = Buffer.alloc(6 + bundle.length + 1 + addr.length + 1 + who.length);
  out.write('PHI', 0, 'ascii');
  out[3] = 1;
  out.writeUInt16BE(bundle.length, 4);
  let p = 6;
  bundle.copy(out, p); p += bundle.length;
  out[p++] = addr.length; addr.copy(out, p); p += addr.length;
  out[p++] = who.length; who.copy(out, p);
  return 'phantom://invite/' + out.toString('base64url');
};

const api = async (base, token, path, init = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* лишаємо текстом */ }
  return { status: res.status, body };
};

const browser = await chromium.launch();

const openNode = async (origin, token, tag) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  await page.goto(`${origin}/messenger`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  // На телефонній ширині застосунок відкривається одразу в останній розмові;
  // людина в цей момент тиснула б «Назад». Це поза лічбою — двері рахуємо
  // від списку бесід, там, де людина й тисне «Новий».
  if (!(await page.locator(NEW_CHAT).first().isVisible().catch(() => false))) {
    await page.click('button[aria-label="Назад"]');
    await page.waitForTimeout(800);
  }
  await page.waitForSelector(NEW_CHAT, { timeout: 45000 });
  await page.waitForTimeout(1200);
  log[`${tag}_errors`] = errs;
  return { ctx, page, errs };
};

const shot = async (page, name, locator) => {
  await (locator ?? page).screenshot({ path: `${OUT}/${name}.png` });
};

// Кожен клік — рядок у лічбі: що натиснули і на якій мілісекунді від «Новий».
const click = async (page, selector, label, t0) => {
  await page.click(selector);
  clicks.push({ n: clicks.length + 1, label, ms: t0 ? Date.now() - t0 : 0 });
};

// ── 1. Запрошення на вузлі A ────────────────────────────────────────────────
if (PHASE === 'invite' || PHASE === 'all') {
  const { page } = await openNode(A_UI, TOK_A, 'a_invite');
  clicks.length = 0;
  const t0 = Date.now();
  await click(page, NEW_CHAT, 'Новий', t0);
  await page.waitForSelector('[data-testid="make-invite"]');
  await click(page, '[data-testid="make-invite"]', 'Запросити людину', t0);
  await page.waitForSelector('[data-testid="invite-string"]');

  // Адресу вузла підставляє браузер — тут це проксі 5173; вписуємо ту, за якою
  // вузол A справді слухає, бо саме її понесе співрозмовник.
  await page.fill('[data-testid="invite-name"]', 'Марта');
  await page.fill('[data-testid="invite-address"]', A_API);
  await page.waitForTimeout(500);

  await shot(page, 'a_invite_card', page.locator('[data-testid="invite-card"]'));
  await shot(page, 'a_invite_full');
  log.invite_box = await page
    .locator('[data-testid="invite-card"]')
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const modal = el.closest('.fixed');
      return { card: [r.width, r.height], inModal: !!modal, cards: document.querySelectorAll('[data-testid="invite-card"]').length };
    });

  await click(page, '[data-testid="invite-qr"]', 'QR', t0);
  await page.waitForSelector('[data-testid="invite-qr-view"] img', { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, 'b_invite_qr', page.locator('[data-testid="invite-card"]'));

  // Код мусить читатись, а не просто бути намальованим: беремо з нього пікселі
  // й проганяємо тим самим jsQR, яким його читає сканер застосунку.
  const pix = await page.evaluate(async () => {
    const img = document.querySelector('[data-testid="invite-qr-view"] img');
    const bmp = await createImageBitmap(img);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    return { data: Array.from(d.data), width: cv.width, height: cv.height };
  });
  const decoded = jsQR(new Uint8ClampedArray(pix.data), pix.width, pix.height);

  const invite = await page.inputValue('[data-testid="invite-string"]');
  log.qr = {
    px: [pix.width, pix.height],
    decoded_ok: decoded?.data === invite,
    decoded_len: decoded?.data?.length ?? 0,
  };
  await click(page, '[data-testid="invite-copy"]', 'Копіювати', t0);
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());

  log.invite = {
    string: invite,
    length: invite.length,
    clipboard_matches: clip === invite,
    scheme_ok: invite.startsWith('phantom://invite/'),
    clicks_to_copied: clicks.map((c) => c.label),
    ms_to_copied: clicks[clicks.length - 1].ms,
  };
  writeFileSync(`${SCRATCH}/door_invite.txt`, invite);
  await page.context().close();
}

// ── 2. Незнайомець: ключ вузла, якого A ніколи не бачив ─────────────────────
if (PHASE === 'stranger' || PHASE === 'all') {
  const compact = readFileSync(`${SCRATCH}/stranger_compact.txt`, 'utf8').trim();
  const invite = enc({ compact, address: 'http://127.0.0.1:8009', name: 'Марта' });
  writeFileSync(`${SCRATCH}/stranger_invite.txt`, invite);

  const before = await api(A_API, TOK_A, '/messenger/conversations');
  const { page } = await openNode(A_UI, TOK_A, 'a_stranger');

  clicks.length = 0;
  const t0 = Date.now();
  await click(page, NEW_CHAT, 'Новий', t0);
  await page.waitForSelector('[data-testid="peer-key"]');
  // Вставлення — це Ctrl+V, а не клік: поле під курсором одразу.
  await page.keyboard.insertText(invite);
  await page.waitForSelector('[data-testid="invite-who"]', { timeout: 10000 });
  await page.waitForTimeout(600);

  const who = await page.textContent('[data-testid="invite-who"]');
  await shot(page, 'c_accept_card', page.locator('[data-testid="invite-who"]'));
  await shot(page, 'c_accept_full');

  await click(page, '[data-testid="open-conversation"]', 'Відкрити розмову', t0);
  const opened = await page
    .waitForSelector('[data-testid="invite-who"]', { state: 'detached', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await shot(page, 'x_open_failed');
    log.stranger_fail = await page.evaluate(() =>
      [...document.querySelectorAll('.bg-\\[\\#FDF6EC\\]')].map((e) => e.textContent).join(' | '),
    );
  }
  await page.waitForTimeout(2500);
  await shot(page, 'd_conversation_open');

  const after = await api(A_API, TOK_A, '/messenger/conversations');
  log.stranger = {
    invite_length: invite.length,
    who_text: (who || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    conversations_before: before.body.length,
    conversations_after: after.body.length,
    new_titles: after.body
      .filter((c) => !before.body.some((p) => p.id === c.id))
      .map((c) => ({ title: c.title, peer: c.peer_node_id, verified: c.contact_verified })),
    clicks: clicks.map((c) => `${c.n}. ${c.label} (+${c.ms} мс)`),
    click_count: clicks.length,
    ms_total: clicks[clicks.length - 1].ms,
  };
  await page.context().close();
}

// ── 3. Прийняття справжнього запрошення на вузлі B + листи в обидва боки ────
if (PHASE === 'accept' || PHASE === 'all') {
  const invite = readFileSync(`${SCRATCH}/door_invite.txt`, 'utf8').trim();
  const beforeB = await api(B_API, TOK_B, '/messenger/conversations');

  const { page } = await openNode(B_UI, TOK_B, 'b_accept');
  // Кладемо запрошення в буфер так, як його туди кладе життя — з чужого чату,
  // зі словами навколо: розбір мусить витягти рядок із тексту.
  await page.evaluate(
    (t) => navigator.clipboard.writeText(t),
    `Привіт! Ось моє запрошення в PHANTOM:\n${invite}\nчекаю`,
  );

  clicks.length = 0;
  const t0 = Date.now();
  await click(page, NEW_CHAT, 'Новий', t0);
  await page.waitForSelector('[data-testid="peer-key"]');
  await page.waitForTimeout(1200);
  const offered = await page.isVisible('[data-testid="paste-clipboard-invite"]');
  await shot(page, 'e_clipboard_offer');

  if (offered) {
    await click(page, '[data-testid="paste-clipboard-invite"]', 'Вставити з буфера', t0);
  } else {
    await page.keyboard.insertText(invite);
  }
  await page.waitForSelector('[data-testid="invite-who"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  const whoB = await page.textContent('[data-testid="invite-who"]');
  await shot(page, 'f_accept_card_b', page.locator('[data-testid="invite-who"]'));

  await click(page, '[data-testid="open-conversation"]', 'Відкрити розмову', t0);
  await page.waitForSelector('[data-testid="invite-who"]', { state: 'detached', timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot(page, 'g_conversation_open_b');

  const afterB = await api(B_API, TOK_B, '/messenger/conversations');
  const mine = afterB.body.find((c) => c.peer_node_id && c.peer_node_id.startsWith('86a15538'));

  // ── лист туди ──
  const stamp = Date.now();
  const sentB = await api(B_API, TOK_B, `/messenger/conversations/${mine.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      client_id: `door-b-${stamp}`,
      author_id: 'me',
      author_name: 'Б',
      kind: 'text',
      body: `двері: лист з B ${stamp}`,
    }),
  });
  await new Promise((r) => setTimeout(r, 3000));

  const convA = await api(A_API, TOK_A, '/messenger/conversations');
  const aRow = convA.body.find((c) => c.peer_node_id && c.peer_node_id.startsWith('388c1017'));
  const msgsA = aRow
    ? await api(A_API, TOK_A, `/messenger/conversations/${aRow.id}/messages`)
    : { body: [] };
  const arrivedOnA = (msgsA.body || []).some((m) => (m.body || '').includes(String(stamp)));

  // ── лист назад ──
  const stamp2 = Date.now();
  const sentA = aRow
    ? await api(A_API, TOK_A, `/messenger/conversations/${aRow.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: `door-a-${stamp2}`,
          author_id: 'me',
          author_name: 'Марта',
          kind: 'text',
          body: `двері: лист з A ${stamp2}`,
        }),
      })
    : { body: {} };
  await new Promise((r) => setTimeout(r, 3000));
  const msgsB = await api(B_API, TOK_B, `/messenger/conversations/${mine.id}/messages`);
  const arrivedOnB = (msgsB.body || []).some((m) => (m.body || '').includes(String(stamp2)));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await shot(page, 'h_chat_both_ways');

  log.accept = {
    clipboard_offer_shown: offered,
    who_text: (whoB || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    conversations_before: beforeB.body.length,
    conversations_after: afterB.body.length,
    opened_title: mine?.title,
    clicks: clicks.map((c) => `${c.n}. ${c.label} (+${c.ms} мс)`),
    click_count: clicks.length,
    ms_total: clicks[clicks.length - 1].ms,
    b_to_a: { post: sentB.status, delivery: sentB.body?.delivery_state, arrived_on_a: arrivedOnA },
    a_to_b: { post: sentA.status, delivery: sentA.body?.delivery_state, arrived_on_b: arrivedOnB },
  };
  await page.context().close();
}

// ── 4. Що ще приймає поле: старий ключ, слова навколо, сміття ──────────────
if (PHASE === 'tolerate') {
  const compact = readFileSync(`${SCRATCH}/stranger_compact.txt`, 'utf8').trim();
  const invite = readFileSync(`${SCRATCH}/door_invite.txt`, 'utf8').trim();
  const { page } = await openNode(A_UI, TOK_A, 'a_tolerate');
  await page.click(NEW_CHAT);
  await page.waitForSelector('[data-testid="peer-key"]');

  const feed = async (text) => {
    await page.fill('[data-testid="peer-key"]', '');
    await page.waitForTimeout(250);
    await page.fill('[data-testid="peer-key"]', text);
    await page.waitForTimeout(700);
    const who = await page.locator('[data-testid="invite-who"]').count();
    return {
      recognised: who > 0,
      who: who ? (await page.textContent('[data-testid="invite-who"]')).replace(/\s+/g, ' ').slice(0, 90) : null,
      addressAsked: (await page.locator('[data-testid="peer-address"]').count()) > 0,
      button: await page.locator('[data-testid="open-conversation"]').isDisabled(),
    };
  };

  log.tolerate = {
    'голий ключ без конверта (355)': await feed(compact),
    'запрошення серед слів': await feed(`гей, лови: ${invite} — тисни`),
    'запрошення з переносами': await feed(`\n\n${invite}\n\n`),
    'без схеми, голий base64': await feed(invite.replace('phantom://invite/', '')),
    'сміття': await feed('це точно не ключ'),
    'порожньо': await feed('   '),
  };
  await shot(page, 'i_bare_key');
  await page.context().close();
}

await browser.close();
const path = `${OUT}/door_log.json`;
const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
writeFileSync(path, JSON.stringify({ ...prev, ...log }, null, 2));
console.log(JSON.stringify(log, null, 2));
