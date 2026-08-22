/**
 * commands — реєстр пунктів командної палітри (Ф1, Ctrl+K).
 *
 * Три розділи, і ТІЛЬКИ реальні дії з робочим шляхом сьогодні:
 *  «Столи»   — перемикання столів (deskStore двигуна f1-desk-engine);
 *  «Перейти» — рівно п'ять пейнів: Мапа, Діалог, Компанія,
 *              Налаштування, Аналітика (вердикт власника 22.08:
 *              «багато кнопок погано» — інші входи чекають дебату);
 *  «Дії»     — теми (settingsStore.setTheme: DOM+localStorage одразу,
 *              бекенд best-effort) і вихід (канон FloatingToolbar:
 *              clearAuth + setAuthenticated(false) + closeAll).
 *
 * «Стоп усій Компанії» СВІДОМО відсутній: agent_runtime.stop(None)
 * зупиняє лише foreground-слот (agent/kernel/runtime.py:1150), глобальної
 * шини зупинки не існує — напис брехав би.
 *
 * Хоткеї показуються лише там, де вони реально працюють; глобальних
 * хоткеїв навігації сьогодні нема, тож колонка порожня всюди.
 */

import { useDeskStore, type PaneKind } from '../../stores/deskStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSystemStore } from '../../stores/systemStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import type { ThemeId } from '@shared/types';

export type CommandSection = 'Столи' | 'Перейти' | 'Дії';

/** Порядок розділів у палітрі. */
export const SECTION_ORDER: readonly CommandSection[] = ['Столи', 'Перейти', 'Дії'];

export interface CommandItem {
  id: string;
  section: CommandSection;
  /** Назва укр. */
  title: string;
  /** Тьмяний суфікс стану (напр. «активний»). */
  hint?: string;
  /** Хоткей — лише реальний. Моноширинним у правій колонці. */
  hotkey?: string;
  /** Додаткові цілі нечіткого пошуку (латинка, синоніми). */
  keywords?: string[];
  run: () => void;
}

/** Пейни «Перейти» — рівно п'ять, за вердиктом власника. */
const NAV_TARGETS: ReadonlyArray<{ kind: PaneKind; title: string; keywords: string[] }> = [
  { kind: 'map', title: 'Мапа', keywords: ['map', 'мапа', 'карта'] },
  { kind: 'dialogue', title: 'Діалог', keywords: ['dialogue', 'chat', 'чат'] },
  { kind: 'company', title: 'Компанія', keywords: ['company', 'агенти', 'foundry'] },
  { kind: 'settings', title: 'Налаштування', keywords: ['settings', 'опції'] },
  { kind: 'analytics', title: 'Аналітика', keywords: ['analytics', 'кокпіт'] },
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
    items.push({
      id: `desk:${desk.id}`,
      section: 'Столи',
      title: `Стіл: ${desk.name}`,
      hint: desk.id === activeDeskId ? 'активний' : undefined,
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
      section: 'Перейти',
      title: nav.title,
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

  items.push({
    id: 'action:sign-out',
    section: 'Дії',
    title: 'Вийти з сесії',
    keywords: ['logout', 'вихід', 'exit'],
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
