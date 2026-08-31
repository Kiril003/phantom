/**
 * Застосунок не ходить по картинки на чужий сервер.
 *
 * До 30.08.2026 у месенджері жило 30 живих посилань на `images.unsplash.com`.
 * Дві біди, і друга гірша за першу.
 *
 * **Обличчя.** Фото незнайомих людей ставали аватаркою власника, якщо він
 * своєї не поставив (`MessengerRoot`), обличчям кожного нового співрозмовника
 * (`createDirectMessage`), і навіть їхали у КОЖНОМУ вихідному повідомленні як
 * аватарка відправника (`messengerNetworkEngine`).
 *
 * **Мережа.** Продукт, який обіцяє працювати без інфраструктури, при кожному
 * відкритті вікна **ходив на чужий сервер із IP власника**. Для месенджера,
 * що продається як «без інфраструктури», це не косметика, а суперечність із
 * власною обіцянкою — і слід, якого не мало існувати.
 *
 * Сторож дивиться саме на ЖИВІ рядки: згадка в коментарі, який пояснює
 * прибране, — це пам'ять, а не виклик.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Корінь `src`. Через `fileURLToPath`, а не `URL.pathname`: другий дає
 *  шлях, який `readdirSync` на цій машині не приймає. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Хости, по які застосунок не має ходити за картинками. */
const OUTSIDE = /https?:\/\/(images\.unsplash\.com|source\.unsplash\.com|i\.pravatar\.cc|picsum\.photos)/;

/** Екрани за замком `hiddenModals` — код цілий, вхід зачинено, мережі немає.
 *  Перелік тут короткий навмисно: кожне ім'я має зникнути звідси разом із
 *  поверненням екрана, і тоді сторож почервоніє й нагадає прибрати посилання. */
// Перелік «за замком» ВИВОДИМО з реального замка, а не пишемо рукою.
//
// Рукою написаний перелік збрехав: `ActionHubModal.tsx` стояв тут як
// замкнений, а в `hiddenModals.ts` його немає — тобто модал відкривається, і
// сторож роками пропускав би на ньому чужі обличчя. Ворота, що звільняють
// файл за власним твердженням про замок, — це ворота без шляху до червоного.
const LOCK_SOURCE = readFileSync(
  join(ROOT, 'components/messenger/modals/hiddenModals.ts'),
  'utf8',
);

/** `AcademyHubModal.tsx` → `academyHub`: угода про імена в цьому дереві. */
function lockKeyOf(fileName: string): string {
  const base = fileName.replace(/Modal\.tsx$/, '').replace(/\.tsx?$/, '');
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function isLocked(fileName: string): boolean {
  const key = lockKeyOf(fileName);
  return new RegExp(`['"\`]${key}['"\`]`).test(LOCK_SOURCE);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Живий рядок — той, що виконується. Коментар про прибране не рахуємо. */
function liveHits(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => OUTSIDE.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe('чужих облич і чужих серверів немає', () => {
  it('жоден ДОСЯЖНИЙ екран не тягне картинку ззовні', () => {
    const offenders = walk(ROOT)
      .filter((f) => liveHits(f).length > 0)
      .filter((f) => !isLocked(f.split('/').pop() as string))
      .map((f) => f.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it('звільнення від перевірки дає лише СПРАВЖНІЙ замок', () => {
    // Раніше тут стояв рукописний перелік, і саме він збрехав: `ActionHubModal`
    // значився замкненим, не будучи ним. Тепер перевіряємо протилежне —
    // що кожне звільнення підтверджене `hiddenModals.ts`, тобто ворота не
    // можуть звільнити файл власним твердженням.
    const freed = walk(ROOT)
      .filter((f) => liveHits(f).length > 0)
      .map((f) => f.split('/').pop() as string)
      .filter((name) => isLocked(name));

    for (const name of freed) {
      expect(LOCK_SOURCE).toMatch(new RegExp(lockKeyOf(name)));
    }
  });
});
