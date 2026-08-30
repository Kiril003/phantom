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
const BEHIND_THE_LOCK = new Set([
  'AcademyHubModal.tsx',
  'ActionHubModal.tsx',
  'AutomationPipelineModal.tsx',
  'RoleScopesModal.tsx',
]);

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
      .filter((f) => !BEHIND_THE_LOCK.has(f.split('/').pop() as string))
      .map((f) => f.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it('перелік за замком не розростається', () => {
    // Якщо сюди щось додали, значить у дереві з'явився новий екран із чужими
    // картинками — і його сховали замість того, щоб прибрати посилання.
    expect(BEHIND_THE_LOCK.size).toBeLessThanOrEqual(4);
  });
});
