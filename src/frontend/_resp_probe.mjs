// Вузькі екрани месенджера: горизонтальний скрол, зрізані вузли, модалки.
// Тимчасовий інструмент виміру (не для коміту).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const TAG = process.argv[3] || 'before';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });

const overflowProbe = () =>
  ({
    vw: window.innerWidth,
    bodyScrollW: document.body.scrollWidth,
    bodyClientW: document.body.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    // Ширина кореня месенджера: якщо більша за в'юпорт — усе праворуч зрізано.
    rootW: Math.round(document.querySelector('.messenger-scale')?.getBoundingClientRect().width ?? -1),
    rootRight: Math.round(document.querySelector('.messenger-scale')?.getBoundingClientRect().right ?? -1),
    // Вузли, що вилізли за правий край в'юпорта більш ніж на 2px.
    offRight: [...document.querySelectorAll('body *')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        if (r.right <= window.innerWidth + 2) return null;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return null;
        return {
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 70),
          right: Math.round(r.right),
          w: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 30),
        };
      })
      .filter(Boolean)
      .slice(0, 14),
  });

const report = {};

for (const width of [375, 768, 1024, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 } });
  // Список має бути списком: збережений activeChatId відкривав розмову ще до
  // першого знімка.
  await ctx.addInitScript(() => {
    try {
      const k = Object.keys(localStorage).find((x) => /messenger/i.test(x));
      if (k) localStorage.removeItem(k);
    } catch {
      /* нічого */
    }
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5173/messenger', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('.messenger-scale'), { timeout: 45000 });
  await page.waitForTimeout(3500);

  // Стрічка відкривається одразу на першій розмові — щоб зняти саме СПИСОК,
  // спершу тиснемо «назад» (на телефоні) або дивимось як є (на десктопі).
  const back = page.locator('[title="Назад до списку бесід"]').first();
  if (await back.count()) {
    await back.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1400);
  }
  report[`${width}_list`] = await page.evaluate(overflowProbe);
  await page.screenshot({ path: `${OUT}/${TAG}_${width}_list.png` });

  // Відкриваємо першу розмову зі списку.
  const chat = page.locator('text=Доказ-видалення').first();
  if (await chat.count()) await chat.click({ force: true }).catch(() => {});
  await page.waitForTimeout(2500);

  report[`${width}_chat`] = await page.evaluate(overflowProbe);
  // Ширина текстового вузла найдовшої бульбашки + чи видно кнопку надсилання.
  report[`${width}_chat`].composer = await page.evaluate(() => {
    const send = [...document.querySelectorAll('button')].find((b) =>
      /надісл|send/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''),
    );
    const ta = document.querySelector('textarea');
    const r = (el) => (el ? { l: Math.round(el.getBoundingClientRect().left), r: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width) } : null);
    const bubbles = [...document.querySelectorAll('.msg-bubble-fluid')].map((b) => Math.round(b.getBoundingClientRect().width));
    return { send: r(send), textarea: r(ta), vw: window.innerWidth, bubbleMax: Math.max(0, ...bubbles), bubbles: bubbles.length };
  });
  await page.screenshot({ path: `${OUT}/${TAG}_${width}_chat.png` });

  if (width === 375) {
    // Модалки на найвужчому екрані: чи влазять і чи мають скрол.
    const modalProbe = () =>
      page.evaluate(() => {
        const host = document.querySelector('.phantom-scrim') || document.querySelector('[role="dialog"]');
        if (!host) return { found: false };
        // Найбільша панель усередині заслінки.
        const cands = host.matches('[role="dialog"]')
          ? [{ el: host, r: host.getBoundingClientRect() }]
          : [...host.querySelectorAll('*')]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter((x) => x.r.width > 120 && x.r.height > 80)
              .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
        const p = cands[0];
        if (!p) return { found: false };
        const scrollable = [...host.querySelectorAll('*')].some(
          (el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY),
        );
        return {
          found: true,
          left: Math.round(p.r.left),
          right: Math.round(p.r.right),
          top: Math.round(p.r.top),
          bottom: Math.round(p.r.bottom),
          w: Math.round(p.r.width),
          h: Math.round(p.r.height),
          vw: window.innerWidth,
          vh: window.innerHeight,
          fitsX: p.r.left >= -1 && p.r.right <= window.innerWidth + 1,
          fitsY: p.r.top >= -1 && p.r.bottom <= window.innerHeight + 1,
          scrollable,
        };
      });

    const menu = async (label) => {
      const dots = page.locator('[title="Більше дій"]').first();
      if (await dots.count()) await dots.click({ force: true });
      await page.waitForTimeout(700);
      const it = page.locator(`[role="menu"] button:has-text("${label}")`).first();
      if (await it.count()) await it.click({ force: true });
    };

    const opens = [
      ['verify', () => menu('Звір')],
      ['settings', () => menu('Налаштування месенджера')],
      ['p2p', () => menu("Мережевий зв'язок")],
      ['actions', () => menu('Студія карток')],
      ['new', async () => {
        const b = page.locator('[title="Назад до списку бесід"]').first();
        if (await b.count()) await b.click({ force: true });
        await page.waitForTimeout(1200);
        const n = page.locator('[aria-label="Створити новий діалог"]').first();
        if (await n.count()) await n.click({ force: true });
      }],
    ];
    for (const [name, open] of opens) {
      await open().catch(() => {});
      await page.waitForTimeout(1300);
      report[`375_modal_${name}`] = await modalProbe();
      await page.screenshot({ path: `${OUT}/${TAG}_375_modal_${name}.png` });
      // Чи закриває Escape.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      report[`375_modal_${name}`].escapeCloses = await page.evaluate(
        () => !document.querySelector('.phantom-scrim') && !document.querySelector('[role="dialog"]'),
      );
      if (!report[`375_modal_${name}`].escapeCloses) {
        // Закриваємо вручну, щоб наступна модалка відкрилася чисто.
        await page.mouse.click(width - 6, 6).catch(() => {});
        await page.waitForTimeout(500);
      }
      if (name === 'p2p') {
        // Смуга вкладок P2P: чи всі влазять і чи є скрол.
        report['375_p2p_tabs'] = await page.evaluate(() => null);
      }
    }
  }
  await ctx.close();
}

writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(report, null, 2));
console.log(`звіт: ${OUT}/${TAG}.json`);
await browser.close();
