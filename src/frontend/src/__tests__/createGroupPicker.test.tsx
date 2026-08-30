/**
 * Піклер справді годує виклик — учасники з вузла, а не зі стелі.
 *
 * Сторожі в `messengerGroupsWired` перевіряють сховище. Але між кнопкою і
 * сховищем є ще один поверх, і саме на таких поверхах тут двічі за два дні
 * знаходився готовий код, до якого ніхто не доходив. Тому цей сторож іде
 * від НАТИСКАННЯ: відкрити, дочекатись контактів, обрати людину, надіслати —
 * і подивитись, що дійшло до `createGroup`.
 *
 * Окремо перевіряється те, заради чого піклер і робився: у списку видно НЕ
 * «в мережі», а чи є ключ. Учасник без ключа на бекенді потрапляє в
 * `skipped` — кадр йому не вигадують. Досі це мовчало: людину додавали, вона
 * нічого не отримувала, і ніде це не було написано.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { CreateChatModal } from '../components/messenger/CreateChatModal';
import { messengerApi } from '../services/messengerApi';
import { useMessengerStore } from '../stores/messengerStore';

const CONTACTS = [
  { id: 'ct_marta', display_name: 'Марта', session_ready: true, verified: true },
  { id: 'ct_oleh', display_name: 'Олег', session_ready: false, verified: false },
];

const openModal = () =>
  render(
    <CreateChatModal isOpen onClose={() => {}} onConversationReady={() => {}} />,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(messengerApi, 'listContacts').mockResolvedValue(CONTACTS as never);
  vi.spyOn(messengerApi, 'listDirectoryUsers').mockResolvedValue([] as never);
});

describe('вибір учасників групи', () => {
  it('обрана людина доїжджає до createGroup своїм справжнім id', async () => {
    const createGroup = vi
      .spyOn(useMessengerStore.getState(), 'createGroup')
      .mockResolvedValue('chat_new' as never);

    openModal();
    await screen.findByText('Марта');

    fireEvent.change(screen.getByPlaceholderText(/Розробка Work OS/), {
      target: { value: 'Виїзд' },
    });
    fireEvent.click(screen.getByText('Марта'));
    fireEvent.click(screen.getByTestId('create-group-submit'));

    await waitFor(() => expect(createGroup).toHaveBeenCalled());
    expect(createGroup.mock.calls[0][0]).toBe('Виїзд');
    expect(createGroup.mock.calls[0][1]).toEqual(['ct_marta']);
  });

  it('поки нікого не обрано — надіслати не можна', async () => {
    openModal();
    await screen.findByText('Марта');

    fireEvent.change(screen.getByPlaceholderText(/Розробка Work OS/), {
      target: { value: 'Порожня' },
    });
    // Назва є, людей немає: групу з нуля учасників вузол не збере, і
    // пропонувати це — означало б відправляти людину в глухий кут.
    expect(screen.getByTestId('create-group-submit')).toBeDisabled();
  });

  it('видно наявність ключа, а не вигадану присутність', async () => {
    openModal();
    await screen.findByText('Марта');

    expect(screen.getByText(/ключ звірено/)).toBeTruthy();
    expect(screen.getByText(/лист їй не поїде/)).toBeTruthy();
    expect(screen.queryByText(/в мережі/i)).toBeNull();
  });

  it('вузол не відповів — чесний стан, а не троє з голови', async () => {
    vi.spyOn(messengerApi, 'listContacts').mockRejectedValue(new Error('вузол мовчить'));
    openModal();

    await screen.findByText(/Вузол не відповів на запит контактів/);
    expect(screen.queryByText('DevOps Node')).toBeNull();
    expect(screen.queryByText('PHANTOM Copilot')).toBeNull();
  });
});
