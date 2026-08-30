/**
 * Голосове не вдає надіслане, і хвиля не вигадується.
 *
 * Дві окремі неправди жили в одному виклику `sendVoiceMessage`.
 *
 * 1. ХВИЛЯ. Малювалась із `Math.random()` — 32 стовпчики, однаково жваві для
 *    крику і для тиші, ще й НОВІ при кожному записі того самого голосу.
 *    А справжній RMS мікрофона в дереві вже рахувався (useVoiceRecorder,
 *    для пульсації сфери) — його просто викидали. Тепер композер збирає ті
 *    самі виміри, і сюди приходить форма, знята з голосу.
 *
 * 2. ДОСТАВКА. `voice` немає в `WIRE_KINDS` (messenger/blobs.py:111), а
 *    вебсокетне `chat:send_message`, куди йшов цей шлях, не приймає ніхто:
 *    grep по всьому бекенду дає нуль збігів. Тобто запис лишався на вузлі —
 *    і малювався БЕЗ ЖОДНОГО значка, бо значок вимагає `msg.status`, а
 *    статусу не ставили. Від доставленого воно не відрізнялось нічим.
 *
 * Обидва сторожі тут навмисно грубі: вони червоніють від самої появи
 * випадковості й від мовчазного статусу, не вникаючи в решту шляху.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';

const reset = () =>
  useMessengerStore.setState({
    chats: [
      {
        id: 'c_voice',
        title: 'Тест',
        avatar: '',
        type: 'dm',
        circle: 'work',
        unreadCount: 0,
        messages: [],
      },
    ],
    activeChatId: 'c_voice',
  } as never);

const lastVoice = () => {
  const msgs = useMessengerStore.getState().getActiveChat()?.messages ?? [];
  return msgs[msgs.length - 1];
};

describe('голосове каже правду про себе', () => {
  beforeEach(reset);

  it('хвиля береться з виміряних піків, а не вигадується', () => {
    const measured = [0.1, 0.9, 0.4, 0.05];
    useMessengerStore.getState().sendVoiceMessage(3, 'запис', undefined, measured);

    expect(lastVoice().voiceData?.waveform).toEqual(measured);
  });

  it('той самий голос двічі дає ту саму хвилю', () => {
    // Саме це відрізняє вимір від `Math.random()`: випадковість не
    // повторюється, а виміряна форма — повторюється.
    const measured = [0.2, 0.7, 0.3];
    useMessengerStore.getState().sendVoiceMessage(2, 'раз', undefined, measured);
    const first = lastVoice().voiceData?.waveform;
    useMessengerStore.getState().sendVoiceMessage(2, 'два', undefined, measured);

    expect(lastVoice().voiceData?.waveform).toEqual(first);
  });

  it('без мікрофона хвилі немає — жодного стовпчика не домальовується', () => {
    useMessengerStore.getState().sendVoiceMessage(3, 'без мікрофона');

    expect(lastVoice().voiceData?.waveform).toEqual([]);
  });

  it('запис аудіо доїжджає до повідомлення, а не губиться дорогою', () => {
    // Композер віддавав `audioUrl` четвертим аргументом, а сховище приймало
    // лише два — програвати було нічого.
    useMessengerStore.getState().sendVoiceMessage(4, 'з аудіо', 'blob:abc', [0.5]);

    expect(lastVoice().voiceData?.audioUrl).toBe('blob:abc');
  });

  it('голосове має ЯВНИЙ стан — мовчазне повідомлення читається як доставлене', () => {
    useMessengerStore.getState().sendVoiceMessage(3, 'запис', undefined, [0.5]);

    // Не «не failed», а саме «стан узагалі є»: рендерер малює значок лише
    // при `msg.status`, тож відсутність статусу — це і є стара неправда.
    expect(lastVoice().status).toBeDefined();
    expect(lastVoice().status).toBe('failed');
  });
});
