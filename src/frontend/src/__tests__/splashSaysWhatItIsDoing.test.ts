/**
 * Заставка мусить казати ЛЮДИНІ, що зараз робиться — не журналом і не голим
 * лічильником.
 *
 * Історія цього файла — історія двох помилок поспіль, і друга була наша.
 * Спершу заставка показувала «гріюсь 204s»: лічильник без змісту, який на
 * живому старті читається як поломка. Ми замінили його рядком журналу
 * бекенда — і 12.09.2026 власник побачив на склі
 *
 *     ядро: lifespan_warmup: Chroma janitor: SQL deleted=0 kept=0; FS deleted=0
 *
 * і спитав: «от що то за написи? кому воно треба?». Правдивий рядок для
 * інженера — для людини той самий нуль.
 *
 * Тому сторож тепер не грепає файл, а ЗАПУСКАЄ заставку й читає те, що
 * побачить людина.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../public/splash.js'), 'utf8');

function runSplash(): void {
  new Function(SRC)();
}

function shown(): string {
  return document.getElementById('status')!.textContent ?? '';
}

describe('слова заставки', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="status">starting…</div>';
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND__ = {
      absolute: (p: string) => `http://127.0.0.1:8000${p}`,
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__;
    delete (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_DIED__;
  });

  it('перший стан називає роботу й номер кроку, а не очікування', async () => {
    runSplash();
    await vi.waitFor(() => expect(shown()).toMatch(/крок 1 з \d/), { timeout: 3000 });
    // Що саме робиться — людськими словами.
    expect(shown()).toMatch(/розпаков/);
    // І жодного слова про помилку до порога терпіння.
    expect(shown()).not.toMatch(/помилк|збій|провал|не вдалося/i);
  });

  it('крок росте, коли ядро повідомляє про віху', async () => {
    runSplash();
    await vi.waitFor(() => expect(shown()).toMatch(/крок 1 з/), { timeout: 3000 });
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__ =
      '2026-09-12 20:36:50,274 [INFO] main: PHANTOM OS starting...';
    await vi.waitFor(() => expect(shown()).toMatch(/крок 2 з/), { timeout: 3000 });
    expect(shown()).toMatch(/піднімаю ядро/);
  });

  it('шум із журналу на скло не потрапляє ніколи', async () => {
    // Рівно той рядок, що обурив власника: смуга, яка НІЧОГО не зробила.
    // Вона не подія, і показувати її не можна — ні як прогрес, ні як шум.
    runSplash();
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__ =
      '[phantom] [INFO] lifespan_warmup: Chroma janitor: SQL deleted=0 kept=0; FS deleted=0 freed=0.0 MB';
    await vi.waitFor(() => expect(shown()).toMatch(/крок/), { timeout: 3000 });
    expect(shown()).not.toMatch(/janitor|deleted|Chroma|lifespan/i);
  });

  it('крок не стрибає назад', async () => {
    // Смуги йдуть паралельно, рядки приходять уперемішку. Крок, що
    // повертається назад, читається як поломка.
    runSplash();
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__ =
      'INFO: Application startup complete.';
    await vi.waitFor(() => expect(shown()).toMatch(/крок 5 з/), { timeout: 3000 });
    (window as unknown as Record<string, unknown>).__PHANTOM_BACKEND_LINE__ =
      '2026-09-12 20:36:50,274 [INFO] main: PHANTOM OS starting...';
    await new Promise((r) => setTimeout(r, 600));
    expect(shown()).toMatch(/крок 5 з/);
  });

  it('на склі заставки немає англійських слів', async () => {
    // 'online' було єдиним англійським словом на найпершому екрані
    // застосунку. Видно його мить — але мить теж на склі.
    runSplash();
    await vi.waitFor(() => expect(shown()).toMatch(/крок/), { timeout: 3000 });
    const latin = shown().match(/[A-Za-z]{2,}/g) ?? [];
    expect(latin, `англійське в «${shown()}»`).toEqual([]);
    // І в самих літералах теж — окрім рядка ПРИЧИНИ смерті, який приходить
    // від ядра і англійським бути може.
    const literals = [...SRC.matchAll(/text: '([^']+)'/g)].map((m) => m[1]);
    for (const line of literals) {
      expect(line.match(/[A-Za-z]{2,}/g) ?? [], `англійське в «${line}»`).toEqual([]);
    }
  });
});
