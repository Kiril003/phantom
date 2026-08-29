/**
 * Системні сповіщення — перемикач, який не бреше.
 *
 * Раніше він крутив лише власний колір. Тут він прив'язаний до єдиного, що
 * справді вирішує: дозволу браузера. Увімкнути можна тільки те, на що дозвіл
 * є; відмову людини перемикач показує як відмову, а не як «увімкнено».
 */

export type NotificationAccess = 'unsupported' | 'default' | 'granted' | 'denied';

export interface NotificationPrefsSnapshot {
  /** Чого хоче людина. Саме по собі це нічого не вмикає. */
  wanted: boolean;
  access: NotificationAccess;
  /** Чи покаже браузер банер насправді. */
  effective: boolean;
}

const KEY = 'phantom_system_notifications';

const readAccess = (): NotificationAccess => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationAccess;
};

const readWanted = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

class NotificationPrefs {
  private listeners = new Set<() => void>();
  private snapshot: NotificationPrefsSnapshot = this.compose(readWanted());

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): NotificationPrefsSnapshot => this.snapshot;

  /** Вмикання — це запит дозволу. Відмовили — перемикач лишається вимкненим. */
  async enable(): Promise<void> {
    if (readAccess() === 'unsupported') {
      this.publish(false);
      return;
    }
    let access = Notification.permission;
    if (access === 'default') {
      try {
        access = await Notification.requestPermission();
      } catch {
        access = Notification.permission;
      }
    }
    this.publish(access === 'granted');
  }

  disable(): void {
    this.publish(false);
  }

  /** Дозвіл могли змінити в налаштуваннях сайту, поки вкладка стояла відкритою. */
  sync(): void {
    this.publish(this.snapshot.wanted);
  }

  /** Показує банер, якщо є і бажання, і дозвіл. Повертає те, що вийшло. */
  show(title: string, options?: NotificationOptions): Notification | null {
    if (!this.compose(this.snapshot.wanted).effective) return null;
    try {
      return new Notification(title, options);
    } catch {
      return null;
    }
  }

  private compose(wanted: boolean): NotificationPrefsSnapshot {
    const access = readAccess();
    return { wanted, access, effective: wanted && access === 'granted' };
  }

  private publish(wanted: boolean): void {
    try {
      localStorage.setItem(KEY, wanted ? '1' : '0');
    } catch {
      /* сховище закрите — перемикач тоді живе лише цю сесію */
    }
    const next = this.compose(wanted);
    if (
      next.wanted === this.snapshot.wanted &&
      next.access === this.snapshot.access &&
      next.effective === this.snapshot.effective
    ) {
      return;
    }
    this.snapshot = next;
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        /* підписник упав — це не привід губити налаштування */
      }
    });
  }
}

export const notificationPrefs = new NotificationPrefs();
