/**
 * Кнопка дзвінка не обіцяє того, чого не може бути.
 *
 * До 30.08 її єдиною умовою було `const canCall = !isGroup` — тобто вона
 * питала про ФОРМУ розмови й жодного разу про наявність ДОРОГИ.
 *
 * У пакунку дороги немає: `VITE_MESH_BROKER_URL` порожній (публічний брокер
 * прибрали свідомо — через нього йшли відкриті листи), і `globalP2PMesh.publish`
 * мовчки виходить першим же рядком: `if (!BROKER_URL) return;`.
 *
 * Що бачила людина: тап по слухавці → звук → накладка дзвінка → **гудки без
 * кінця**. Жоден байт нікуди не йшов, і жодного слова про причину. З усіх
 * обірваних жестів цей найдорожчий: хто натисне й не додзвониться, не скаже
 * «бракує функції» — скаже «не працює».
 *
 * І найгірша деталь: `meshBrokerConfigured()` — перевірка рівно на це питання —
 * була **написана й не викликана ніким**. Один рядок відстані між справним
 * захистом і найгучнішою обіцянкою продукту.
 *
 * Сторож тримає обидві половини: кнопка мовчить без дороги, і працює з нею.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../utils/messengerSound', () => ({
  soundFx: { playTap: () => {}, playSend: () => {} },
}));

const brokerConfigured = { value: false };
vi.mock('../services/globalP2PMesh', () => ({
  meshBrokerConfigured: () => brokerConfigured.value,
  globalP2PMesh: {
    onMessage: () => () => {}, onCallSignal: () => () => {},
    sendCallSignal: () => {}, publish: () => {}, status: () => ({ enabled: false, connected: false, broker: '' }),
  },
}));

const CHAT = {
  id: 'c1', title: 'Оксана', type: 'direct', peerNodeId: 'node_x',
  contactVerified: true, members: [], messages: [],
} as never;

/** Обовʼязкові пропси, які до цього сторожа стосунку не мають.
 *
 *  `Header` вимагає вісім; нас цікавить рівно один — `currentChat`. Решту
 *  даємо заглушками ЯВНО, а не приховуємо все одним `as never`: інакше тест
 *  перестав би падати й тоді, коли пропси змінять зміст. */
const NOOP = () => {};
const REST = {
  currentUser: { id: 'u1', name: 'Я' },
  onOpenDigest: NOOP,
  onOpenSettings: NOOP,
  onOpenGroupDetails: NOOP,
  isSoundEnabled: false,
  onToggleSound: NOOP,
  onToggleSearch: NOOP,
  isSearching: false,
};

async function renderHeader() {
  const { Header } = await import('../components/messenger/Header');
  // Приведення робимо ТУТ, де `Header` — значення: `Parameters<typeof Header>[0]`
  // прив'язує заглушки до справжнього типу компонента, а не до вигаданого.
  const props = { currentChat: CHAT, ...REST } as unknown as Parameters<typeof Header>[0];
  return render(<Header {...props} />);
}

let fired: number;
const onCall = () => { fired += 1; };

beforeEach(() => { fired = 0; window.addEventListener('phantom:start-call', onCall); });
afterEach(() => window.removeEventListener('phantom:start-call', onCall));

describe('кнопка дзвінка не обіцяє без дороги', () => {
  it('без вузла звʼязку кнопки вимкнені й називають причину', async () => {
    brokerConfigured.value = false;
    await renderHeader();

    const audio = screen.getByLabelText('Аудіодзвінок') as HTMLButtonElement;
    expect(audio.disabled).toBe(true);
    // Причина мусить бути ПРО ДОРОГУ, а не про тип бесіди: людина зі
    // звіреним контактом сам-на-сам інакше винила б себе.
    expect(audio.title).toMatch(/вузол звʼязку|вимкнені/);
  });

  it('натискання без дороги не породжує спроби дзвінка', async () => {
    brokerConfigured.value = false;
    await renderHeader();

    fireEvent.click(screen.getByLabelText('Аудіодзвінок'));
    fireEvent.click(screen.getByLabelText('Відеодзвінок'));
    expect(fired).toBe(0);
  });

  it('із вузлом звʼязку кнопка жива й дзвінок стартує', async () => {
    brokerConfigured.value = true;
    await renderHeader();

    const audio = screen.getByLabelText('Аудіодзвінок') as HTMLButtonElement;
    expect(audio.disabled).toBe(false);
    fireEvent.click(audio);
    expect(fired).toBe(1);
  });
});
