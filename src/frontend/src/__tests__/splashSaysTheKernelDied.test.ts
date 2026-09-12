/**
 * Заставка мусить сказати, що ядро ПОМЕРЛО, а не рахувати далі.
 *
 * Виміряно 12.09.2026 на артефакті `74469351`, відтворено на запакованому
 * сайдкарі: коли 127.0.0.1:8000 уже зайнятий кимось іншим, бекенд чесно
 * пише `[Errno 98] address already in use` і виходить кодом 1. Заставка при
 * цьому показувала «гріюсь 204s»: про смерть знав лише `log::error!` в
 * оболонці, чий stderr у пакунку не веде нікуди, а чужий слухач на 8000 на
 * `/readyz` не відповідає — тобто опитування ніколи не завершиться, і три
 * «чесних» стани заставки тут усі три брешуть.
 *
 * Цей сторож НЕ дивиться на текст файла: він ЗАПУСКАЄ заставку з мертвим
 * бекендом і читає те, що побачить людина.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../public/splash.js'), 'utf8');
const ERRNO = "[Errno 98] error while attempting to bind on address ('127.0.0.1', 8000): address already in use";

/** Заставка — класичний скрипт без експортів; вантажимо її так само. */
function runSplash(): void {
  new Function(SRC)();
}

describe('заставка й смерть ядра', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="status">starting…</div>';
    // Єдине джерело адреси бекенда, як у splash.html.
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND__ = {
      absolute: (p: string) => `http://127.0.0.1:8000${p}`,
    };
    // Ядра немає: опитування падає, як воно падає в мертвого пакунка.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_DIED__;
    delete (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__;
  });

  it('називає код виходу й останній рядок ядра', async () => {
    // Код 3 — це провал lifespan; виміряно 12.09.2026 запуском пакунка з
    // `HOST=0.0.0.0 PHANTOM_PACKAGED=1`, тобто сторожем V-4.
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_DIED__ = {
      code: 3,
      signal: null,
      last: "2026-09-12 19:21:30,856 [phantom] [ERROR] RuntimeError: Refusing to start packaged build with host='0.0.0.0'",
    };
    runSplash();
    const status = document.getElementById('status')!;
    await vi.waitFor(() => expect(status.textContent).toContain('код 3'), { timeout: 3000 });
    // Причина — саме в рядку бекенда; без нього «код 3» нічого не пояснює.
    expect(status.textContent).toContain('Refusing to start');
    // Мітка часу й рівень зі скла зникають: місця займають, змісту не несуть.
    expect(status.textContent).not.toContain('2026-09-12');
    expect(status.textContent).not.toContain('[phantom]');
    // І жодного слова про прогрів: його вже немає.
    expect(status.textContent).not.toMatch(/грію|розпаков/);
  });

  it('зайнятий порт називає другим примірником, а не поломкою', async () => {
    // Виміряно 12.09.2026: власник запустив пакунок кілька разів поспіль,
    // другий уперся в зайнятий 8000 і вийшов кодом 1. «код 1» тут технічно
    // правда й практично нікому не поможе.
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_DIED__ = {
      code: 1,
      signal: null,
      last: ERRNO,
    };
    runSplash();
    const status = document.getElementById('status')!;
    await vi.waitFor(() => expect(status.textContent).toContain('уже запущено'), { timeout: 3000 });
    expect(status.textContent).not.toMatch(/грію|розпаков/);
  });

  it('поки ядро встає, показує КРОК людськими словами, а не рядок логу', async () => {
    // Спершу було «гріюсь 204s» — лічильник без змісту при живому старті.
    // Потім ми показали рядок журналу, і власник спитав: «от що то за написи?
    // кому воно треба?». Обидва рази прилад говорив не мовою того, хто
    // дивиться. Тепер рядок ядра лише ВПІЗНАЄТЬСЯ, а на склі стоїть крок.
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__ =
      '2026-09-12 19:09:11,833 [phantom] [INFO] main: PHANTOM OS starting...';
    runSplash();
    const status = document.getElementById('status')!;
    await vi.waitFor(() => expect(status.textContent).toMatch(/піднімаю ядро/), {
      timeout: 3000,
    });
    expect(status.textContent).toMatch(/крок 2 з/);
    // Нічого з рядка логу на скло не потрапило.
    expect(status.textContent).not.toContain('2026-09-12');
    expect(status.textContent).not.toContain('[phantom]');
    expect(status.textContent).not.toContain('main:');
  });

  it('поки ядро живе-піднімається, про смерть не згадує', async () => {
    // Смерті немає — заставка мусить лишитись у своєму першому стані, а не
    // вигадувати відмову. Це та сама вада навиворіт: вирок справному ядру.
    runSplash();
    const status = document.getElementById('status')!;
    await vi.waitFor(() => expect(status.textContent).toMatch(/розпаков|крок/), { timeout: 3000 });
    expect(status.textContent).not.toMatch(/зупинилось|код|сигнал/);
  });
});
