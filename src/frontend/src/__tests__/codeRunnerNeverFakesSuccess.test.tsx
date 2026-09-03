/**
 * Віджет коду не вигадує успіху.
 *
 * Для всіх мов, крім JavaScript і TypeScript, він друкував:
 *     [PYTHON Isolated Sandbox]
 *     Executing 12 lines...
 *     ✓ Status: 200 OK
 *     Execution completed without memory leaks.
 * **не виконавши жодного рядка.** Вигаданий код стану, вигадана заява про
 * пам'ять і обіцянка ізоляції, якої не існує ні в цій гілці, ні в JS-гілці
 * поруч (там `new Function` у контексті самого вікна).
 *
 * Найтихіша мить — «ми цього не вміємо» — ставала найгучнішим твердженням.
 *
 * І, на відміну від виконання коду, ЦЕ CSP не спиняє: у пакунку
 * `script-src 'self'` без `unsafe-eval` не дає `new Function` запуститись,
 * але брехня не потребує дозволу на виконання. Тобто з двох дефектів у
 * цьому файлі в бету поїхав би саме той, що виглядав нешкідливим.
 *
 * Сторож тримає дві межі: чого писати НЕ можна, і що стан мусить залежати
 * від того, що сталось, а не від того, що ми дійшли до рядка.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { CodeRunnerWidgetEmbed } from '../components/messenger/widgets/CodeRunnerWidgetEmbed';

vi.mock('../utils/messengerSound', () => ({
  soundFx: { playTap: () => {}, playSend: () => {} },
}));

// Слова, яких у виводі бути не може: кожне з них — твердження про те,
// чого не сталось.
const INVENTED = ['200 OK', 'Isolated Sandbox', 'memory leaks', 'Executing'];

const runner = (language: string, code: string) =>
  ({ id: 'cr1', language, code, status: 'idle' } as never);

beforeEach(() => vi.useRealTimers());

describe('віджет коду не вигадує успіху', () => {
  it('мова, якої ми не запускаємо, отримує відмову, а не «200 OK»', async () => {
    const { container } = render(
      <CodeRunnerWidgetEmbed data={runner('python', 'print(1)')} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run|Виконати|▶/i }));

    await waitFor(() => expect(container.textContent).toContain('не запускається'));
    for (const word of INVENTED) {
      expect(container.textContent).not.toContain(word);
    }
  });

  it('відмова називає, що саме вміє, і не чіпає код', async () => {
    const { container } = render(
      <CodeRunnerWidgetEmbed data={runner('rust', 'fn main() {}')} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run|Виконати|▶/i }));

    await waitFor(() => expect(container.textContent).toContain('не запускається'));
    expect(container.textContent).toContain('JavaScript');
    expect(container.textContent).toContain('Код збережено як є');
  });

  it('стан не оголошується успіхом, коли виконання впало', async () => {
    const seen: string[] = [];
    render(
      <CodeRunnerWidgetEmbed
        data={runner('javascript', 'throw new Error("бум")')}
        onUpdate={(u) => seen.push(String((u as { status?: string }).status))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run|Виконати|▶/i }));

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // У пакунку сюди приводить не лише кинутий виняток, а й `EvalError` від
    // CSP — і тоді напис «Runtime Error» стояв би поруч зі значком успіху.
    expect(seen[seen.length - 1]).toBe('error');
  });

  it('справжнє виконання JS усе ще працює і зветься успіхом', async () => {
    const seen: string[] = [];
    const { container } = render(
      <CodeRunnerWidgetEmbed
        data={runner('javascript', 'console.log("живий")')}
        onUpdate={(u) => seen.push(String((u as { status?: string }).status))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run|Виконати|▶/i }));

    // Чекаємо на onUpdate, а не на текст: рядок «живий» стоїть у самому коді
    // на екрані ще до запуску, тож waitFor по ньому проходив би миттєво й
    // міряв би не виконання, а власний кадр. (Спіймало мене одразу.)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toBe('success');
    expect(container.textContent).toContain('живий');
  });
});
