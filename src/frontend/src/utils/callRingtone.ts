/**
 * Голос дзвінка. Осцилятори, не файли.
 *
 * Вхідний — теплий двонотний мотив, що повторюється, поки слухавку не взяли
 * або не скинули. Вихідний — тихий гудок очікування, щоб тиша не читалась як
 * «нічого не сталось».
 *
 * Несучі осцилятори живуть увесь дзвінок, а пульси малює автоматизація
 * гучності. Так звук вимикається однією командою і — головне — ззовні видно,
 * чи він справді грає: `debug().oscillators` не блимає між ударами мотиву.
 */

type RingMode = 'idle' | 'incoming' | 'outgoing';

interface RingSpec {
  /** Несучі частоти, Гц. Перша — основна, решта тихіші. */
  freqs: number[];
  /** Довжина повного циклу, с. */
  period: number;
  /** Зсуви ударів усередині циклу, с. */
  pulses: number[];
  peak: number;
  attack: number;
  hold: number;
  release: number;
}

/** E4 + B4: чиста квінта, теплий сигнал без різкості будильника. */
const INCOMING: RingSpec = {
  freqs: [329.63, 493.88],
  period: 3.4,
  pulses: [0, 0.62],
  peak: 0.07,
  attack: 0.06,
  hold: 0.1,
  release: 0.5,
};

/** Гудок очікування: одна нота, довга, майже на межі чутності. */
const OUTGOING: RingSpec = {
  freqs: [415.3],
  period: 4,
  pulses: [0],
  peak: 0.022,
  attack: 0.12,
  hold: 0.75,
  release: 0.35,
};

/** Наскільки наперед розкладаємо удари, с. */
const LOOKAHEAD_S = 2;
const TICK_MS = 500;
/** Нуль для exponentialRamp — справжній нуль він не приймає. */
const SILENT = 0.0001;

export interface RingtoneDebug {
  mode: RingMode;
  contextState: string;
  oscillators: number;
}

class CallRingtone {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private spec: RingSpec | null = null;
  private mode: RingMode = 'idle';
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextCycleAt = 0;

  startIncoming(): void {
    this.start('incoming', INCOMING);
  }

  startOutgoing(): void {
    this.start('outgoing', OUTGOING);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.mode = 'idle';
    this.spec = null;

    const ctx = this.ctx;
    const master = this.master;
    const voices = this.voices;
    const gains = this.gains;
    this.voices = [];
    this.gains = [];
    this.master = null;
    if (!ctx) return;

    const now = ctx.currentTime;
    gains.forEach((g) => {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(SILENT, now);
      } catch {
        /* вузол уже від'єднаний */
      }
    });
    if (master) {
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.05);
      } catch {
        /* те саме */
      }
    }
    voices.forEach((osc) => {
      try {
        osc.stop(now + 0.06);
      } catch {
        /* уже спинений */
      }
    });
    // Від'єднуємо трохи згодом, щоб зріз не клацнув.
    setTimeout(() => {
      voices.forEach((osc) => {
        try {
          osc.disconnect();
        } catch {
          /* вже */
        }
      });
      gains.forEach((g) => {
        try {
          g.disconnect();
        } catch {
          /* вже */
        }
      });
      try {
        master?.disconnect();
      } catch {
        /* вже */
      }
    }, 120);
  }

  /** Те, що можна перевірити ззовні: який режим, чи живий контекст, скільки нот. */
  debug(): RingtoneDebug {
    return {
      mode: this.mode,
      contextState: this.ctx?.state ?? 'none',
      oscillators: this.voices.length,
    };
  }

  private start(mode: RingMode, spec: RingSpec): void {
    if (this.mode === mode) return;
    this.stop();

    const ctx = this.context();
    if (!ctx) return;
    // Без жесту людини контекст може бути приспаним. Будимо і кажемо правду
    // про стан у debug() — вигадувати «грає» тут не можна.
    if (ctx.state === 'suspended') void ctx.resume();

    const master = ctx.createGain();
    master.gain.setValueAtTime(1, ctx.currentTime);
    // М'який зріз верхів: без нього синус на 494 Гц усе одно дзвенить різкувато
    // на дешевих динаміках.
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.setValueAtTime(1600, ctx.currentTime);
    master.connect(warmth);
    warmth.connect(ctx.destination);

    spec.freqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(SILENT, ctx.currentTime);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      this.voices.push(osc);
      this.gains.push(gain);
    });

    this.master = master;
    this.spec = spec;
    this.mode = mode;
    this.nextCycleAt = ctx.currentTime + 0.08;
    this.scheduleAhead();
    this.timer = setInterval(() => this.scheduleAhead(), TICK_MS);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  private scheduleAhead(): void {
    const ctx = this.ctx;
    const spec = this.spec;
    if (!ctx || !spec) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    let guard = 0;
    while (this.nextCycleAt < horizon && guard < 32) {
      spec.pulses.forEach((offset) => this.pulse(this.nextCycleAt + offset, spec));
      this.nextCycleAt += spec.period;
      guard += 1;
    }
  }

  private pulse(at: number, spec: RingSpec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = Math.max(at, ctx.currentTime + 0.01);
    this.gains.forEach((gain, idx) => {
      const peak = spec.peak * (idx === 0 ? 1 : 0.5);
      try {
        gain.gain.setValueAtTime(SILENT, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + spec.attack);
        gain.gain.setValueAtTime(peak, t + spec.attack + spec.hold);
        gain.gain.exponentialRampToValueAtTime(
          SILENT,
          t + spec.attack + spec.hold + spec.release,
        );
      } catch {
        /* вузол уже знято — цикл добігає */
      }
    });
  }
}

export const callRingtone = new CallRingtone();

// Єдиний спосіб довести ззовні, що дзвінок справді звучить і справді стихає.
if (typeof window !== 'undefined') {
  (window as { __phantomCallAudio?: () => RingtoneDebug }).__phantomCallAudio = () =>
    callRingtone.debug();
}
