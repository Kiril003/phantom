/**
 * Картки, яких вузол не возить, кажуть про це при вставці.
 *
 * Виміряно 31.08.2026. Опитування, подія й розділений рахунок вставляються
 * через `ActionHubModal` — і цей вузол інтерфейсу **не** під замком, тобто
 * власник відкриє його сьогодні. Далі `onInsertAction` кличе
 * `addCustomMessage`, який кладе рядок **лише в стор**: у `WIRE_KINDS` вузла
 * немає ані `poll`, ані `event`, ані `split-bill`.
 *
 * Наслідок для людини: вона складе опитування, побачить його у стрічці,
 * чекатиме голосів — і не дізнається, що співрозмовник не отримав нічого.
 * Мовчазна невдача, а не помилка; саме такі коштують найдорожче.
 *
 * `votePoll` під тим самим: голос міняє число лише тут. «7 голосів» означає
 * «7 ваших дотиків», а не думку групи. Жест лишаємо — людина справді може
 * позначити щось для себе, — але не вдаємо, що голос кудись поїхав.
 *
 * Сторож **умовний**, як і в чернетках: щойно `votePoll` почне ходити до
 * вузла (тобто стане асинхронним), перевірка вимкнеться сама. Ворота, які не
 * вміють піти самі, з часом брешуть у інший бік.
 *
 * У виразах — жодних `\w` і `\b`: у JS це `[A-Za-z0-9_]`, кирилиці вони не
 * ловлять, і сторож копії через них зелений за побудовою. Ця пастка сьогодні
 * вже зробила одну мою перевірку декоративною.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = readFileSync(join(SRC, 'stores/messengerStore.ts'), 'utf8');

/** Чи голос уже ходить до вузла: тоді попереджати нема про що. */
function voteReachesTheNode(): boolean {
  return /votePoll:\s*async/.test(STORE);
}

describe('картки, яких вузол не возить', () => {
  it('вставка попереджає, що картка лишається на цьому пристрої', () => {
    if (voteReachesTheNode()) return; // Механізм з'явився — сторож себе скасував.

    const root = readFileSync(join(SRC, 'components/messenger/MessengerRoot.tsx'), 'utf8');
    const visible = root.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // Саме в гілці вставки, а не десь у файлі: попередження мусить прозвучати
    // тоді, коли людина щойно склала картку.
    const branch = visible.slice(visible.indexOf('onInsertAction'));
    expect(branch).toMatch(/на цьому пристрої/i);
  });

  it('поки так — картки справді нікуди не їдуть, і це не здогад', () => {
    if (voteReachesTheNode()) return;

    // `addCustomMessage` синхронний і чіпає лише стор. Якщо колись він почне
    // ходити до вузла — ця перевірка почервоніє й попросить прибрати
    // попередження, яке стане зайвим.
    expect(STORE).toMatch(/addCustomMessage:\s*\(/);
    expect(STORE).not.toMatch(/addCustomMessage:\s*async/);
  });
});
