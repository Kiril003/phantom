/**
 * Розумні теки переживають закриття вікна.
 *
 * Виміряно 31.08.2026: жодна з п'яти дій над теками не зберігала нічого —
 * `createFolder`, `updateFolder`, `deleteFolder`, `addChatToFolder`,
 * `removeChatFromFolder` міняли лише памʼять вкладки, а стор щоразу починався
 * з `defaultFolders`.
 *
 * Найгіршою була не втрата, а **розбіжність**: створена тека зникала, а
 * ВИДАЛЕНА поверталась — бо після перезавантаження знову підставлявся
 * початковий набір. Дві протилежні несподіванки з однієї причини, і жодну з
 * них людина не могла пояснити.
 *
 * Межа сказана вголос: теки — стан ЦЬОГО пристрою. У вузла для них немає ані
 * таблиці, ані маршруту, тож розкладене на ПК на телефоні не з'явиться, і
 * обіцяти цього ми не будемо.
 *
 * Шпигун цілиться в `globalThis.localStorage`, а не в `Storage.prototype`:
 * `test-setup.ts` підміняє глобальний обʼєкт, і на прототипі шпигун не
 * чіпляється взагалі — тест був би зелений і безглуздий.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { storagePersistence } from '../services/storagePersistence';

const KEY = 'phantom_smart_folders';

function saved(): Array<{ id: string; name?: string; chatIds?: string[] }> {
  const raw = globalThis.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

describe('розумні теки', () => {
  beforeEach(() => {
    globalThis.localStorage.removeItem(KEY);
    useMessengerStore.setState({
      smartFolders: [{ id: 'f_old', name: 'Стара', emoji: '📁', color: '#E87A42', chatIds: [] }],
      activeFolderId: null,
    } as never);
    vi.restoreAllMocks();
  });

  it('створена тека лягає у сховище', () => {
    useMessengerStore.getState().createFolder({ name: 'Виїзд' });

    expect(saved().some((f) => f.name === 'Виїзд')).toBe(true);
  });

  it('видалена тека лишається видаленою — а не воскресає', () => {
    useMessengerStore.getState().deleteFolder('f_old');

    // Спершу доводимо, що запис БУВ: інакше перевірка зеленіла б і тоді, коли
    // сховище не чіпають зовсім, тобто саме в стані, який вона має ловити.
    expect(globalThis.localStorage.getItem(KEY)).not.toBeNull();
    expect(saved().some((f) => f.id === 'f_old')).toBe(false);
  });

  it('розмова, покладена в теку, там і лишається', () => {
    useMessengerStore.getState().addChatToFolder('f_old', 'conv_1');

    expect(saved().find((f) => f.id === 'f_old')?.chatIds).toContain('conv_1');
  });

  it('вийнята розмова зникає зі сховища, а не лише з екрана', () => {
    const store = useMessengerStore.getState();
    store.addChatToFolder('f_old', 'conv_1');
    store.removeChatFromFolder('f_old', 'conv_1');

    expect(saved().find((f) => f.id === 'f_old')?.chatIds ?? []).not.toContain('conv_1');
  });

  it('порожній перелік — це «я видалив усі», а не «немає збереженого»', () => {
    // `?? defaultFolders`, а не `||`: інакше видалення ОСТАННЬОЇ теки
    // підставляло б початковий набір, тобто воскрешало б усе видалене
    // рівно тоді, коли людина найбільше хотіла чистоти.
    globalThis.localStorage.setItem(KEY, JSON.stringify([]));

    expect(storagePersistence.loadSmartFolders()).toEqual([]);
    expect(storagePersistence.loadSmartFolders()).not.toBeNull();
  });
});
