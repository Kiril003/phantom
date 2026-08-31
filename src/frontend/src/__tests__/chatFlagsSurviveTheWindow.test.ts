/**
 * Закріплено / тиша / архів переживають закриття вкладки.
 *
 * Виміряно 31.08.2026: жоден із трьох перемикачів не зберігав нічого, а
 * `loadChats` не викликався **взагалі** — ще одне написане й не покликане.
 * Тобто людина закріплювала розмову, закривала вікно, і закріплення зникало.
 * Це не «не синхронізовано між пристроями» — це не пережило власного вікна.
 *
 * Друга половина, менш очевидна: список розмов приходить із вузла й
 * перебудовується (`refreshConversations`). Прапорці мусять прикластись назад
 * за ідентифікатором, інакше вони зникали б при кожному оновленні списку, а не
 * лише при перезавантаженні — і виглядало б це випадковим.
 *
 * Межа сказана вголос і тут, і в коді: у вузла для цих полів немає стовпців
 * узагалі, тож закріплене на ПК на телефоні не з'явиться. Ми зберігаємо на
 * ЦЬОМУ пристрої й нічого більшого не обіцяємо.
 *
 * Ціль шпигуна — `globalThis.localStorage`, а НЕ `Storage.prototype`:
 * `test-setup.ts` підміняє глобальний об'єкт власним, тож шпигун на прототипі
 * не чіпляється взагалі й тест був би зелений і безглуздий. Ця пастка вже
 * коштувала цьому дому одного хибного «доказу».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { messengerApi } from '../services/messengerApi';

const KEY = 'phantom_chat_flags';

function seed() {
  useMessengerStore.setState({
    chats: [
      { id: 'conv_1', title: 'Марта', messages: [], type: 'dm' },
      { id: 'conv_2', title: 'Виїзд', messages: [], type: 'group' },
    ],
    activeChatId: 'conv_1',
  } as never);
  globalThis.localStorage.removeItem(KEY);
}

function saved(): Record<string, { pinned?: boolean; muted?: boolean; archived?: boolean }> {
  const raw = globalThis.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : {};
}

describe('прапорці розмов', () => {
  beforeEach(() => {
    seed();
    vi.restoreAllMocks();
  });

  it('закріплення лягає у сховище, а не лише в памʼять', () => {
    useMessengerStore.getState().togglePinChat('conv_1');

    expect(saved()['conv_1']?.pinned).toBe(true);
  });

  it('зняте закріплення теж зберігається — інакше воно «поверталось» би', () => {
    const store = useMessengerStore.getState();
    store.togglePinChat('conv_1');
    store.togglePinChat('conv_1');

    // Спершу доводимо, що запис узагалі БУВ: без цього рядка перевірка
    // зеленіла б і тоді, коли сховище не чіпають зовсім, — тобто саме в тому
    // стані, який вона мала б ловити.
    expect(globalThis.localStorage.getItem(KEY)).not.toBeNull();
    expect(saved()['conv_1']?.pinned ?? false).toBe(false);
  });

  it('тиша й архів ідуть тим самим шляхом', () => {
    const store = useMessengerStore.getState();
    store.toggleMuteChat('conv_1');
    store.toggleArchiveChat('conv_2');

    expect(saved()['conv_1']?.muted).toBe(true);
    expect(saved()['conv_2']?.archived).toBe(true);
  });

  it('розмова, що прийшла з вузла заново, повертається з прапорцем', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ conv_new: { pinned: true } }));
    useMessengerStore.setState({ chats: [], activeChatId: null } as never);

    vi.spyOn(messengerApi, 'listConversations').mockResolvedValue([
      { id: 'conv_new', title: 'Нова', kind: 'dm' },
    ] as never);

    await useMessengerStore.getState().refreshConversations();

    const chat = useMessengerStore
      .getState()
      .chats.find((c: { id: string }) => c.id === 'conv_new');
    // Без цього прапорці зникали б при КОЖНОМУ оновленні списку, не лише при
    // перезавантаженні — і людина вважала б це випадковістю.
    expect(chat?.pinned).toBe(true);
  });
});
