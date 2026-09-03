/**
 * Веб мусить бути придатним для пальця.
 *
 * Власник відкрив веб у телефоні: «під телефон не оптимізовано, я натиснути
 * не можу а дещо випирає». Виміряно 01.09, і причини знайшлись конкретні:
 *   • `--touch-min` був 44px — поріг Apple, а не Android;
 *   • `CanvasSplitView` мав `min-w-[760px]` — на 393px це гарантована
 *     горизонтальна прокрутка, тобто те саме «випирає»;
 *   • мій же навігатор просторів займав 316px із 393.
 *
 * ЧОГО ЦЕЙ СТОРОЖ НЕ ВМІЄ, і це треба знати: jsdom **не рахує розкладку**.
 * `getBoundingClientRect` тут завжди нулі, тож виміряти справжні пікселі
 * цим інструментом неможливо — він відповів би про себе, а не про екран.
 * Тому перевірка СТАТИЧНА: вона ловить клас («жорстка ширина, більша за
 * телефон»), а не наслідок. Справжній вимір — у Playwright на 393px.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PHONE_WIDTH = 393;
const ROOT = resolve(__dirname, '../components/messenger');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return n.endsWith('.tsx') ? [p] : [];
  });
}

/** Жорстка ширина без відповідального префікса (`sm:`/`md:`/`lg:`) —
 *  вона діє й на телефоні. З префіксом — лише на широкому, і це дозволено. */
/** Коментарі геть перед пошуком. Пояснення до прибраної ширини цитує її ж —
 *  і сторож падав би на власному тексті. Дім наступав на це тричі. */
function stripComments(src: string): string {
  // Порожні рядки замість вмісту, а НЕ вирізання: номер рядка мусить лишитись
  // тим самим. Інакше позначка `phone-ok` вказувала б не на той рядок —
  // помилка, на якій я щойно втратив три спроби.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/** Рядки під позначкою `phone-ok: <причина>` дозволені — але ЛИШЕ з причиною.
 *  Виняток без пояснення нічим не кращий за тихе послаблення правила. */
function allowedLines(raw: string): Set<number> {
  const out = new Set<number>();
  raw.split('\n').forEach((l, i) => {
    if (/phone-ok:\s*\S+/.test(l)) [1, 2, 3].forEach((d) => out.add(i + 1 + d));
  });
  return out;
}

function rigidWidths(raw: string): { cls: string; px: number }[] {
  const allowed = allowedLines(raw);
  const lineOf = (idx: number) => raw.slice(0, idx).split('\n').length;
  const src = stripComments(raw);
  const out: { cls: string; px: number }[] = [];
  const re = /(^|[\s"'`{])(min-w|w)-\[(\d+)px\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 4), m.index + m[1].length);
    if (/(sm|md|lg|xl):$/.test(before)) continue;
    const px = Number(m[3]);
    if (px > PHONE_WIDTH && !allowed.has(lineOf(m.index))) {
      out.push({ cls: `${m[2]}-[${px}px]`, px });
    }
  }
  return out;
}

describe('придатність вебу для телефона', () => {
  it('поріг дотику не нижчий за 48px', () => {
    const tokens = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');
    const m = tokens.match(/--touch-min:\s*(\d+)px/);
    expect(m, '--touch-min зник із токенів').toBeTruthy();
    expect(Number(m![1]), '44 — поріг Apple; Android вимагає 48').toBeGreaterThanOrEqual(48);
  });

  it('поріг застосовується до всіх контролів на дотикових пристроях', () => {
    const globals = readFileSync(resolve(__dirname, '../styles/globals.css'), 'utf8');
    const coarse = globals.slice(globals.indexOf('@media (pointer: coarse)'));
    expect(coarse, 'правило для coarse зникло — палець знову не влучить').toContain('--touch-min');
  });

  it('жодної жорсткої ширини, ширшої за телефон, без відповідального префікса', () => {
    const guilty: string[] = [];
    for (const f of tsxFiles(ROOT)) {
      for (const w of rigidWidths(readFileSync(f, 'utf8'))) {
        guilty.push(`${f.replace(ROOT, '')}: ${w.cls}`);
      }
    }
    expect(
      guilty,
      `ширини понад ${PHONE_WIDTH}px діють і на телефоні — це і є «випирає»:\n` +
        guilty.map((g) => `  • ${g}`).join('\n') +
        '\nЛікується префіксом (`lg:min-w-[…]`), а не зменшенням числа.',
    ).toEqual([]);
  });
});
