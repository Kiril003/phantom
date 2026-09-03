/**
 * Конспект наради не вигадують.
 *
 * `ChatDigestModal` просить модель скласти Smart Digest переписки. Коли
 * відповідь була порожня або запит падав, він підставляв ГОТОВИЙ текст:
 * три «ухвалені рішення» і три доручення на імена Кирило / Саня / Марина.
 * Тобто вигадка з'являлась рівно тоді, коли знати не було чого.
 *
 * Ціна була не в самому кадрі. Той текст лягав у `digest`, а від `digest`
 * вмикається кнопка «Експортувати в Canvas» — вона публікує конспект **у сам
 * чат** карткою з підписом автора, назвою простору й датою. Копіювання
 * віддавало те саме як markdown-документ. Вигаданий протокол наради,
 * підписаний реальними людьми, ходив би далі як справжній.
 *
 * Сторож тримає межу: відмова має бути ВИДНО, а обидва виходи назовні —
 * закриті, поки конспекту насправді немає.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const sendMessage = vi.fn();

vi.mock('../services/api', () => ({
  chatApi: { sendMessage: (...a: unknown[]) => sendMessage(...a) },
}));
vi.mock('../utils/messengerSound', () => ({
  soundFx: { playTap: () => {}, playSend: () => {} },
}));

const CHAT = {
  id: 'chat_1',
  title: 'Робоча група',
  circle: 'work',
  messages: [
    { id: 'm1', text: 'Зустрічаємось у четвер о 18:00', senderName: 'Оксана' },
    { id: 'm2', text: 'Добре, підготую цифри', senderName: 'Тарас' },
  ],
} as never;

// Імена, яких у переписці немає і бути не може.
const INVENTED = ['Кирило', 'Саня', 'Марина', 'Work OS', 'Mesh Huddles', 'Webhook-хабів'];

async function openDigest() {
  const { ChatDigestModal } = await import('../components/messenger/ChatDigestModal');
  return render(<ChatDigestModal isOpen onClose={() => {}} chat={CHAT} />);
}

beforeEach(() => {
  sendMessage.mockReset();
  vi.resetModules();
});

describe('конспект не вигадує протокол', () => {
  it('порожня відповідь моделі не стає готовим конспектом', async () => {
    sendMessage.mockResolvedValue({ message: { content: '   ' } });
    const { container } = await openDigest();

    await waitFor(() => expect(container.textContent).toContain('Конспекту немає'));
    for (const name of INVENTED) {
      expect(container.textContent).not.toContain(name);
    }
  });

  it('падіння запиту показує причину, а не вигадку', async () => {
    sendMessage.mockRejectedValue(new Error('ядро не відповіло'));
    const { container } = await openDigest();

    await waitFor(() => expect(container.textContent).toContain('ядро не відповіло'));
    for (const name of INVENTED) {
      expect(container.textContent).not.toContain(name);
    }
  });

  it('без конспекту обидва виходи назовні закриті', async () => {
    sendMessage.mockResolvedValue({ message: { content: '' } });
    await openDigest();

    await waitFor(() => expect(screen.getByText('Конспекту немає')).toBeTruthy());
    // Публікація в чат і копіювання markdown — це і є шляхи, якими вигадка
    // виходила за межі модалки. Обидва мусять бути недоступні.
    const publish = screen.getByRole('button', { name: /Canvas/ }) as HTMLButtonElement;
    const copy = screen.getByRole('button', { name: /Копіювати MD/ }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(copy.disabled).toBe(true);
  });

  it('справжню відповідь показує як є', async () => {
    sendMessage.mockResolvedValue({
      message: { content: '### 🎯 Ухвалені рішення\n- Зустріч у четвер о 18:00' },
    });
    const { container } = await openDigest();

    await waitFor(() => expect(container.textContent).toContain('Зустріч у четвер'));
    expect(container.textContent).not.toContain('Конспекту немає');
    const publish = screen.getByRole('button', { name: /Canvas/ }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
  });
});
