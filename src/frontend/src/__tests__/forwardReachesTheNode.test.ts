/**
 * Пересилання доїжджає до вузла — і не хвалиться раніше за нього.
 *
 * Що тут було. `forwardMessage` будував рядок просто у сторі, грав звук
 * відправки й показував тост «Переслано в «X»» — а до вузла не йшло НІЧОГО.
 * Лист жив до першого перезавантаження, після якого зникав безслідно. Тобто
 * людині казали, що доїхало, у момент, коли воно навіть не виїжджало.
 *
 * Підпис у типі й був діагнозом: `deleteMessage` оголошено як
 * `Promise<void>` і воно справді ходить до вузла, а `forwardMessage` і
 * `editMessage` — `void`. Синхронна дія над листом у месенджері майже
 * завжди означає, що джерелом обрано стор.
 *
 * Тому сторож дивиться не на вигляд бульбашки, а на три речі про виклик:
 * що виклик до вузла ВІДБУВСЯ, що він пішов у ЦІЛЬОВУ розмову, і що тост
 * успіху з'являється лише ПІСЛЯ відповіді. Остання й найтонша: саме вона
 * ловить повернення до «показати успіх одразу».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { useUIStore } from '../stores/uiStore';
import { messengerApi } from '../services/messengerApi';

const CHATS = [
  { id: 'conv_from', title: 'Марта', messages: [], type: 'dm' },
  { id: 'conv_to', title: 'Виїзд', messages: [], type: 'group' },
];

function seed() {
  useMessengerStore.setState({
    chats: JSON.parse(JSON.stringify(CHATS)),
    activeChatId: 'conv_from',
  } as never);
}

const LETTER = {
  id: 'msg_1',
  senderId: 'peer',
  senderName: 'Марта',
  text: 'зустріч о шостій',
  type: 'text',
  isSelf: false,
  timestamp: '18:00',
} as never;

describe('пересилання', () => {
  beforeEach(() => {
    seed();
    useUIStore.setState({ toasts: [] } as never);
    vi.restoreAllMocks();
  });

  it('кличе вузол і саме в цільову розмову', async () => {
    const spy = vi
      .spyOn(messengerApi, 'appendMessage')
      .mockResolvedValue({ id: 'row_1', delivery_state: 'sent' } as never);

    await useMessengerStore.getState().forwardMessage(LETTER, 'conv_to');

    expect(spy).toHaveBeenCalledTimes(1);
    // Перший аргумент — розмова, КУДИ пересилаємо, а не та, де ми стоїмо.
    expect(spy.mock.calls[0][0]).toBe('conv_to');
    expect((spy.mock.calls[0][1] as { body: string }).body).toBe('зустріч о шостій');
  });

  it('тост успіху приходить ПІСЛЯ відповіді вузла, а не разом із дією', async () => {
    let release: (v: unknown) => void = () => {};
    vi.spyOn(messengerApi, 'appendMessage').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    const inFlight = useMessengerStore.getState().forwardMessage(LETTER, 'conv_to');
    await Promise.resolve();

    // Вузол ще мовчить. Саме тут стара версія вже казала «Переслано».
    const during = useUIStore.getState().toasts ?? [];
    expect(during.some((t: { message?: string }) => /Переслано/.test(t.message ?? ''))).toBe(false);

    release({ id: 'row_1', delivery_state: 'sent' });
    await inFlight;

    const after = useUIStore.getState().toasts ?? [];
    expect(after.some((t: { message?: string }) => /Переслано/.test(t.message ?? ''))).toBe(true);
  });

  it('коли вузол відмовив — лист позначено як невдалий, а не як переслане', async () => {
    vi.spyOn(messengerApi, 'appendMessage').mockRejectedValue(new Error('вузол мовчить'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await useMessengerStore.getState().forwardMessage(LETTER, 'conv_to');

    const target = useMessengerStore
      .getState()
      .chats.find((c: { id: string }) => c.id === 'conv_to');
    expect(target?.messages).toHaveLength(1);
    expect(target?.messages[0].status).toBe('failed');

    const toasts = useUIStore.getState().toasts ?? [];
    expect(toasts.some((t: { message?: string }) => /Не переслалось/.test(t.message ?? ''))).toBe(
      true,
    );
    expect(toasts.some((t: { message?: string }) => /^Переслано/.test(t.message ?? ''))).toBe(false);
  });

  it('те, що ми не вміємо перевезти, названо прямо — а не скопійовано у стрічку', async () => {
    const spy = vi.spyOn(messengerApi, 'appendMessage');

    // Файл довелося б покласти в сховок наново; вузол цього не робить.
    // Копія у сторі виглядала б як успіх і зникла б при перезавантаженні.
    await useMessengerStore
      .getState()
      .forwardMessage({ ...LETTER, type: 'file', text: '' } as never, 'conv_to');

    expect(spy).not.toHaveBeenCalled();
    const target = useMessengerStore
      .getState()
      .chats.find((c: { id: string }) => c.id === 'conv_to');
    expect(target?.messages).toHaveLength(0);

    const toasts = useUIStore.getState().toasts ?? [];
    expect(toasts.some((t: { message?: string }) => /лише текст/.test(t.message ?? ''))).toBe(true);
  });
});
