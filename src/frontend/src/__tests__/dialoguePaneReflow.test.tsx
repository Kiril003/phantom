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
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { SystemState } from '@shared/types';
import { useChatStore } from '../stores/chatStore';
import { useSystemStore } from '../stores/systemStore';
import { useSettingsStore } from '../stores/settingsStore';

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

  /**
   * Композер на реальній ширині пейна ДІАЛОГ.
   *
   * Два тести вище були зелені й НЕ бачили дефекту: вони шукали клас
   * «фіксована ширина, ширша за контейнер», а тут хвороба протилежна —
   * ряд композера складається з контролів, які стискатись ВІДМОВЛЯЮТЬСЯ
   * (shrink-0 + minWidth 44), і єдиного, який стискається без підлоги —
   * самого поля вводу. Дефіцит місця цілком лягав на поле: у браузері
   * воно сідало до 36px і підказка сипалась по одній літері.
   *
   * Ширина взята не зі стелі: стандартний стіл «Театр» — це мапа 2/3 +
   * діалог 1/3 (deskStore), тож у вікні 920px (стільки дає тайловий
   * композитор) діалогу дістається ≈ (920 − 6) / 3 ≈ 305px.
   */
  it('на ширині пейна стандартного стола (~305px) поле вводу лишається полем', async () => {
    const PANE = 305;
    const { container } = await renderDialogueAt(PANE);

    const field = container.querySelector('textarea');
    expect(field, 'поле повідомлення мусить бути в дереві').not.toBeNull();
    const row = field!.closest('.glass-card') as HTMLElement | null;
    expect(row, 'поле мусить жити в ряду композера').not.toBeNull();

    /** Tailwind-крок: gap-2 → 8px, px-4 → 16px. */
    const tw = (cls: string, prefix: string) => {
      const m = new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(cls);
      return m ? Number(m[1]) * 4 : 0;
    };

    // Скільки місця має ряд: ширина пейна мінус горизонтальні відступи
    // всіх предків до поверхні діалогу. Читаємо з дерева, а не з
    // константи, щоб тест не протух, коли відступи зміняться.
    let ancestorPad = 0;
    for (
      let el = row!.parentElement;
      el && el !== container && !el.hasAttribute('data-testid');
      el = el.parentElement
    ) {
      const cls = el.className ?? '';
      ancestorPad += tw(cls, 'px') * 2 + tw(cls, 'pl') + tw(cls, 'pr');
      ancestorPad +=
        (parseFloat(el.style.paddingLeft) || 0) + (parseFloat(el.style.paddingRight) || 0);
    }
    const rowPadX = tw(row!.className, 'pl') + tw(row!.className, 'pr');
    const gap = tw(row!.className, 'gap');
    const rowContent = PANE - ancestorPad - rowPadX;

    // Незмінний хром: кожна кнопка ряду сама оголошує свій мінімум.
    const buttons = Array.from(row!.querySelectorAll('button'));
    const buttonMin = (b: Element) =>
      parseFloat((b as HTMLElement).style.minWidth) ||
      parseFloat((b as HTMLElement).style.width) ||
      0;
    const chrome = buttons.reduce((acc, b) => acc + buttonMin(b), 0);
    const gaps = gap * buttons.length; // проміжки між усіма контролями ряду

    /** Вужче за це поле перестає бути полем і стає стовпчиком літер. */
    const FIELD_FLOOR = 120;

    // 1. Поле мусить мати ВЛАСНУ підлогу. Без неї автоматичний мінімум
    //    flex-дитини для textarea дорівнює нулю (UA-стиль дає їй
    //    overflow:auto, а це за специфікацією обнуляє min-width:auto),
    //    тож увесь дефіцит ряду зʼїдає саме поле.
    const fieldMin = parseFloat(field!.style.minWidth);
    expect(
      fieldMin,
      'поле вводу не оголошує мінімальної ширини — воно єдине, що стискається, і сяде в нуль',
    ).toBeGreaterThanOrEqual(FIELD_FLOOR);

    // 2. Якщо в один рядок поле з підлогою не влазить — ряд мусить мати
    //    право перенестись. Інакше єдиний вихід у флексу — виштовхнути
    //    «Надіслати» за край (та сама хвороба, що вже лікували в
    //    MessengerLayout).
    const leftoverOnOneLine = rowContent - chrome - gaps;
    if (leftoverOnOneLine < FIELD_FLOOR) {
      expect(
        row!.className,
        `в один рядок полю лишається ${Math.round(leftoverOnOneLine)}px — ряд мусить переноситись`,
      ).toMatch(/(?:^|\s)flex-wrap(?:\s|$)/);

      // І перенесений рядок мусить вміщати поле разом із «Надіслати».
      const send = buttons[buttons.length - 1];
      expect(fieldMin + gap + buttonMin(send)).toBeLessThanOrEqual(rowContent);
    }
  });

  it('на плитці слово стану ціле, а не «Го…»', async () => {
    // 03.09.2026 на склі: у пейні ДІАЛОГ 331 px слово «Готовий» різалось до
    // 21 px із потрібних 57 — тобто заголовок показував «Го…», поки орб і
    // назва провайдера тримали своє місце. Правило цього файлу вже було
    // записане («краще нема, ніж зрізане посеред слова») — тут воно стає
    // перевірним для СЛОВА стану, а не лише для біо-чипів.
    await renderDialogueAt(331);

    const strip = screen.getByTestId('presence-strip');
    const word = [...strip.querySelectorAll('span')].find(
      (el) => el.children.length === 0 && (el.textContent || '').trim().length > 2,
    );
    expect(word, 'слово стану має бути в смузі присутності').toBeDefined();
    expect(
      word!.className,
      'слово стану не має права нести truncate — воно підмет заголовка',
    ).not.toMatch(/truncate/);
    expect(word!.className).toMatch(/shrink-0/);

    // Орб і провайдер на плитці поступаються місцем слову.
    expect(strip.querySelector('svg[viewBox="0 0 32 32"]')).toBeNull();
  });

  it('мікрофон, що слухає, видно і на плитці', async () => {
    // Провайдер на плитці ховається, але чипс голосу — попередження, не
    // оздоба: він мусить пережити будь-яке стискання.
    const prev = useSettingsStore.getState().values;
    useSettingsStore.setState({ values: { ...prev, voice_mode: 'continuous' } } as never);
    try {
      await renderDialogueAt(331);
      const strip = screen.getByTestId('presence-strip');
      expect(strip.textContent).toMatch(/наживо/);
    } finally {
      useSettingsStore.setState({ values: prev } as never);
    }
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
  /* ─── Панель розмов: оверлей у вузькому пейні ─────────────────────────
   *
   * ChatSidebar оголошена як «w-[260px] … shrink-0» — тобто звичайний
   * СУСІД У РЯДУ. У виміряному пейні ДІАЛОГ (457px — вікно тайлового
   * композитора власника, 920×532) ці 260px беруться з розмови: ряду
   * композера лишається 133px при потрібних 192, і «Надіслати»
   * виштовхується за край, де її зрізає overflow-hidden поверхні.
   *
   * Поріг тут не круглий, а порахований із самої верстки (див.
   * SIDEBAR_INLINE_MIN_W у ChatWindow): 260 (панель) + 192 (поле 140 +
   * gap-2 + «Надіслати» 44 — одна нерозривна одиниця переносу) + 48
   * (px-4 рейки та pl-2/pr-2 ряду) = 500px власної ширини чату.
   */
  describe('панель розмов: оверлей на вузькому пейні, сусід на широкому', () => {
    /** Виміряний пейн ДІАЛОГ власника. */
    const NARROW_PANE = 457;
    /**
     * Щойно за порогом. У jsdom підмінений вимір віддає ширину пейна
     * КОЖНОМУ елементу, тож ChatWindow бачить рівно 520; у браузері він
     * бачить на 16px менше (відступи DialogueLayout), тобто 504 — по
     * обидва боки це «за порогом 500», і тест не бреше про браузер.
     */
    const EDGE_PANE = 520;

    /** Елемент вийшов із потоку — він нічого не забирає в ряду. */
    function outOfFlow(el: HTMLElement): boolean {
      const cls = el.getAttribute('class') ?? '';
      return (
        /(?:^|\s)(?:absolute|fixed)(?:\s|$)/.test(cls) ||
        el.style.position === 'absolute' ||
        el.style.position === 'fixed'
      );
    }

    /** Оголошена ширина: клас w-[Npx] або inline-стиль. */
    function declaredWidth(el: HTMLElement): number {
      const m = /(?:^|\s)w-\[(\d+)px\]/.exec(el.getAttribute('class') ?? '');
      return m ? Number(m[1]) : parseFloat(el.style.width) || 0;
    }

    /** Tailwind-крок: gap-2 → 8px, px-4 → 16px. */
    const tw = (cls: string, prefix: string) => {
      const m = new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(cls);
      return m ? Number(m[1]) * 4 : 0;
    };

    /**
     * Скільки ширини лишається ряду композера — і скільки йому треба.
     * Обидва числа читаються з дерева, а не з констант: тест мусить
     * протухнути разом із версткою, а не пережити її.
     */
    function composerBudget(container: HTMLElement, pane: number) {
      const field = container.querySelector('textarea') as HTMLTextAreaElement | null;
      expect(field, 'поле повідомлення мусить бути в дереві').not.toBeNull();
      const row = field!.closest('.glass-card') as HTMLElement | null;
      expect(row, 'поле мусить жити в ряду композера').not.toBeNull();

      // Відступи всіх предків ряду до поверхні діалогу.
      let ancestorPad = 0;
      for (
        let el = row!.parentElement;
        el && el !== container && !el.hasAttribute('data-testid');
        el = el.parentElement
      ) {
        const cls = typeof el.className === 'string' ? el.className : '';
        ancestorPad += tw(cls, 'px') * 2 + tw(cls, 'pl') + tw(cls, 'pr');
        ancestorPad +=
          (parseFloat(el.style.paddingLeft) || 0) + (parseFloat(el.style.paddingRight) || 0);
      }

      // Панель — сусід у ряду? Тоді її ширина йде з тієї самої каси.
      // Шукаємо саме <aside>, а не наш новий data-testid: інакше тест
      // на старому коді падав би через відсутній атрибут, а не через
      // справжній дефект геометрії.
      const panel = container.querySelector('aside') as HTMLElement | null;
      const panelCost = panel && !outOfFlow(panel) ? declaredWidth(panel) : 0;

      const rowContent =
        pane - ancestorPad - tw(row!.className, 'pl') - tw(row!.className, 'pr') - panelCost;

      // Потреба ряду: поле з власною підлогою + проміжок + «Надіслати».
      // Ця трійця — один flex-елемент, вона або стоїть, або не влазить.
      const group = field!.parentElement as HTMLElement;
      const send = group.querySelector('button') as HTMLElement | null;
      expect(send, '«Надіслати» мусить стояти поруч із полем').not.toBeNull();
      const need =
        (parseFloat(field!.style.minWidth) || 0) +
        tw(group.className, 'gap') +
        (parseFloat(send!.style.minWidth) || parseFloat(send!.style.width) || 0);

      return { rowContent, need, panel };
    }

    async function openSessions() {
      const opener = screen.getByLabelText('Відкрити сесії');
      await act(async () => {
        fireEvent.click(opener);
      });
    }

    it(`на пейні ${NARROW_PANE}px панель не забирає ширину в композера`, async () => {
      const { container } = await renderDialogueAt(NARROW_PANE);
      await openSessions();

      // Головне і перше: «Надіслати» має де стояти. Саме тут старий код
      // червонів — 133px при потрібних 192.
      const { rowContent, need, panel } = composerBudget(container, NARROW_PANE);
      expect(panel, 'панель розмов мусить відкритись').not.toBeNull();
      expect(
        rowContent,
        `ряду композера лишилось ${Math.round(rowContent)}px, а треба ${need}px — ` +
          '«Надіслати» виштовхнуто за край пейна і зрізано overflow-hidden',
      ).toBeGreaterThanOrEqual(need);

      // І це саме оверлей: поверх вмісту, поза потоком.
      expect(outOfFlow(panel!), 'панель мусить вийти з потоку, а не стояти сусідом').toBe(true);
      expect(screen.getByTestId('chat-sessions-panel').getAttribute('data-overlay')).toBe('true');

      // Затемнення позаду — і вихід кліком поза панеллю.
      const scrim = screen.getByTestId('chat-sessions-scrim');
      await act(async () => {
        fireEvent.click(scrim);
      });
      expect(
        screen.queryByTestId('chat-sessions-panel'),
        'клік поза панеллю мусить її закрити',
      ).toBeNull();
    });

    it(`на ${EDGE_PANE}px — щойно за порогом — панель лишається сусідом у ряду`, async () => {
      const { container } = await renderDialogueAt(EDGE_PANE);
      await openSessions();

      const { rowContent, need, panel } = composerBudget(container, EDGE_PANE);
      expect(panel).not.toBeNull();
      // Поріг обрано так, щоб саме тут обидва твердження ще трималися:
      // панель у ряду І композер цілий.
      expect(outOfFlow(panel!), 'за порогом панель не має ставати оверлеєм').toBe(false);
      expect(screen.queryByTestId('chat-sessions-scrim'), 'у ряду затемнення зайве').toBeNull();
      expect(
        rowContent,
        `на порозі ряду лишається ${Math.round(rowContent)}px при потребі ${need}px`,
      ).toBeGreaterThanOrEqual(need);
    });

    it('на 960px поведінка та сама, що й була: панель у ряду, без затемнення', async () => {
      const { container } = await renderDialogueAt(960);
      await openSessions();

      const { rowContent, need, panel } = composerBudget(container, 960);
      expect(panel).not.toBeNull();
      expect(outOfFlow(panel!)).toBe(false);
      expect(panel!.getAttribute('class')).toMatch(/(?:^|\s)shrink-0(?:\s|$)/);
      expect(screen.queryByTestId('chat-sessions-scrim')).toBeNull();
      expect(rowContent).toBeGreaterThanOrEqual(need);
    });
  });
});
