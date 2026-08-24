// Живий стан TURN на екрані «Мережа & P2P» + текст межі звʼязку.
// Аргументи: <out-dir> <scratch>. Тимчасовий інструмент.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('phantom_token', t);
  localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
}, TOK_A);
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/messenger', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);

const out = {};
out.ice = await page.evaluate(() => window.__phantomIce?.() ?? null);
out.link_note_before = await page.evaluate(() => window.__phantomLinkNote?.() ?? null);

await page.click('button[title^="Ваш вузол приймає"]');
await page.waitForTimeout(600);
await page.click('text=Діагностика & STUN');
await page.waitForTimeout(1200);

out.turn_attr = await page.getAttribute('[data-ice-turn]', 'data-ice-turn');
out.turn_row = await page.locator('[data-ice-turn]').first().innerText();
out.stun_row = await page.locator('[data-ice-stun]').first().innerText();
out.note = await page
  .locator('[data-ice-turn] ~ p')
  .first()
  .innerText()
  .catch(() => null);
out.link_note_after = await page.evaluate(() => window.__phantomLinkNote?.() ?? null);

await page.screenshot({ path: `${OUT}/p2p_turn_panel.png` });
console.log(JSON.stringify(out, null, 2));
await browser.close();
