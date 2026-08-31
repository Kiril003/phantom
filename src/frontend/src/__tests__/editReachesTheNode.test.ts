/**
 * Правка доїжджає до вузла — і стрічка міняється лише після його відповіді.
 *
 * Що тут було. `editMessage` міняв текст просто у сторі й зберігав у локальне
 * сховище — а до вузла не йшло НІЧОГО. Співрозмовник назавжди лишався з
 * першою редакцією; друге вікно того самого вузла теж показувало старий
 * текст. При цьому `edited_at` існував у схемі з першої міграції і чесно
 * віддавався назовні — ставити його було нікому.
 *
 * Найтонша з перевірок тут — остання: коли вузол ВІДМОВИВ, стрічка мусить
 * лишитись зі СТАРИМ текстом. Спокуса показати новий («людина ж його
 * набрала») означала б розійтися з тим, що зараз бачить співрозмовник, і
 * людина була б певна, що виправила, тоді як не виправила.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { useUIStore } from '../stores/uiStore';
import { messengerApi } from '../services/messengerApi';

const LETTER = {
  id: 'msg_1',
  senderId: 'me',
  senderName: 'Кирило',
  text: 'зустріч о шостій',
  type: 'text',
  isSelf: true,
  timestamp: '18:00',
};

function seed() {
  useMessengerStore.setState({
    chats: [{ id: 'conv_1', title: 'Марта', messages: [{ ...LETTER }], type: 'dm' }],
    activeChatId: 'conv_1',
  } as never);
  useUIStore.setState({ toasts: [] } as never);
}

function textNow(): string | undefined {
  return useMessengerStore
    .getState()
    .chats.find((c: { id: string }) => c.id === 'conv_1')?.messages[0]?.text;
}

describe('правка листа', () => {
  beforeEach(() => {
    seed();
    vi.restoreAllMocks();
  });

  it('кличе вузол із розмовою, листом і новим текстом', async () => {
    const spy = vi
      .spyOn(messengerApi, 'editMessage')
      .mockResolvedValue({ id: 'row_1', body: 'зустріч о сьомій' } as never);

    await useMessengerStore.getState().editMessage('msg_1', 'зустріч о сьомій');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(0, 3)).toEqual(['conv_1', 'msg_1', 'зустріч о сьомій']);
    expect(textNow()).toBe('зустріч о сьомій');
  });

  it('до відповіді вузла у стрічці лишається старий текст', async () => {
    let release: (v: unknown) => void = () => {};
    vi.spyOn(messengerApi, 'editMessage').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    const inFlight = useMessengerStore.getState().editMessage('msg_1', 'зустріч о сьомій');
    await Promise.resolve();

    // Показати новий текст тут означало б показати власний намір замість
    // стану системи — те саме, за що ми ловили себе на склі.
    expect(textNow()).toBe('зустріч о шостій');

    release({ id: 'row_1', body: 'зустріч о сьомій' });
    await inFlight;
    expect(textNow()).toBe('зустріч о сьомій');
  });

  it('вузол відмовив — у стрічці СТАРИЙ текст і сказано про невдачу', async () => {
    vi.spyOn(messengerApi, 'editMessage').mockRejectedValue(new Error('вузол мовчить'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await useMessengerStore.getState().editMessage('msg_1', 'зустріч о сьомій');

    // Саме те, що зараз бачить співрозмовник. Інше зробило б людину певною,
    // що вона виправила, тоді як не виправила.
    expect(textNow()).toBe('зустріч о шостій');
    const toasts = useUIStore.getState().toasts ?? [];
    expect(toasts.some((t: { message?: string }) => /не збережено/i.test(t.message ?? ''))).toBe(
      true,
    );
  });

  it('порожня правка до вузла навіть не йде', async () => {
    const spy = vi.spyOn(messengerApi, 'editMessage');

    // Порожня правка стерла б лист, не лишивши надгробка: співрозмовник
    // побачив би, що текст зник, і не мав би способу зрозуміти чому.
    await useMessengerStore.getState().editMessage('msg_1', '   ');

    expect(spy).not.toHaveBeenCalled();
    expect(textNow()).toBe('зустріч о шостій');
  });
});
