/**
 * Ф1 гонтлет №1, У3 (блокер design-krytyk): пейн ДІАЛОГ кліпав контент
 * правим краєм, бо всередині ресайзабельного пейна сиділа фіксована
 * телефонна ширина (min-w-[1024px]).
 *
 * Цей тест рендерить DialogueLayout на ширині плитки Театру (~640px) і
 * на ~960px та доводить:
 *  1) верстка ЧИТАЄ КОНТЕЙНЕР — layout міряє власну ширину і перемикає
 *     режим (data-narrow), а не припускає в'юпорт;
 *  2) у дереві нема жодного елемента з фіксованою шириною чи
 *     min-width, ширшою за контейнер — класу дефекту, що дав кліп;
 *  3) на вузькій плитці біо-чипи присутності чесно зникають, а не
 *     зрізаються посеред слова.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { SystemState } from '@shared/types';
import { useChatStore } from '../stores/chatStore';
import { useSystemStore } from '../stores/systemStore';

/* ─── Framer-motion / heavy-lib mocks (як у chat.test.tsx) ─────────────── */

vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileInView',
    'layout',
    'layoutId',
  ]);
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) =>
          React.forwardRef((props: Record<string, unknown>, ref) => {
            const rest: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(props)) {
              if (!MOTION_PROPS.has(k)) rest[k] = v;
            }
            const { children, ...attrs } = rest as { children?: React.ReactNode };
            return React.createElement(
              typeof tag === 'string' ? tag : 'div',
              { ...attrs, ref },
              children,
            );
          }),
      },
    ),
  };
});

vi.mock('maplibre-gl', () => ({ default: {} }));

/* ─── Вимір контейнера під контролем тесту ─────────────────────────────── */

const realGetRect = HTMLElement.prototype.getBoundingClientRect;
let containerWidth = 1280;

function stubMeasuredWidth(width: number) {
  containerWidth = width;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: containerWidth,
      height: 480,
      top: 0,
      left: 0,
      right: containerWidth,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

/**
 * Прохід деревом: жодної фіксованої width/min-width, ширшої за контейнер.
 * max-width навмисно НЕ рахується — вона не може дати горизонтального
 * кліпу, лише звузити колонку.
 */
function assertNoFixedWidthWiderThan(root: HTMLElement, limit: number) {
  const offenders: string[] = [];
  const classRe = /(?:^|\s)(?:min-w|w)-\[(\d+)px\]/g;
  for (const el of Array.from(root.querySelectorAll<Element>('*'))) {
    const cls = el.getAttribute('class') ?? '';
    for (const m of cls.matchAll(classRe)) {
      if (Number(m[1]) > limit) offenders.push(`${el.tagName}: class «${m[0].trim()}»`);
    }
    const style = (el as HTMLElement).style;
    if (style) {
      for (const prop of ['width', 'minWidth'] as const) {
        const v = style[prop];
        const px = /^(\d+(?:\.\d+)?)px$/.exec(v ?? '');
        if (px && Number(px[1]) > limit) offenders.push(`${el.tagName}: style ${prop}=${v}`);
      }
    }
  }
  expect(offenders, `фіксовані ширини > ${limit}px:\n${offenders.join('\n')}`).toEqual([]);
}

async function renderDialogueAt(width: number) {
  stubMeasuredWidth(width);
  const { default: DialogueLayout } = await import('../layouts/DialogueLayout');
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <div style={{ width }}>
        <DialogueLayout />
      </div>,
    );
  });
  return result!;
}

describe('ДІАЛОГ у пейні: reflow від контейнера, не кліп (У3)', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      streaming: null,
      isTyping: false,
      loading: false,
      sending: false,
      error: null,
      loadSessions: async () => {
        /* noop — мережі в jsdom нема */
      },
    });
    useSystemStore.setState({
      state: SystemState.DIALOGUE,
      authenticated: true,
      wsConnected: true,
      // Живі біосигнали: на широкому їх видно, на вузькому — чесно нема.
      context: {
        body: { breathing_bpm: 12, stress_level: 0.2 },
        system: { ai_provider: 'gemini' },
      } as unknown as ReturnType<typeof useSystemStore.getState>['context'],
    });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realGetRect;
  });

  it('на ширині плитки (~640px) немає фіксованих ширин, ширших за пейн', async () => {
    const { container } = await renderDialogueAt(640);

    // Верстка прочитала контейнер: режим narrow увімкнувся від виміру.
    const surface = screen.getByTestId('dialogue-surface');
    expect(surface.getAttribute('data-narrow')).toBe('true');

    // Класу дефекту (телефонна ширина в пейні) не існує ніде в дереві.
    assertNoFixedWidthWiderThan(container, 640);
    expect(container.querySelector('.min-w-\\[1024px\\]')).toBeNull();

    // Порожній стан живе словом, не обрубком: заголовок і чипи на місці.
    expect(screen.getAllByText(/Нова розмова|Сесію завантажено/).length).toBeGreaterThan(0);
    expect(screen.getByText('Поясни налаштування')).toBeDefined();

    // Біо-чипи на вузькій плитці чесно відсутні (не зрізані).
    expect(screen.queryByText('12/хв')).toBeNull();
    expect(screen.queryByText('низький')).toBeNull();
  });

  it('на ~960px режим широкий: біо-чипи видимі, фіксованих ширин > 960 нема', async () => {
    const { container } = await renderDialogueAt(960);

    const surface = screen.getByTestId('dialogue-surface');
    expect(surface.getAttribute('data-narrow')).toBeNull();

    assertNoFixedWidthWiderThan(container, 960);

    // Широкий контейнер несе повну присутність — ті самі дані, більше місця.
    expect(screen.getByText('12/хв')).toBeDefined();
    expect(screen.getByText('низький')).toBeDefined();
  });
});
