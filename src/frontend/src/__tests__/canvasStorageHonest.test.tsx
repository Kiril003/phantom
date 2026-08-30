/**
 * Полотно каже, коли не зберегло.
 *
 * Три `catch {}` ковтали відмову localStorage. Полотно живе ЛИШЕ у вкладці —
 * на вузол воно не їде, — тож невдалий запис означає, що написане зникне при
 * перезавантаженні. Мовчазна відмова тут дорівнює втраті роботи, про яку
 * дізнаються постфактум.
 *
 * Сторож навмисно перевіряє не `persist`, а СМУГУ НА ЕКРАНІ: стан, який
 * ніхто не малює, — це рівно той дефект, що вже п'ять разів траплявся в
 * цьому дереві. Тому доказ береться з того, що видно людині.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { CanvasSplitView } from '../components/messenger/CanvasSplitView';

const addBlock = () =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent('phantom:add-to-canvas', { detail: { text: 'нотатка', type: 'text' } }),
    );
  });

afterEach(() => vi.restoreAllMocks());

describe('полотно і сховище вкладки', () => {
  it('сховище відмовило — сказано одразу, ще до першої правки', () => {
    // Шпигувати треба саме за globalThis.localStorage: `test-setup.ts`
    // підміняє його власним об'єктом, тож `Storage.prototype` у ланцюжку
    // не бере участі й шпигун туди просто не чіпляється.
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(<CanvasSplitView chatTitle="Тест" chatId="c1" threadId="t1" onClose={() => {}} />);

    // Попередити після того, як людина набрала абзац, — це вже не
    // попередження, а співчуття. Тому перевіряємо саме мить відкриття.
    expect(screen.getByTestId('canvas-not-saved')).toBeTruthy();

    addBlock();
    expect(screen.getByTestId('canvas-not-saved')).toBeTruthy();
  });

  it('коли запис проходить — жодного зайвого попередження', () => {
    render(<CanvasSplitView chatTitle="Тест" chatId="c2" threadId="t2" onClose={() => {}} />);
    addBlock();

    expect(screen.queryByTestId('canvas-not-saved')).toBeNull();
  });
});
