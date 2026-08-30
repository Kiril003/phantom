/**
 * Група справді кличе вузол — і бере людей, а не вигадує їх.
 *
 * `messenger/groups.py` — 801 рядок робочого коду з HTTP-тестами: віяр
 * робить ОКРЕМИЙ шифрований кадр на кожного учасника його попарною сесією,
 * без ключа кадр не вигадує (кладе в `skipped`), офлайновому дістається
 * рядок черги. Два дні цього не викликав НІХТО.
 *
 * Фронт натомість кликав `createConversation({kind:'group'})` — маршрут,
 * який НІКОЛИ не ставить `group_id`, тож умова віяра (routes_messenger.py)
 * не спрацьовувала жодного разу. А склад групи вигадувався просто в
 * інтерфейсі: «Олександр (Lead)», «DevOps Node», «PHANTOM Copilot».
 *
 * Тому сторож перевіряє дві речі, і обидві — про виклик, а не про вигляд:
 * що йде саме POST /messenger/groups, і що учасники приходять із відповіді
 * вузла. Пошук «чого бракує» тут нічого не давав: код був на місці.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { messengerApi } from '../services/messengerApi';

describe('групи під єднані до вузла', () => {
  beforeEach(() => {
    useMessengerStore.setState({ chats: [], activeChatId: null } as never);
    vi.restoreAllMocks();
  });

  it('створення групи йде маршрутом груп із обраними контактами', async () => {
    const spy = vi.spyOn(messengerApi, 'createGroup').mockResolvedValue({
      conversation_id: 'conv_1',
      group_id: 'g_1',
      title: 'Виїзд',
      members: [],
    } as never);

    await useMessengerStore.getState().createGroup('Виїзд', ['ct_marta', 'ct_oleh']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('Виїзд');
    expect(spy.mock.calls[0][1]).toEqual(['ct_marta', 'ct_oleh']);
  });

  it('склад групи береться з відповіді вузла, а не зі стелі', async () => {
    vi.spyOn(messengerApi, 'createGroup').mockResolvedValue({
      conversation_id: 'conv_2',
      group_id: 'g_2',
      title: 'Ланка',
      members: [
        { node_id: 'n_marta', display_name: 'Марта', session_ready: true, verified: true },
        { node_id: 'n_oleh', display_name: 'Олег', session_ready: false, verified: false },
      ],
    } as never);

    await useMessengerStore.getState().createGroup('Ланка', ['ct_marta', 'ct_oleh']);

    const chat = useMessengerStore.getState().chats.find((c) => c.title === 'Ланка');
    const names = (chat?.members ?? []).map((m) => m.name);
    expect(names).toEqual(['Марта', 'Олег']);
    // Жодного вигаданого: рівно стільки, скільки назвав вузол.
    expect(names).not.toContain('DevOps Node');
    expect(names).not.toContain('PHANTOM Copilot');
  });

  it('нікого не показуємо «в мережі» — вузол про це не знає', async () => {
    vi.spyOn(messengerApi, 'createGroup').mockResolvedValue({
      conversation_id: 'conv_3',
      group_id: 'g_3',
      title: 'Тиша',
      members: [
        { node_id: 'n_1', display_name: 'Хтось', session_ready: true, verified: false },
      ],
    } as never);

    await useMessengerStore.getState().createGroup('Тиша', ['ct_1']);

    const chat = useMessengerStore.getState().chats.find((c) => c.title === 'Тиша');
    expect((chat?.members ?? []).every((m) => m.isOnline === false)).toBe(true);
  });
});
