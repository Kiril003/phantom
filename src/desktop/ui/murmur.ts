export type MurmurVoice = 'entity' | 'system';

export interface Murmur {
  text: string;
  voice: MurmurVoice;
}

export const CONDENSE_MS = 400;
export const REST_MS = 8_000;
export const EVAPORATE_MS = 400;

/**
 * Murmurs never stack (§3.3). One shows at a time; while one lives, arrivals
 * queue. If the queue deepens past two, the backlog collapses into the one
 * truest sentence and the detail stays in PULSE.
 */
export class MurmurQueue {
  private pending: Murmur[] = [];

  push(m: Murmur): void {
    this.pending.push(m);
    if (this.pending.length > 2) {
      const n = this.pending.length;
      this.pending = [
        {
          text: `${n} речей сталися, поки ти не дивився — все в пам'яті.`,
          voice: 'entity',
        },
      ];
    }
  }

  next(): Murmur | null {
    return this.pending.shift() ?? null;
  }

  get depth(): number {
    return this.pending.length;
  }
}

/** Renders the queue near the Sigil: condense → rest → evaporate → next. */
export class MurmurLane {
  private readonly queue = new MurmurQueue();
  private readonly node: HTMLDivElement;
  private live = false;

  constructor(root: HTMLElement) {
    this.node = document.createElement('div');
    this.node.className = 'murmur';
    root.appendChild(this.node);
  }

  murmur(text: string, voice: MurmurVoice): void {
    this.queue.push({ text, voice });
    if (!this.live) this.exhale();
  }

  private exhale(): void {
    const m = this.queue.next();
    if (!m) {
      this.live = false;
      return;
    }
    this.live = true;
    this.node.textContent = m.text;
    this.node.className = `murmur voice-${m.voice}`;
    requestAnimationFrame(() => this.node.classList.add('visible'));
    setTimeout(() => {
      this.node.classList.remove('visible');
      setTimeout(() => this.exhale(), EVAPORATE_MS);
    }, CONDENSE_MS + REST_MS);
  }
}
