#!/usr/bin/env node
// Візуальний контроль якості: обходить кожен екран справжнім браузером,
// знімає його і збирає ВСІ помилки — не лише pageerror, а й консоль,
// мережу та непіймані обіцянки. Скріншоти лягають у --out, звіт у stdout.
//
//   node scripts/visual-qa.mjs http://127.0.0.1:5201 [--out DIR] [--view 1440x900]
//
// Порожній розділ «ПОМИЛКИ» — єдиний доказ, що екран цілий. Скріншот сам
// по собі нічого не доводить: застосунок білішає мовчки.

import { chromium } from '../src/frontend/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:5201';
const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = arg('--out', '/tmp/phantom-qa');
const [VW, VH] = arg('--view', '1440x900').split('x').map(Number);
const CHROME = '/home/kyrylo/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const ROUTES = [
  ['/', 'огляд'],
  ['/chat', 'чат'],
  ['/operator', 'штаб'],
  ['/system', 'система'],
  ['/sentinel', 'варта'],
  ['/map', 'мапа'],
  ['/polis', 'поліс'],
  ['/settings', 'налаштування'],
];

mkdirSync(OUT, { recursive: true });

const pin = (() => {
  try {
    return readFileSync(resolve(HERE, '../.phantom-data/identity/bootstrap_pin'), 'utf8').trim();
  } catch {
    return null;
  }
})();

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: VW, height: VH } });

const bag = [];
page.on('pageerror', (e) => bag.push(`JS  ${e.message.slice(0, 110)}`));
page.on('console', (m) => {
  if (m.type() === 'error') bag.push(`CON ${m.text().slice(0, 110)}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) bag.push(`NET ${r.status()} ${r.url().replace(BASE, '')}`);
});
// Скасований на розмонтуванні запит — не поломка. Показуємо причину, щоб
// не полювати на привидів: ERR_ABORTED відсіюємо.
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText ?? '';
  if (why.includes('ABORTED')) return;
  bag.push(`REQ ${why} ${r.url().replace(BASE, '').slice(0, 70)}`);
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(6000);

if (pin && (await page.getByRole('button', { name: /Увійти/i }).count())) {
  const fields = await page.locator('input').all();
  await fields[0].fill('phantom');
  await fields[1].fill(pin);
  await page.getByRole('button', { name: /Увійти/i }).click();
  await page.waitForTimeout(5000);
}

console.log(`PHANTOM OS · ${VW}×${VH} · ${BASE}\n`);
let bad = 0;

for (const [path, name] of ROUTES) {
  bag.length = 0;
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
  // Чекаємо, поки зникне заставка. Фіксована пауза давала фальшиві
  // «ПОРОЖНІЙ» на важких чанках (мапа), які vite щойно перезібрав.
  await page
    .waitForFunction(
      () => {
        const t = (document.body.innerText || '').trim();
        return t.length > 40 && !/^PHANTOM OS$/i.test(t);
      },
      { timeout: 25000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2000);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const text = (document.body.innerText || '').trim();
    const latin = [
      ...new Set(
        (text.match(/\b[A-Za-z][A-Za-z-]{3,}\b/g) || []).filter(
          // Дозволено: власні назви, ідентифікатори моделей, рівні логів
          // і атрибуція OSM — її вимагає ліцензія, перекладати не можна.
          (w) =>
            !/^(PHANTOM|Gemini|Flash|gemini-flash|Quota|NEXUS|ESP32|OpenFreeMap|OpenMapTiles|OpenStreetMap|Protomaps|MapLibre|Ollama|Radxa|Whisper|Vosk|Stripe|Tauri|sentinel|wi-fi|Wi-Fi|Json|JSON|DEBUG|INFO|WARNING|ERROR|CRITICAL|Data|from|contributors|CPU|RAM|GPS|API|PIN|HRV|AQI)$/i.test(w),
        ),
      ),
    ];
    const tiny = [...document.querySelectorAll('button, a, [role="button"]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).length;
    // Що ховається під нижнім доком. Композер чату вже двічі опинявся
    // під ним — на око це видно лише на скріншоті, тож міряємо.
    // Замість геометрії — прямий hit-test: чи повертає браузер саме цей
    // елемент у його центрі. Ловить і накриття доком, і будь-яке інше
    // перекриття, і не бреше на прокручених списках.
    const dockEl = document.querySelector('[data-testid="phantom-dock"]');
    let buried = 0;
    if (dockEl) {
      buried = [...document.querySelectorAll('input, textarea, button, a')].filter((el) => {
        if (dockEl.contains(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
        const hit = document.elementFromPoint(
          Math.round(r.left + r.width / 2),
          Math.round(r.top + r.height / 2),
        );
        return !!hit && dockEl.contains(hit);
      }).length;
    }

    // Англійська в підказках. innerText її не бачить, тож «Open Settings»
    // і «Згорнути Toolbar» жили на екрані непоміченими не одну перевірку.
    const ATTR_OK =
      /^(PHANTOM|Gemini|Flash|NEXUS|ESP32|OpenFreeMap|OpenMapTiles|OpenStreetMap|Protomaps|MapLibre|Ollama|Radxa|Whisper|Vosk|Stripe|Tauri|Json|JSON|DEBUG|INFO|WARNING|ERROR|CRITICAL|CPU|RAM|GPS|API|PIN|HRV|AQI)$/i;
    const attrLatin = [
      ...new Set(
        [...document.querySelectorAll('[aria-label], [title], [placeholder]')]
          .flatMap((el) =>
            ['aria-label', 'title', 'placeholder']
              .map((a) => el.getAttribute(a) || '')
              .join(' ')
              .match(/\b[A-Za-z][A-Za-z-]{3,}\b/g) || [],
          )
          .filter((w) => !ATTR_OK.test(w)),
      ),
    ];

    // Контраст тексту проти найближчого непрозорого тла. Білі числа на
    // кремовому й neutral-400 на світлому інакше видно лише на скріншоті.
    const lum = (s) => {
      const m = (s.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
    };
    let faint = 0;
    for (const el of document.querySelectorAll('*')) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      if (own.length < 3) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.15) continue;
      let bg = 'rgba(0, 0, 0, 0)';
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'transparent' && !/,\s*0\)$/.test(c)) { bg = c; break; }
      }
      const a = lum(cs.color);
      const b = lum(bg);
      if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 2.2) faint += 1;
    }

    return {
      chars: text.length,
      overflowY: doc.scrollHeight - doc.clientHeight,
      overflowX: doc.scrollWidth - doc.clientWidth,
      latin: latin.slice(0, 5),
      attrLatin: attrLatin.slice(0, 5),
      faint,
      tiny,
      buried,
    };
  });

  await page.screenshot({ path: `${OUT}/${name}.png` });

  const flags = [];
  if (m.chars < 40) flags.push('ПОРОЖНІЙ');
  if (m.overflowY > 0) flags.push(`вниз +${m.overflowY}px`);
  if (m.overflowX > 0) flags.push(`вбік +${m.overflowX}px`);
  if (m.tiny) flags.push(`дрібні цілі: ${m.tiny}`);
  if (m.buried) { flags.push(`ПІД ДОКОМ: ${m.buried}`); bad += m.buried; }
  if (m.faint) { flags.push(`НЕ ВИДНО ТЕКСТ: ${m.faint}`); bad += m.faint; }
  if (m.latin.length) flags.push(`англ: ${m.latin.join(' ')}`);
  if (m.attrLatin.length) flags.push(`англ у підказках: ${m.attrLatin.join(' ')}`);
  if (bag.length) { flags.push(`ПОМИЛОК ${bag.length}`); bad += bag.length; }

  console.log(`${path.padEnd(12)} ${String(m.chars).padStart(5)}зн  ${flags.join(' · ') || 'чисто'}`);
  bag.slice(0, 4).forEach((e) => console.log(`             ${e}`));
}

console.log(`\nзнімки: ${OUT}`);
console.log(bad ? `ПОМИЛОК УСЬОГО: ${bad}` : 'ПОМИЛОК НЕМАЄ');

await browser.close();
process.exit(bad ? 1 : 0);
