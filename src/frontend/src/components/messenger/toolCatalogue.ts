import type { ToolId } from '@shared/types';

/**
 * Що простір може увімкнути.
 *
 * Тут ЛИШЕ те, що справді працює. Виміряно 01.09: із 57 модалок месенджера
 * 55 під замком — вони закриті саме тому, що вигадують дані. Переносити їх
 * у простори означало б перенести вигадку, лише охайніше розкладену.
 *
 * Тож інструмент простору — це віджет, який людина вставляє в розмову й
 * заповнює сама.
 */
export interface ToolDef {
  id: ToolId;
  label: string;
  /** Одним рядком: що людина отримає, натиснувши. */
  hint: string;
}

export const TOOL_CATALOGUE: readonly ToolDef[] = [
  { id: 'kanban', label: 'Дошка', hint: 'Колонки завдань — картки додаєте ви' },
  { id: 'tasks', label: 'Список справ', hint: 'Пункти з відмітками' },
  { id: 'timeline', label: 'Таймлайн', hint: 'Віхи з датами' },
  { id: 'voting', label: 'Опитування', hint: 'Питання й варіанти на вибір' },
  { id: 'raci', label: 'Відповідальні', hint: 'Матриця ролей за роботами' },
  { id: 'code', label: 'Код', hint: 'Фрагмент із підсвіткою; JS запускається' },
  { id: 'diagram', label: 'Схема', hint: 'Діаграма з тексту (Mermaid)' },
  { id: 'diff', label: 'Різниця', hint: 'Порівняння двох версій тексту' },
  { id: 'files', label: 'Файли', hint: 'Вкладення розмови' },
  { id: 'location', label: 'Місце', hint: 'Точка на мапі' },
  { id: 'calls', label: 'Дзвінки', hint: 'Голос і відео — потрібен вузол зв’язку' },
  { id: 'notes', label: 'Нотатки', hint: 'Записи, видимі лише учасникам' },
  { id: 'calendar', label: 'Події', hint: 'Зустрічі з часом і учасниками' },
  { id: 'photos', label: 'Світлини', hint: 'Спільна стрічка зображень' },
  { id: 'contacts', label: 'Контакти', hint: 'Люди простору з ролями' },
] as const;

const BY_ID = new Map(TOOL_CATALOGUE.map((t) => [t.id, t]));

export const toolDef = (id: ToolId): ToolDef | undefined => BY_ID.get(id);

/** Невідомий інструмент не ховаємо: простір міг прийти з новішої збірки. */
export const toolLabel = (id: ToolId): string => BY_ID.get(id)?.label ?? id;
