/**
 * commands — реєстр пунктів командної палітри (Ф1, Ctrl+K).
 *
 * Чотири розділи (гонтлет №1, У8/У9: одна частина мови — іменники в
 * одному регістрі; деструктивне — окремо внизу), і ТІЛЬКИ реальні дії
 * з робочим шляхом сьогодні:
 *  «Столи»      — перемикання столів (deskStore двигуна f1-desk-engine);
 *                 підказка рядка несе вміст стола — «Стіл: Компанія» і
 *                 пейн «Компанія» більше не близнюки;
 *  «Переходи»   — рівно п'ять пейнів: Мапа, Діалог, Компанія,
 *                 Налаштування, Аналітика (вердикт власника 22.08:
 *                 «багато кнопок погано» — інші входи чекають дебату);
 *                 підказка називає наслідок: відкрити пейн на активному
 *                 столі;
 *  «Дії»        — теми (settingsStore.setTheme: DOM+localStorage одразу,
 *                 бекенд best-effort) і швидкий погляд «ШІ: стан ланцюга»
 *                 (борг У10: ланцюг живе карткою в «Огляді», але глянути
 *                 його треба одним хордом — peek показує відповідь просто
 *                 в рядку палітри, без переходу між столами);
 *  «Небезпечне» — вихід із сесії (канон FloatingToolbar: clearAuth +
 *                 setAuthenticated(false) + closeAll) — НЕ пласким
 *                 рядком серед тем: розділ завжди внизу, рядок вимагає
 *                 підтвердження (другий Enter у confirm-стані рядка).
 *
 * «Стоп усій Компанії» СВІДОМО відсутній: agent_runtime.stop(None)
 * зупиняє лише foreground-слот (agent/kernel/runtime.py:1150), глобальної
 * шини зупинки не існує — напис брехав би.
 *
 * Хоткеї показуються лише там, де вони реально працюють; глобальних
 * хоткеїв навігації сьогодні нема, тож колонка порожня всюди.
 */

import { useDeskStore, type PaneKind } from '../../stores/deskStore';
import { PANE_REGISTRY } from '../desk/paneRegistry';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { fetchHealth } from '../../services/organismApi';
import type { ThemeId } from '@shared/types';

export type CommandSection = 'Столи' | 'Переходи' | 'Дії' | 'Небезпечне';

/** Порядок розділів у палітрі; «Небезпечне» — завжди останнє. */
export const SECTION_ORDER: readonly CommandSection[] = [
  'Столи',
  'Переходи',
  'Дії',
  'Небезпечне',
];

export interface CommandItem {
  id: string;
  section: CommandSection;
  /** Назва укр. */
  title: string;
  /** Тьмяний суфікс: стан («активний»), вміст стола або наслідок дії. */
  hint?: string;
  /** Хоткей — лише реальний. Моноширинним у правій колонці. */
  hotkey?: string;
  /** Додаткові цілі нечіткого пошуку (латинка, синоніми). */
  keywords?: string[];
  /**
   * Деструктивна дія: перший Enter/клік переводить рядок у confirm-стан
   * (показує confirmLabel), і лише другий — виконує run.
   */
  danger?: boolean;
  /** Слово підтвердження в confirm-стані деструктивного рядка. */
  confirmLabel?: string;
  /** Дія рядка. Відсутня лише в рядках-поглядах (peek). */
  run?: () => void;
  /**
   * Швидкий погляд (У10): Enter НЕ закриває палітру — відповідь приходить
   * словом просто в рядок. Для стану, який треба глянути, не міняючи
   * контексту (стіл, пейн, скрол лишаються як були).
   */
  peek?: () => Promise<string>;
}

/** Пейни «Переходів» — рівно п'ять, за вердиктом власника. */
const NAV_TARGETS: ReadonlyArray<{ kind: PaneKind; title: string; keywords: string[] }> = [
  { kind: 'map', title: 'Мапа', keywords: ['map', 'мапа', 'карта'] },
  { kind: 'dialogue', title: 'Діалог', keywords: ['dialogue', 'chat', 'чат'] },
  { kind: 'company', title: 'Компанія', keywords: ['company', 'агенти', 'foundry'] },
  { kind: 'settings', title: 'Налаштування', keywords: ['settings', 'опції'] },
  // Ф4: слово «кокпіт» тепер веде на стіл «Кокпіт» (авто-рядок
  // «Стіл: Кокпіт» нижче), а огляд аналітики зветься «Огляд».
  { kind: 'analytics', title: 'Огляд', keywords: ['analytics', 'огляд', 'аналітика'] },
];

/**
 * Теми — усі чотири мають власні [data-theme]-блоки в tokens.css
 * (Обсидіан-мапінг: sunrise-warm=day, amber-night=dusk,
 * cyberdeck-cold=night, pro-console=minimal).
 */
const THEMES: ReadonlyArray<{ id: ThemeId; title: string; keywords: string[] }> = [
  { id: 'sunrise-warm', title: 'Тема: День', keywords: ['sunrise', 'day', 'світла'] },
  { id: 'amber-night', title: 'Тема: Смерк', keywords: ['amber', 'dusk', 'бурштин'] },
  { id: 'cyberdeck-cold', title: 'Тема: Ніч', keywords: ['cyberdeck', 'night', 'темна'] },
  { id: 'pro-console', title: 'Тема: Мінімал', keywords: ['console', 'minimal'] },
];

export interface BuildCommandsOptions {
  /**
   * Перевизначення навігації для двигуна столів: якщо задано, «Перейти»
   * викликає його замість дефолтного deskStore.openPane(kind).
   */
  onNavigate?: (kind: PaneKind) => void;
  /** Закрити палітру — викликається перед кожною дією. */
  close: () => void;
}

/**
 * Побудова списку з ЖИВОГО стану сторів. Викликати на рендер палітри —
 * список маленький, мемоізація не потрібна.
 */
export function buildCommands(opts: BuildCommandsOptions): CommandItem[] {
  const { desks, activeDeskId } = useDeskStore.getState();
  const activeTheme = useSettingsStore.getState().getActiveTheme();
  const items: CommandItem[] = [];

  for (const desk of desks) {
    // Вміст стола підказкою: на запит «компан» рядок стола і рядок
    // пейна розрізняються ефектом, а не лише префіксом (У9).
    const contents =
      desk.panes.length > 0
        ? desk.panes.map((p) => PANE_REGISTRY[p.kind].title).join(' + ')
        : 'порожній';
    items.push({
      id: `desk:${desk.id}`,
      section: 'Столи',
      title: `Стіл: ${desk.name}`,
      hint: [desk.id === activeDeskId ? 'активний' : null, contents]
        .filter(Boolean)
        .join(' · '),
      keywords: ['desk', 'стіл', desk.id],
      run: () => {
        opts.close();
        useDeskStore.getState().setActiveDesk(desk.id);
      },
    });
  }

  for (const nav of NAV_TARGETS) {
    items.push({
      id: `nav:${nav.kind}`,
      section: 'Переходи',
      title: nav.title,
      // Наслідок дії словами — не «Компанія» проти «Стіл: Компанія» наосліп.
      hint: 'відкрити пейн на активному столі',
      keywords: nav.keywords,
      run: () => {
        opts.close();
        if (opts.onNavigate) opts.onNavigate(nav.kind);
        else useDeskStore.getState().openPane(nav.kind);
      },
    });
  }

  for (const theme of THEMES) {
    items.push({
      id: `theme:${theme.id}`,
      section: 'Дії',
      title: theme.title,
      hint: theme.id === activeTheme ? 'активна' : undefined,
      keywords: ['theme', 'тема', ...theme.keywords],
      run: () => {
        opts.close();
        void useSettingsStore.getState().setTheme(theme.id);
      },
    });
  }

  /* Швидкий погляд на ланцюг ШІ (борг У10). Картка живе в «Огляді»
   * (AnalyticsOverview, MetricCard «ШІ») — але потреба оператора інша:
   * глянути «хто зараз відповідає» за секунду, не полишаючи стола.
   * Перехід на «Огляд» заради одного рядка був би дорожчим і нечеснішим
   * за пряму відповідь тут: джерело те саме — публічний GET /health. */
  items.push({
    id: 'peek:ai-chain',
    section: 'Дії',
    title: 'ШІ: стан ланцюга',
    hint: 'активний → запасний · відповідь тут, без переходу',
    keywords: ['ai', 'llm', 'ші', 'ланцюг', 'gemini', 'ollama', 'провайдер', 'chain', 'health'],
    peek: async () => {
      const pulse = await fetchHealth();
      if (!pulse.ok) return 'ядро мовчить — ланцюг невідомий';
      const at = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      return `${pulse.data.ai_active} → ${pulse.data.ai_fallback} · /health · станом на ${at}`;
    },
  });

  items.push({
    id: 'action:sign-out',
    section: 'Небезпечне',
    title: 'Вийти з сесії',
    hint: 'розлогінить цей вузол',
    keywords: ['logout', 'вихід', 'exit'],
    // У8 (veteran): один нечіткий пошук + Enter у рукавицях розлогінював
    // посеред роботи. Деструктивне живе окремим розділом унизу і вимагає
    // другого Enter у confirm-стані рядка.
    danger: true,
    confirmLabel: 'Точно вийти? Enter — підтвердити',
    run: () => {
      opts.close();
      // Канон виходу — FloatingToolbar.signOut (без router-залежності:
      // LoginScreen сам постає на sessionPhase 'out').
      useAuthStore.getState().clearAuth();
      useSystemStore.getState().setAuthenticated(false);
      useUIStore.getState().closeAll();
    },
  });

  return items;
}
