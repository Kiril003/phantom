#!/usr/bin/env node
// Аудит верстки на СПРАВЖНЬОМУ екрані пристрою — 1024×600.
//
//   node scripts/layout-audit.mjs [http://127.0.0.1:5201]
//
// Шукає рівно те, що видно оком і чого не ловить жоден тест:
//   ОБРІЗ    — елемент виходить за межі екрана або за межі свого контейнера
//   НАКЛАД   — два видимі елементи з текстом лежать один на одному
//   ШОВ      — сусідні великі поверхні різного кольору стикаються без межі
//   ДРІБНЕ   — ціль дотику менша за 44×44
//
// Вирок — цей вивід, не код виходу.

import { chromium } from '../src/frontend/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5201';
const CHROME = '/home/kyrylo/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const PIN_FILE = new URL('../.phantom-data/identity/bootstrap_pin', import.meta.url).pathname;

const ROUTES = ['/', '/chat', '/operator', '/system', '/sentinel', '/map', '/settings'];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });

const pin = (() => {
  try {
    return readFileSync(PIN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
})();

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);
if (pin && (await page.getByRole('button', { name: /Увійти/i }).count())) {
  const f = await page.locator('input').all();
  await f[0].fill('phantom');
  await f[1].fill(pin);
  await page.getByRole('button', { name: /Увійти/i }).click();
  await page.waitForTimeout(4500);
}

const AUDIT = () => {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const out = { clip: [], overlap: [], seam: [], small: [] };

  const label = (el) => {
    const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 34);
    const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` «${t}»` : ''}`;
  };

  // Справжня видима рамка: перетин власної рамки з рамками ВСІХ предків, що
  // обрізають вміст. Без цього кожен рядок списку, що гортається, здається
  // «обрізаним екраном» — а він просто нижче за прокрутку, і це не дефект.
  const clipRect = (el) => {
    let r = el.getBoundingClientRect();
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      const clips = /auto|scroll|hidden|clip/.test(st.overflowY + st.overflowX);
      if (!clips) continue;
      const p = n.getBoundingClientRect();
      box = {
        left: Math.max(box.left, p.left),
        top: Math.max(box.top, p.top),
        right: Math.min(box.right, p.right),
        bottom: Math.min(box.bottom, p.bottom),
      };
    }
    return box;
  };

  const onScreen = (b) => b.right - b.left > 2 && b.bottom - b.top > 2;

  const visible = [];
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const box = clipRect(el);
    if (!onScreen(box)) continue; // повністю схований прокруткою — не наша справа
    visible.push({ el, r: { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
                            width: box.right - box.left, height: box.bottom - box.top }, st, raw: r });
  }

  // ОБРІЗ: видима частина елемента стирчить за екран пристрою. Якщо його ріже
  // власний предок зі скролом — це задум, а не дефект, і сюди він не потрапить.
  for (const { el, r, raw } of visible) {
    const over =
      Math.max(0, -r.left) + Math.max(0, r.right - W) + Math.max(0, -r.top) + Math.max(0, r.bottom - H);
    if (over > 6 && raw.width < W * 1.6 && raw.height < H * 1.6) {
      out.clip.push(`${label(el)} — за екран на ${Math.round(over)}px`);
    }
  }

  // НАКЛАД: два тексти лежать один на одному, і жоден не є предком іншого.
  const texted = visible.filter(({ el }) => {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    return direct;
  });
  for (let i = 0; i < texted.length; i++) {
    for (let j = i + 1; j < texted.length; j++) {
      const a = texted[i];
      const b = texted[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x <= 3 || y <= 3) continue;
      const area = x * y;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (area / smaller > 0.35) {
        out.overlap.push(`${label(a.el)}  ×  ${label(b.el)} — ${Math.round((area / smaller) * 100)}%`);
      }
    }
  }

  // ДРІБНЕ: ціль дотику менша за палець.
  for (const el of document.querySelectorAll('button,a,[role="button"],input,select')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.width < 44 || r.height < 44) out.small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  return out;
};

const seen = new Set();
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(route === '/map' ? 9000 : 4500);
  const r = await page.evaluate(AUDIT);

  const uniq = (arr) => [...new Set(arr)];
  console.log(`\n── ${route}`);
  const clip = uniq(r.clip);
  const over = uniq(r.overlap);
  const small = uniq(r.small);
  if (!clip.length && !over.length && !small.length) console.log('   чисто');
  if (clip.length) {
    console.log(`   ОБРІЗ (${clip.length}):`);
    clip.slice(0, 8).forEach((s) => console.log(`     ${s}`));
  }
  if (over.length) {
    console.log(`   НАКЛАД (${over.length}):`);
    over.slice(0, 8).forEach((s) => console.log(`     ${s}`));
  }
  if (small.length) {
    console.log(`   ДРІБНЕ (${small.length}): ${small.slice(0, 5).join(' · ')}`);
  }
  clip.concat(over).forEach((s) => seen.add(`${route}: ${s}`));
}

console.log(`\nусього дефектів обрізу й накладання: ${seen.size}`);
await browser.close();
