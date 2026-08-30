/**
 * Екрани, що вигадують факти, не відкриваються.
 *
 * У месенджері 57 модалок, і 45 із них **не мають джерела даних узагалі** —
 * ні `messengerApi`, ні жодного стору, — але малюють операційний зміст як
 * живий: журнал аудиту безпеки з часом і хешами, «War Room Active», аварію
 * «Database Replica Sync Timeout on Radxa-03» на платформі, яку ми з цілей
 * зняли, вузол `node_alpha_radxa` зі «100 Mbps», знімки `snap_3` за підписом
 * «Кирило (ROOT)».
 *
 * Критерій приховування рівно один: **вигадує чи бракує?** Вигадує — замок;
 * бракує даних — лишається з чесним порожнім станом. Ховаємо брехню, не
 * незавершеність.
 *
 * Сторож перевіряє САМ ЗАМОК, а не перелік: замок, який ніхто не пробував
 * відчинити, — це рівно той дефект, що трапився в цьому дереві шість разів.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ModalHost } from '../components/messenger/modals/ModalHost';
import { useModalStore } from '../stores/modalStore';

const open = (key: string) => useModalStore.setState({ activeModal: key } as never);

beforeEach(() => useModalStore.setState({ activeModal: null, modalProps: {} } as never));

describe('замок на екранах, що вигадують', () => {
  it('журнал аудиту безпеки не відкривається — він вигадував людей і хеші', async () => {
    open('secOpsCompliance');
    const { container } = render(<ModalHost />);

    await waitFor(() => expect(container.textContent).not.toContain('Безпека простору'));
    expect(screen.queryByText(/kiril_root/)).toBeNull();
  });

  it('«War Room» не відкривається — він вигадував аварію на знятій платформі', async () => {
    open('autonomousOps');
    const { container } = render(<ModalHost />);

    await waitFor(() => expect(container.textContent).not.toContain('War Room'));
    expect(container.textContent).not.toContain('Radxa');
  });

  it('вигаданий вебхук із секретом не відкривається', async () => {
    // Цей випадок спіймав МЕНЕ. Спершу я лишив екран відкритим, бо він бере
    // дані зі стору — а отже «має джерело». Тест показав, що саме він малює:
    // «GitHub Repository Push Webhook», «Активний», `token: ph_sec_9938218`.
    // `workOsStore` до мережі не ходить і засіяний літералами. Стор між
    // екраном і вигадкою нічого не змінює: джерело — це вузол.
    open('webhooks');
    const { container } = render(<ModalHost />);

    await waitFor(() => expect(container.textContent).not.toContain('ph_sec_'));
    expect(container.textContent).not.toContain('GitHub Repository Push');
  });

  it('відкриті двері справді відкриваються — замок не накрив усе', async () => {
    // КОНТРОЛЬНИЙ ВИПАДОК, і його довелось міняти.
    //
    // Раніше тут стояв `liveTerminal` із підписом «справжня поверхня». Він нею
    // не був: вигадував рукостискання вузлів через `Math.random()` замість
    // затримок і оголошував `did:phantom:radxa_arm64_0x8f2a` — ідентифікатор
    // платформи, ЗНЯТОЇ з цілей. Зачинено разом із рештою.
    //
    // Шукаючи заміну, я виміряв усі 57 дверей `ModalHost` і мушу сказати
    // прямо: ЖОДНІ з них не читають справжніх даних і не показують їх.
    // Найближче — `commandPalette`: він не малює вигаданого стану, а його
    // команди діють на справжній `useMessengerStore`. Тому контроль тут саме
    // такий: двері, які мусять відчинятись.
    //
    // Поверхні, що СПРАВДІ читають вузол, у месенджері є — `CreateChatModal`
    // бере контакти через `messengerApi.listContacts()`, бічна панель шукає
    // через `searchMessages`. Але жодна з них не живе в `ModalHost`, тож
    // контролем для ЦЬОГО замка бути не може. Їх стережуть свої тести.
    open('commandPalette');
    const { container } = render(<ModalHost />);

    await waitFor(() => expect(container.textContent).not.toBe(''), { timeout: 4000 });
  });

  it('невідомий ключ нічого не малює і не падає', () => {
    open('такого-екрана-немає');
    const { container } = render(<ModalHost />);

    expect(container.textContent).toBe('');
  });
});
