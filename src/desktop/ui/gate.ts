import {
  AuthConfig,
  PickerUser,
  fetchAuthConfig,
  fetchPicker,
  loginPin,
} from './session';

export interface Signed {
  token: string;
  username: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} хв`;
}

/**
 * The one surface that asks the operator for something. A PIN is who you are,
 * not how the machine is wired — nothing here configures the backend.
 */
export class Gate {
  private readonly root: HTMLDivElement;
  private readonly tiles: HTMLDivElement;
  private readonly pin: HTMLInputElement;
  private readonly note: HTMLDivElement;
  private readonly retry: HTMLButtonElement;
  private readonly form: HTMLDivElement;

  private cfg: AuthConfig = { maxPinAttempts: 5, lockoutMinutes: 15 };
  private chosen: string | null = null;
  private failures = 0;
  private busy = false;
  private done: ((s: Signed) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'gate');
    this.root.hidden = true;

    const panel = el('div', 'gate-panel');
    panel.appendChild(el('div', 'gate-mark', 'PHANTOM'));
    panel.appendChild(el('div', 'gate-ask', 'Хто за пультом?'));

    this.tiles = el('div', 'gate-tiles');
    panel.appendChild(this.tiles);

    this.form = el('div', 'gate-form');
    this.form.hidden = true;
    this.pin = document.createElement('input');
    this.pin.className = 'gate-pin';
    this.pin.type = 'password';
    this.pin.inputMode = 'numeric';
    this.pin.autocomplete = 'off';
    this.pin.maxLength = 32;
    this.pin.placeholder = 'PIN';
    this.pin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit();
      }
    });
    this.form.appendChild(this.pin);
    panel.appendChild(this.form);

    this.note = el('div', 'gate-note');
    panel.appendChild(this.note);

    this.retry = document.createElement('button');
    this.retry.className = 'gate-retry';
    this.retry.textContent = 'Спробувати знову';
    this.retry.hidden = true;
    this.retry.addEventListener('click', () => void this.load());
    panel.appendChild(this.retry);

    this.root.appendChild(panel);
    parent.appendChild(this.root);
  }

  open(): Promise<Signed> {
    this.root.hidden = false;
    this.failures = 0;
    void this.load();
    return new Promise<Signed>((resolve) => {
      this.done = resolve;
    });
  }

  private close(signed: Signed): void {
    this.root.hidden = true;
    this.pin.value = '';
    const done = this.done;
    this.done = null;
    done?.(signed);
  }

  private say(text: string, tone: 'calm' | 'warn' = 'calm'): void {
    this.note.textContent = text;
    this.note.dataset.tone = tone;
  }

  private async load(): Promise<void> {
    this.retry.hidden = true;
    this.tiles.replaceChildren();
    this.say('Шукаю ядро…');
    const [users, cfg] = await Promise.all([fetchPicker(), fetchAuthConfig()]);
    this.cfg = cfg;

    if (users === null) {
      this.form.hidden = true;
      this.say('Ядро не відповідає на 127.0.0.1:8000 — воно не запущене.', 'warn');
      this.retry.hidden = false;
      return;
    }
    if (users.length === 0) {
      this.form.hidden = true;
      this.say('На цьому ядрі немає жодного профілю.', 'warn');
      this.retry.hidden = false;
      return;
    }

    for (const u of users) this.tiles.appendChild(this.tile(u));
    this.choose(users[0].username);
    this.say('');
  }

  private tile(u: PickerUser): HTMLElement {
    const b = document.createElement('button');
    b.className = 'gate-tile';
    b.dataset.username = u.username;
    b.appendChild(el('span', 'gate-face', u.username.slice(0, 1).toUpperCase()));
    b.appendChild(el('span', 'gate-name', u.username));
    b.addEventListener('click', () => this.choose(u.username));
    return b;
  }

  private choose(username: string): void {
    this.chosen = username;
    for (const node of Array.from(this.tiles.children)) {
      const tile = node as HTMLElement;
      tile.classList.toggle('chosen', tile.dataset.username === username);
    }
    this.form.hidden = false;
    this.pin.value = '';
    this.pin.focus();
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.chosen) return;
    const pin = this.pin.value.trim();
    if (!pin) {
      this.say('Введи PIN.', 'warn');
      return;
    }

    this.busy = true;
    this.root.dataset.busy = 'yes';
    this.say('Входжу…');
    const res = await loginPin(this.chosen, pin);
    this.busy = false;
    delete this.root.dataset.busy;

    if (res.ok) {
      this.say('');
      this.close({ token: res.token, username: res.username });
      return;
    }

    this.pin.value = '';
    this.pin.focus();

    switch (res.kind) {
      case 'offline':
        this.say('Ядро не відповідає на 127.0.0.1:8000 — воно не запущене.', 'warn');
        break;
      case 'locked':
        this.say(`Вхід замкнено. Спробуй за ${minutes(res.seconds)}.`, 'warn');
        break;
      case 'wrong': {
        this.failures += 1;
        const left = this.cfg.maxPinAttempts - this.failures;
        this.say(
          left > 0
            ? `Не той PIN. Лишилось спроб: ${left} — далі вхід замкнеться на ${this.cfg.lockoutMinutes} хв.`
            : `Не той PIN. Вхід замкнено на ${this.cfg.lockoutMinutes} хв.`,
          'warn',
        );
        break;
      }
      default:
        this.say(res.detail || 'Ядро відмовило у вході.', 'warn');
    }
  }
}
