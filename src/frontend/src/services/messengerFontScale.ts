/**
 * Кегль месенджера — перемикач, який справді рухає пікселі.
 *
 * До цього «Збільшений (16-17px)» крутив лише власний колір: корінь лишався
 * 15px, список 14px, і вибір не переживав перезавантаження. Тут він чіпляє на
 * <html> атрибут, а шість токенів шкали (--t-micro … --t-display) у
 * messenger.css перевизначаються під нього. Через .messenger-scale ці токени
 * годують геть усю розмітку месенджера — і бульбашки, і список бесід, — тож
 * одне перемикання рухає обидва.
 */

export type MessengerFontScale = 'standard' | 'large';

const KEY = 'phantom_msg_font';
const ATTR = 'data-msg-font';

const read = (): MessengerFontScale => {
  try {
    return localStorage.getItem(KEY) === 'large' ? 'large' : 'standard';
  } catch {
    return 'standard';
  }
};

const paint = (value: MessengerFontScale): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (value === 'large') root.setAttribute(ATTR, 'large');
  else root.removeAttribute(ATTR);
};

class FontScale {
  private listeners = new Set<() => void>();
  private snapshot: MessengerFontScale = read();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): MessengerFontScale => this.snapshot;

  set = (value: MessengerFontScale): void => {
    this.snapshot = value;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Приватний режим забороняє запис — кегль лишається на цю сесію.
    }
    paint(value);
    this.listeners.forEach((cb) => cb());
  };
}

export const messengerFontScale = new FontScale();

// Вибір мусить пережити F5, інакше це знову декорація.
paint(messengerFontScale.getSnapshot());
