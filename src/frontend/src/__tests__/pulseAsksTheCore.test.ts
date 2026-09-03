/**
 * Пульс мусить СПИТАТИ ядро, а не вигадати відмову.
 *
 * 03.09.2026 на склі: власник із роллю ROOT читав у трьох чарунках
 * Кокпіта «потрібні operator-права» / «відповідає лише ROOT», а в лозі
 * бекенда за п'ять хвилин не було ЖОДНОГО запиту до /api/v1/cockpit/*
 * чи /api/v1/pair/devices. Причина: токен переїхав у sessionStorage
 * (services/tokenStore), а `cockpitApi`/`organismApi` лишились із власним
 * читачем `localStorage.phantom_token` — тобто завжди бачили порожньо й
 * коротили в «немає доступу» ще до fetch.
 *
 * Скриня цього не бачила ніколи: `cockpit.test.tsx` мокає весь модуль
 * `services/cockpitApi`, тож шлях токена в ній не виконується.
 *
 * Тому сторож нижче тримає саме ДОСЯЖНІСТЬ ядра, не правильність даних:
 * є токен там, куди його кладе застосунок → fetch відбувся й ніс
 * Authorization; токена немає → мовчимо без мережі.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeToken, clearToken } from '../services/tokenStore';
import { fetchPairedDevices, fetchMachine } from '../services/cockpitApi';
import { fetchLinuxResources } from '../services/organismApi';

const TOKEN = 'test.token.value';

function stubFetch(status = 200, body: unknown = []) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('пульс питає ядро', () => {
  beforeEach(() => {
    clearToken();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it('із токеном застосунку — запит іде і несе Authorization', async () => {
    writeToken(TOKEN);
    const spy = stubFetch(200, []);

    const pulse = await fetchPairedDevices();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/v1/pair/devices');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(pulse.ok).toBe(true);
  });

  it('кокпіт і стрічка ресурсів беруть токен з того самого місця', async () => {
    writeToken(TOKEN);
    const spy = stubFetch(200, {});

    await fetchMachine();
    await fetchLinuxResources();

    expect(spy).toHaveBeenCalledTimes(2);
    for (const [, init] of spy.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('старий токен з диска працює, але на диску не лишається', async () => {
    // Спадок: власник, що ввійшов до переїзду токена в sessionStorage, не
    // має бути викинутий оновленням (tokenStore.migrateOnce). Тобто запит
    // іде — але після нього диск мусить бути чистий, інакше сенс переїзду
    // зникає.
    localStorage.setItem('phantom_token', TOKEN);
    const spy = stubFetch(200, []);

    const pulse = await fetchPairedDevices();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(pulse.ok).toBe(true);
    expect(localStorage.getItem('phantom_token')).toBeNull();
    expect(sessionStorage.getItem('phantom_token')).toBe(TOKEN);
  });

  it('без токена — мовчимо, мережу не чіпаємо', async () => {
    const spy = stubFetch(200, []);

    const pulse = await fetchPairedDevices();

    expect(spy).not.toHaveBeenCalled();
    expect(pulse.ok).toBe(false);
    if (!pulse.ok) expect(pulse.reason).toBe('unauthorized');
  });
});
