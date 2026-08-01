export type ComposerSend = (text: string) => boolean;

/** The operator's line on the Film: type, send, and see what the socket is doing. */
export class Composer {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLDivElement;
  private link = '';
  private waiting = false;

  constructor(parent: HTMLElement, private readonly send: ComposerSend) {
    this.root = document.createElement('div');
    this.root.className = 'composer';
    this.root.hidden = true;

    this.input = document.createElement('input');
    this.input.className = 'composer-line';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Спитай, познач, поклич…';
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.submit();
    });

    this.note = document.createElement('div');
    this.note.className = 'composer-note';

    this.root.append(this.input, this.note);
    parent.appendChild(this.root);
  }

  show(): void {
    this.root.hidden = false;
    this.input.focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.waiting = false;
    this.render();
  }

  /** Socket-level truth: shown whenever it is not the plain 'open' silence. */
  setLink(text: string): void {
    this.link = text;
    this.render();
  }

  answered(): void {
    this.waiting = false;
    this.render();
  }

  failed(text: string): void {
    this.waiting = false;
    this.link = text;
    this.render();
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text || this.waiting) return;
    if (!this.send(text)) {
      this.link = 'Не відправив — звʼязку з ядром немає.';
      this.render();
      return;
    }
    this.input.value = '';
    this.waiting = true;
    this.render();
  }

  private render(): void {
    this.root.dataset.waiting = this.waiting ? 'yes' : 'no';
    this.note.textContent = this.link || (this.waiting ? 'Чекаю на відповідь…' : '');
  }
}
