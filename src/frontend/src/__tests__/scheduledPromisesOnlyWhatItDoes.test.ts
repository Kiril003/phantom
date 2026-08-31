/**
 * Відкладені листи не обіцяють того, чого не вміють.
 *
 * Виміряно 31.08.2026, і вимір довелось виправити на ходу. Спершу я написав
 * «таймера немає ніде» — це спростував ОЦЕЙ ФАЙЛ: мій grep шукав таймер серед
 * рядків, де згадано «scheduled», а диспетчер живе в `MessengerRoot` за
 * тридцять рядків від такої згадки. Тест ловить по ФАЙЛУ, тому побачив те,
 * чого не побачив рядковий пошук.
 *
 * Справжній стан:
 * — вузол про відкладені листи не знає нічого: ані таблиці, ані маршруту;
 * — диспетчер у `MessengerRoot` цокає кожні 10 с і збігом `HH:MM` вирішує,
 *   що час настав. Тобто лист іде, лише поки месенджер відкритий, і хвилина,
 *   пропущена при закритій вкладці, пропущена назавжди — надолуження немає;
 * — а `sendScheduledNow` кликав `sendMessage`, який шле в АКТИВНИЙ чат.
 *
 * Останнє й було найгіршим: чернетка для Марти йшла в ту розмову, яка
 * випадково відкрита о тій хвилині. Не «не надіслалось», а надіслалось НЕ ТІЙ
 * ЛЮДИНІ, і відправник цього не бачив.
 *
 * Копія при цьому казала «черга повідомлень до їх відправки» — обіцянка
 * самостійного надсилання, якої вкладка виконати не може.
 *
 * Перший сторож навмисно **умовний**: він вимагає чесної копії лише доти,
 * доки немає маршруту вузла. Щойно справжня відкладена відправка з'явиться,
 * перевірка сама вимкнеться, і нікому не доведеться згадувати, що її час
 * знімати. Ворота, які не вміють піти самі, з часом брешуть у інший бік.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Чи існує вже справжня відкладена відправка через вузол. */
function schedulerExists(): boolean {
  return FILES.some((f) => /['"`][^'"`]*\/messenger\/scheduled/.test(readFileSync(f, 'utf8')));
}

describe('відкладені листи', () => {
  it('механізму на вузлі досі немає — і поки так, копія мусить це визнавати', () => {
    if (schedulerExists()) return; // Механізм з'явився — перевірка себе скасувала.

    const drawer = readFileSync(join(SRC, 'components/messenger/ScheduledMessagesDrawer.tsx'), 'utf8');

    // Прибираємо коментарі: пояснення, ЧОМУ прибрано обіцянку, саме містить
    // слова обіцянки. Тричі за добу цей дім ловив себе на цьому.
    const visible = drawer
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Ключова обіцянка — що лист поїде САМ. Слово «запланувати» лишається
    // законним: людина справді планує час, просто надсилає його дотиком.
    // Без класів на кшталт `\w`: у JS він означає [A-Za-z0-9_] і кирилицю НЕ
    // ловить. Через це перша версія цієї перевірки була зелена навіть тоді,
    // коли обіцянка стояла на місці, — сторож без шляху до червоного.
    expect(visible).not.toMatch(/повідомлень\s+до\s+їх\s+відправк/i);
    expect(visible).toMatch(/надсила|дотик/i);
  });

  it('диспетчер шле чернетку в ЇЇ розмову, а не в ту, що відкрита', async () => {
    // Найдорожча знахідка цього обходу, і знайшов її не grep, а цей файл.
    //
    // Диспетчер у `MessengerRoot` цокає кожні 10 с і при збігу часу кличе
    // `sendScheduledNow`. А той кликав `sendMessage`, який шле в АКТИВНИЙ
    // чат. Тобто чернетка для Марти йшла в ту розмову, яка випадково
    // відкрита о тій хвилині: не «не надіслалось», а надіслалось НЕ ТІЙ
    // ЛЮДИНІ, і відправник цього не бачив.
    const { useMessengerStore } = await import('../stores/messengerStore');
    const { messengerApi } = await import('../services/messengerApi');
    const { vi } = await import('vitest');

    useMessengerStore.setState({
      chats: [
        { id: 'conv_marta', title: 'Марта', messages: [], type: 'dm' },
        { id: 'conv_open', title: 'Відкритий', messages: [], type: 'dm' },
      ],
      activeChatId: 'conv_open',
      scheduledMessages: [
        { id: 'sched_1', chatId: 'conv_marta', chatTitle: 'Марта', text: 'таємне', type: 'text', scheduledTime: '09:30', createdAt: '' },
      ],
    } as never);

    const spy = vi
      .spyOn(messengerApi, 'appendMessage')
      .mockResolvedValue({ id: 'row_1', delivery_state: 'sent' } as never);

    await useMessengerStore.getState().sendScheduledNow('sched_1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('conv_marta');
    const open = useMessengerStore
      .getState()
      .chats.find((c: { id: string }) => c.id === 'conv_open');
    expect(open?.messages).toHaveLength(0);
  });
});
