/**
 * Написане не зникає.
 *
 * Це та властивість, за якою месенджер відрізняється від іграшки. 29.08.2026
 * вона не виконувалась двічі, і по-різному:
 *
 *  1. Сервер відмовляв — інтерфейс ставив галочку «надіслано». Брехня про дію
 *     користувача: людина бачила галочку, йшла, і листа не існувало.
 *     (Виправлено окремо: три шляхи з чотирьох ставили `sent` у `catch`.)
 *  2. Після того як стан став чесним («не пішло»), лишалась друга частина:
 *     сам лист жив лише в пам'яті вкладки. Перезапуск — і написаного немає
 *     взагалі. Це вже не брехня, але це втрата.
 *
 * Тут перевіряється друга частина: лист, якого вузол не взяв, лягає у
 * скриньку вихідних, переживає перезапуск і повертається на своє місце —
 * рівно один раз.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { restoreOutboxInto } from '../stores/messengerStore';
import type { OutboxEntry } from '../services/storagePersistence';
import type { Chat, Message } from '../types/messenger';

const msg = (id: string, text: string): Message =>
  ({
    id,
    senderId: 'me',
    senderName: 'Я',
    timestamp: '21:56',
    type: 'text',
    text,
    status: 'failed',
  }) as Message;

const chat = (id: string, messages: Message[]): Chat =>
  ({ id, title: id, messages }) as unknown as Chat;

const entry = (id: string, chatId: string, text: string): OutboxEntry => ({
  id,
  chatId,
  message: msg(id, text),
  savedAt: Date.now(),
  attempts: 1,
});

describe('скринька вихідних повертає написане', () => {
  it('лист, якого вузол не взяв, повертається у свій чат', () => {
    const chats = [chat('c1', []), chat('c2', [])];
    const restored = restoreOutboxInto(chats, [entry('m1', 'c1', 'не пішло, але лишилось')]);

    expect(restored[0].messages).toHaveLength(1);
    expect(restored[0].messages[0].text).toBe('не пішло, але лишилось');
    expect(restored[1].messages).toHaveLength(0);
  });

  it('повертається саме зі станом «не пішло», а не як звичайний', () => {
    const restored = restoreOutboxInto([chat('c1', [])], [entry('m1', 'c1', 'текст')]);
    expect(restored[0].messages[0].status).toBe('failed');
  });

  it('не роздвоюється, якщо історія з вузла вже принесла цей лист', () => {
    // Найпідступніший випадок: вузол таки взяв лист (нашу відмову спричинив
    // обрив ПІСЛЯ запису), історія підвантажилась — і скринька додала б копію.
    const chats = [chat('c1', [msg('m1', 'той самий лист')])];
    const restored = restoreOutboxInto(chats, [entry('m1', 'c1', 'той самий лист')]);
    expect(restored[0].messages).toHaveLength(1);
  });

  it('порожня скринька не чіпає чатів взагалі', () => {
    const chats = [chat('c1', [msg('a', 'було')])];
    expect(restoreOutboxInto(chats, [])).toBe(chats);
  });

  it('лист для чату, якого немає, нікуди не вставляється', () => {
    const chats = [chat('c1', [])];
    const restored = restoreOutboxInto(chats, [entry('m9', 'зниклий-чат', 'сирота')]);
    expect(restored[0].messages).toHaveLength(0);
  });
});

describe('скринька переживає перезапуск', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('збережене читається так, як його прочитала б свіжа вкладка', async () => {
    const { storagePersistence } = await import('../services/storagePersistence');

    await storagePersistence.saveOutbox(entry('m1', 'c1', 'переживе'));
    // Саме синхронне читання: перший кадр після запуску має вже знати про
    // чергу, а не дізнатись за мить, коли відкриється IndexedDB.
    const seen = storagePersistence.loadOutboxSync();

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe('m1');
    expect(seen[0].message.text).toBe('переживе');
  });

  it('доїхавши, лист зі скриньки зникає', async () => {
    const { storagePersistence } = await import('../services/storagePersistence');

    await storagePersistence.saveOutbox(entry('m1', 'c1', 'доїде'));
    await storagePersistence.dropOutbox('m1');

    expect(storagePersistence.loadOutboxSync()).toHaveLength(0);
  });

  it('повторне збереження того самого листа не множить його', async () => {
    const { storagePersistence } = await import('../services/storagePersistence');

    await storagePersistence.saveOutbox(entry('m1', 'c1', 'перша спроба'));
    await storagePersistence.saveOutbox(entry('m1', 'c1', 'друга спроба'));

    const seen = storagePersistence.loadOutboxSync();
    expect(seen).toHaveLength(1);
    expect(seen[0].message.text).toBe('друга спроба');
  });
});
