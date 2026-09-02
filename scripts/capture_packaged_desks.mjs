/*
  Повний прохід по запакованому ПК — один раз, без людини біля клавіатури.

  Навіщо. Столи, мапа й смуга організму на ПАКУНКУ лишаються недоведеними:
  двері для кадрів (`?desk=1`) мертві в релізі за побудовою — вони стоять за
  `import.meta.env.DEV`, і складальник вирізає гілку. Це правильно, і саме
  тому єдиний шлях до столів у пакунку — вхід власника.

  Вікно такого входу коротке. Тому цей скрипт чекає, поки з'явиться
  автентифікована сесія, і тоді знімає ВСЕ за один захід — щоб не вийшло, що
  власник увійшов, а ми використали момент наполовину.

  Як користуватись:
    1. запусти AppImage;
    2. запусти цей скрипт — він чекатиме;
    3. власник вводить ПІН;
    4. скрипт сам знімає перелік і кладе кадри в `.build/shots/`.

  ЧОГО ЦЕЙ СКРИПТ НЕ РОБИТЬ І НЕ БУДЕ:
  * не вводить ПІН і не торкається полів входу — це межа, яку ми не
    переступаємо; він лише ЧЕКАЄ, поки вхід виконає людина;
  * не судить про колір. Кадри знімаються через CDP із живого вікна, але
    якщо колись доведеться вмикати програмний GL — памʼятай, що swiftshader
    обнуляє зелений і синій канали тексту (виміряно 30.08 сусідньою сесією).
*/
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = process.env.PHANTOM_SHOTS || '.build/shots';
const CDP = process.env.PHANTOM_CDP || 'http://127.0.0.1:9222';
const BACKEND = process.env.PHANTOM_BACKEND || 'http://127.0.0.1:8000';
const WAIT_MS = Number(process.env.PHANTOM_WAIT_MS || 15 * 60 * 1000);

// Перелік того, що треба зняти. Порядок навмисний: спершу те, чого ми
// взагалі не бачили в пакунку, потім решта.
const DESKS = ['Театр', 'Кокпіт', 'Компанія'];

mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`[кадри] ${m}`);

// ── 1. Чекаємо на вхід. Ознака — не наш здогад, а стан самого продукту:
// смуга столів зʼявляється лише після автентифікації.
async function waitForSession(page, deadline) {
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() => !!document.querySelector('nav button'))
      .catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

const browser = await chromium.connectOverCDP(CDP).catch((e) => {
  log(`не підʼєднався до вікна через CDP (${e.message}).`);
  log('Запусти AppImage з відкритим портом зневадження, напр.:');
  log('  WEBKIT_INSPECTOR_SERVER=127.0.0.1:9222 ./PHANTOM…AppImage');
  process.exit(2);
});

const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

log(`чекаю на вхід власника (до ${Math.round(WAIT_MS / 60000)} хв)…`);
const ok = await waitForSession(page, Date.now() + WAIT_MS);
if (!ok) {
  log('входу не дочекався — нічого не знімаю і нічого не вигадую.');
  process.exit(1);
}
log('сесія зʼявилась — знімаю');

// ── 2. Знімаємо все за один захід.
const report = [];
for (const desk of DESKS) {
  const clicked = await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('nav button')).find(
      (x) => x.textContent.trim().toUpperCase() === n.toUpperCase(),
    );
    if (!b) return false;
    b.click();
    return true;
  }, desk);
  // Мапі треба більше часу, ніж решті: вона тягне тайли.
  await page.waitForTimeout(desk === 'Театр' ? 8000 : 3000);
  const file = `${OUT}/packaged-${desk}.png`;
  await page.screenshot({ path: file });
  const main = await page.locator('main').first().innerText().catch(() => '');
  report.push({ desk, clicked, file, main: main.slice(0, 200).replace(/\n/g, ' | ') });
  log(`${desk}: ${clicked ? 'знято' : 'КНОПКИ НЕМА'} → ${file}`);
}

// ── 3. Смуга організму: те, заради чого все й робилось. Вранці 29.08 вона
// казала «канал обрив / ядро мовчить» при живому HTTP — тоді мертвими були
// і WS, і HTTP. Тепер обидва ходять через єдине джерело адреси; цей рядок
// покаже, чи ожила смуга.
const strip = await page
  .evaluate(() => (document.body.innerText || '').split('\n').slice(0, 14).join(' | '))
  .catch(() => '(не прочитав)');

// ── 4. Звіряємо з джерелом, а не з екраном: скільки клієнтів бачить ядро.
const health = await fetch(`${BACKEND}/health`)
  .then((r) => r.json())
  .catch(() => null);

console.log(
  JSON.stringify(
    { report, strip, health_ws_clients: health?.ws_clients ?? null },
    null,
    2,
  ),
);
await browser.close();
