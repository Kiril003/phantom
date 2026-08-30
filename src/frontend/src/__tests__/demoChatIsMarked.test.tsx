/**
 * Показова розмова позначена там, де на неї дивиться людина.
 *
 * `is_demo` існував наскрізно й бездоганно: колонка в базі, міграція
 * `b8d31f0a72c5`, поле у схемі `ConversationIn`/`ConversationOut`, значення у
 * відповіді вузла, `isDemo` у сторі. Не було рівно однієї ланки — **малювання
 * в месенджері**. У списку, стрічці й шапці про прапорець нуль згадок; читав
 * його лише екран прибирання в налаштуваннях.
 *
 * На живому вузлі це були 2 показові розмови з 4, і від справжніх вони не
 * відрізнялись нічим: та сама верстка, ті самі значки, «E2EE» на вигаданій
 * стрічці. Людина не мала жодного способу дізнатись, що листування, яке вона
 * читає, склали ми.
 *
 * Це той самий клас, що «написане й не викликане», лише про дані: позначку
 * несли всі шари, крім останнього.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from '../components/messenger/Sidebar';

const folder = { id: 'f_all', name: 'Усі', emoji: '📥', chatIds: ['c_demo', 'c_real'], isBuiltIn: true };

const chat = (id: string, title: string, isDemo: boolean) => ({
  id,
  title,
  avatar: '',
  type: 'dm',
  circle: 'work',
  unreadCount: 0,
  messages: [],
  isDemo,
});

const props = {
  chats: [chat('c_demo', 'Вигадана гілка', true), chat('c_real', 'Справжня розмова', false)],
  activeChatId: 'c_real',
  onSelectChat: () => {},
  currentUser: { id: 'me', name: 'Я', avatar: '', activePersonaSphere: 'work' },
  smartFolders: [folder],
  activeFolderId: 'f_all',
  onSelectFolder: () => {},
  onOpenEditFolder: () => {},
} as unknown as React.ComponentProps<typeof Sidebar>;

describe('вітрина не вдає справжню розмову', () => {
  it('показова розмова несе позначку', () => {
    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId('demo-badge')).toHaveLength(1);
  });

  it('справжня розмова позначки НЕ несе', () => {
    render(
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>,
    );

    // Інакше сторож був би задоволений і від позначки на всьому підряд —
    // а це знецінює її рівно так само, як її відсутність.
    const badge = screen.getByTestId('demo-badge');
    const row = badge.closest('[class*="group"]');
    expect(row?.textContent).toContain('Вигадана гілка');
    expect(row?.textContent).not.toContain('Справжня розмова');
  });
});
