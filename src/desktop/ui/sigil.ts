import { SystemState } from '../../shared/types/system';

/** The Sigil — the point of presence. A face, not an icon (§3.1). */
export class Sigil {
  private readonly node: HTMLDivElement;
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.node = document.createElement('div');
    this.node.className = 'sigil';
    root.appendChild(this.node);
  }

  /** Accent + rhythm follow SystemState via `data-state` tokens. */
  setState(state: SystemState): void {
    document.documentElement.dataset.state = state.toLowerCase();
  }

  /** One ripple of acknowledged aliveness, then stillness (§8.3). */
  pulse(): void {
    if (this.pulseTimer) return;
    this.node.classList.add('pulse');
    this.pulseTimer = setTimeout(() => {
      this.node.classList.remove('pulse');
      this.pulseTimer = null;
    }, 900);
  }

  /** ANIMA labor sheds a mote drifting up the screen edge. */
  spark(): void {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.right = `${14 + Math.round(Math.random() * 10)}px`;
    s.style.bottom = `${24 + Math.round(Math.random() * 16)}px`;
    this.node.parentElement?.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }

  /** Graceful absence (§9): presence pales, breath slows to 16s. */
  setAbsent(absent: boolean): void {
    this.node.classList.toggle('absent', absent);
  }
}
