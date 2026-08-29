/**
 * Акцент месенджера — вибір, який справді перефарбовує екран.
 *
 * До цього «Шавлія» міняла лише обведення власної кнопки: теракота записана
 * шістнадцятковим числом просто в розмітці, у ~350 місцях тридцяти файлів, і
 * жоден із них про вибір не знав. Тут вибір чіпляє на <html> атрибут, а
 * messenger.css перевизначає під нього ті самі утиліти Tailwind — одним
 * місцем замість тридцяти файлів. Теракота атрибута не ставить, тож типовий
 * вигляд лишається піксель-у-піксель тим самим.
 */

export type MessengerAccent = 'terracotta' | 'sage' | 'chestnut' | 'amber';

/** Зразки для палітри в налаштуваннях: кружечок мусить показувати той колір,
 *  який справді ввімкнеться. Значення дублюються в messenger.css як токени. */
export const MESSENGER_ACCENTS: ReadonlyArray<{
  id: MessengerAccent;
  label: string;
  color: string;
}> = [
  { id: 'terracotta', label: 'Теракота', color: '#E87A42' },
  { id: 'sage', label: 'Шавлія', color: '#5B8C67' },
  { id: 'chestnut', label: 'Каштан', color: '#8A5333' },
  { id: 'amber', label: 'Бурштин', color: '#D97706' },
];

const KEY = 'phantom_msg_accent';
const ATTR = 'data-msg-accent';

const isAccent = (v: string | null): v is MessengerAccent =>
  MESSENGER_ACCENTS.some((a) => a.id === v);

const read = (): MessengerAccent => {
  try {
    const stored = localStorage.getItem(KEY);
    return isAccent(stored) ? stored : 'terracotta';
  } catch {
    return 'terracotta';
  }
};

const paint = (value: MessengerAccent): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (value === 'terracotta') root.removeAttribute(ATTR);
  else root.setAttribute(ATTR, value);
};

class Accent {
  private listeners = new Set<() => void>();
  private snapshot: MessengerAccent = read();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): MessengerAccent => this.snapshot;

  set = (value: MessengerAccent): void => {
    this.snapshot = value;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Приватний режим забороняє запис — відтінок лишається на цю сесію.
    }
    paint(value);
    this.listeners.forEach((cb) => cb());
  };
}

export const messengerAccent = new Accent();

// Вибір мусить пережити F5, інакше це знову декорація.
paint(messengerAccent.getSnapshot());
