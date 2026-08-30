/**
 * Кадр обох сторін розмови: два вузли, два вікна, один лист.
 *
 * Скрипт відкриває дві незалежні вкладки — кожна дивиться у СВІЙ вузол через
 * свій vite-проксі, — входить ПІНом першого запуску, доходить до месенджера й
 * знімає обидві сторони. Це доказ, якого не дає жодна перевірка по HTTP:
 * видно, що лист малюється в обох людей.
 *
 * Запуск (після `scripts/two_people_talk.py`, який створює саму розмову):
 *     node scripts/two_people_shot.mjs
 *
 * Потрібні підняті: вузол А :8001, вузол Б :8002, фронти :5180 і :5181.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright лежить у `src/frontend/node_modules`, а скрипт — у `scripts/`,
// тож звичайний імпорт його не знаходить: node шукає біля файлу, не біля cwd.
const require = createRequire('/home/kyrylo/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os-beta/src/frontend/');
const { chromium } = require('playwright');

const SIDES = [
  {
    who: 'А · Кирило',
    base: 'http://127.0.0.1:5180/messenger',
    pin: '/home/kyrylo/phantom_ai/qa-node-2026-08-29/identity/bootstrap_pin',
    talksTo: 'Вузол Б',
    shot: 'side-a.png',
  },
  {
    who: 'Б · Оксана',
    base: 'http://127.0.0.1:5181/messenger',
    pin: '/home/kyrylo/phantom_ai/qa-node-b/identity/bootstrap_pin',
    talksTo: 'Вузол А',
    shot: 'side-b.png',
  },
];

const OUT = process.env.SHOT_DIR || '/tmp/phantom-two-people';

/** Вводить ПІН на падлоку. Цифри — окремі кнопки з текстом, тож тиснемо їх
 *  по одній: `fill` тут не працює, поля вводу немає. */
async function unlock(page, pin) {
  // Шукаємо за ТЕКСТОМ, а не за роллю: у кнопок падлока немає доступного
  // імені — цифра лежить у дочірньому вузлі, і `getByRole({name})` їх не
  // бачить узагалі. Перша спроба через роль мовчки не натиснула нічого.
  for (const digit of pin.trim()) {
    await page
      .locator('button')
      .filter({ hasText: new RegExp(`^\\s*${digit}\\s*$`) })
      .first()
      .click({ timeout: 5000 });
    await page.waitForTimeout(150);
  }
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

for (const side of SIDES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    // Спершу коріння: перехід одразу в /messenger віддає замок, і подальший
    // `goto` після входу скидав сесію — А відкочувався на падлок.
    await page.goto(side.base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Замок з'являється не завжди — вузол міг лишитись розблокованим.
    // Вхід із перевіркою й повтором. Перші прогони пливли: то А проходив, а Б
    // лишався на падлоку, то навпаки — цифри тиснулись швидше, ніж екран
    // устигав їх прийняти. Тому не «натиснули й почекали», а «натиснули й
    // переконались, що замок зник».
    const lockVisible = () =>
      page.locator('text=Набери PIN').first().isVisible().catch(() => false);

    for (let attempt = 1; attempt <= 3 && (await lockVisible()); attempt += 1) {
      await unlock(page, readFileSync(side.pin, 'utf8'));
      await page
        .locator('text=Набери PIN')
        .first()
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {});
    }
    await page
      .locator('text=Піднімаю ядро')
      .waitFor({ state: 'detached', timeout: 45000 })
      .catch(() => {});
    await page.waitForTimeout(2000);

    // Чекаємо саме на список розмов, а не на час: інакше знімок ловить
    // порожню оболонку й виглядає як «месенджер порожній».
    await page
      .locator('text=Вузол')
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(2000);

    // Відкриваємо САМЕ розмову. Перший варіант тиснув перший-ліпший
    // `cursor-pointer` і відкривав картку профілю поверх стрічки — кадр
    // виходив про інше. Тому: спершу зняти все зайве, потім клікнути рядок
    // із заголовком співрозмовника.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    const row = page.locator(`text=${side.talksTo}`).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);

    await page.screenshot({ path: `${OUT}/${side.shot}`, fullPage: false });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
    console.log(`\n══ ${side.who} ══`);
    console.log(text.split('\n').filter(Boolean).slice(0, 12).join('\n'));
    console.log(`кадр: ${OUT}/${side.shot}`);
  } catch (err) {
    console.log(`\n══ ${side.who} ══\nне вдалось: ${String(err).slice(0, 160)}`);
  } finally {
    await context.close();
  }
}

await browser.close();
