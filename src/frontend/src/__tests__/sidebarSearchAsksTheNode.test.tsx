/**
 * Пошук питає вузол, а не лише останній рядок.
 *
 * Плейсхолдер обіцяє «Пошук людей, тем, **повідомлень**…». А фільтр списку
 * чатів звіряється з полями САМОГО чату: заголовок, `lastSnippet` (останнє
 * повідомлення), автор останнього, опис. Повідомлення в глибині історії він
 * не бачить у принципі — у вкладці їх немає, вони лежать запечатані на вузлі,
 * і ключі at-rest є лише у вузла.
 *
 * Виміряно на склі до правки: «№5» (останній рядок) знаходився, «№2» і «№9»
 * із тих самих розмов — нуль. Людина робила висновок, що листа не існує.
 *
 * Тому сторож перевіряє три речі, і всі — про чесність, а не про вигляд:
 * що запит іде НА ВУЗОЛ; що обрізання видно; що відмова вузла не видається
 * за «нічого не знайдено».
 */
import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from '../components/messenger/Sidebar';
import { messengerApi } from '../services/messengerApi';

const chat = {
  id: 'c1',
  title: 'Довга гілка',
  avatar: '',
  type: 'dm',
  circle: 'work',
  unreadCount: 0,
  messages: [],
  lastSnippet: 'рядок №17',
};

/** Панель бере `smartFolders[0]` як поточну теку — з порожнім переліком
 *  вона падає ще до пошуку. */
const folder = { id: 'f_all', name: 'Усі', emoji: '📥', chatIds: ['c1'], isBuiltIn: true };

const props = {
  chats: [chat],
  activeChatId: 'c1',
  onSelectChat: () => {},
  currentUser: { id: 'me', name: 'Я', avatar: '', activePersonaSphere: 'work' },
  smartFolders: [folder],
  activeFolderId: 'f_all',
  onSelectFolder: () => {},
  onOpenEditFolder: () => {},
} as unknown as React.ComponentProps<typeof Sidebar>;

const typeQuery = async (q: string) => {
  const box = screen.getByPlaceholderText(/Пошук людей/);
  fireEvent.change(box, { target: { value: q } });
  // Запит іде з паузою в 250 мс — кожна літера коштувала б вузлу обходу з
  // розпечатуванням тіл. Чекаємо справжнім часом: фальшиві таймери тут
  // конфліктують із `waitFor`/`findBy`, і тест висить замість того, щоб
  // упасти зрозуміло.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
};

afterEach(() => vi.restoreAllMocks());

describe('пошук у бічній панелі', () => {
  it('питає вузол саме тим словом, яке ввели', async () => {
    const spy = vi
      .spyOn(messengerApi, 'searchMessages')
      .mockResolvedValue({ hits: [], scanned: 12, truncated: false } as never);

    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );
    await typeQuery('№9');

    // Доводимо, що шпигун СПРАЦЮВАВ: інакше зелене нічого не варте.
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toBe('№9');
  });

  it('показує влучання, яких у списку чатів немає', async () => {
    vi.spyOn(messengerApi, 'searchMessages').mockResolvedValue({
      hits: [
        {
          message_id: 'm9',
          conversation_id: 'c1',
          conversation_title: 'Довга гілка',
          seq: 9,
          author_name: 'Олена',
          kind: 'text',
          snippet: 'Довга гілка, рядок №9',
          sent_at: '2026-08-29T19:59:00',
        },
      ],
      scanned: 25,
      truncated: false,
    } as never);

    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );
    await typeQuery('№9');

    // `lastSnippet` чату — «рядок №17», тож старий фільтр дав би нуль.
    await screen.findByText('Довга гілка, рядок №9');
  });

  it('обрізання історії видно, а не мовчить', async () => {
    vi.spyOn(messengerApi, 'searchMessages').mockResolvedValue({
      hits: [],
      scanned: 5000,
      truncated: true,
    } as never);

    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );
    await typeQuery('щось');

    // Мовчазна стеля читається як «такого немає» — рівно та неправда,
    // проти якої цей маршрут і робився.
    await screen.findByText(/глибші листи не перевірялись/);
  });

  it('відмова вузла не видається за «нічого не знайдено»', async () => {
    vi.spyOn(messengerApi, 'searchMessages').mockRejectedValue(new Error('вузол мовчить'));

    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );
    await typeQuery('будь-що');

    await screen.findByText(/Вузол не відповів на пошук/);
  });

  it('одна літера вузол не турбує', async () => {
    const spy = vi
      .spyOn(messengerApi, 'searchMessages')
      .mockResolvedValue({ hits: [], scanned: 0, truncated: false } as never);

    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );
    await typeQuery('№');

    expect(spy).not.toHaveBeenCalled();
  });
});
