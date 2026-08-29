/**
 * Драбина: рука, що ходить сходинками. Фізика сходинок — у `callOpus.ts`,
 * тут — вирок каналу за вимірами і сам крок: setParameters миттєво, ptime —
 * окремою пропозицією.
 *
 * Рушій драбина не імпортує (не було б кола): все, що їй треба — доріжка,
 * знімок, patch — приходить ззовні крізь вузький `LadderDeps`.
 */

import { AUDIO_LEVELS, capSender, tuneOpus } from './callOpus';
import type { AudioLevel } from './callOpus';

/* ── пороги драбини ───────────────────────────────────────────────────── */

/** Втрати у відсотках, з яких канал уже не тримає поточну сходинку. */
const LOSS_BAD_PCT = 8;
const LOSS_GOOD_PCT = 2;
/** RTT, з якого розмова перестає бути розмовою. */
const RTT_BAD_MS = 500;
const RTT_GOOD_MS = 250;
/** Скільки поспіль поганих вимірів — і спускаємось. Два, щоб не смикатись. */
const BAD_SAMPLES_TO_DROP = 2;
/** А вгору — тільки після довгої тиші: 8 вимірів по 2 с це ті самі 15 с+. */
const GOOD_SAMPLES_TO_RISE = 8;

interface Rung {
  video: boolean;
  level: AudioLevel;
}

/** Те, що драбина читає зі знімка дзвінка. Решту знімка сюди не тягнемо. */
export interface LadderView {
  callId: string | null;
  outgoing: boolean;
  media: 'audio' | 'video';
  hasCamera: boolean;
  audioLevel: AudioLevel;
  ladderPinned: boolean;
  videoDropped: boolean;
  stats: { kbps: number | null } | null;
}

/** А це — те, що вона має право в знімок писати. */
export interface LadderPatch {
  audioLevel?: AudioLevel;
  ladderPinned?: boolean;
  videoDropped?: boolean;
  linkNote?: string | null;
}

export interface LadderStep {
  at: number;
  rung: string;
  kbpsBefore: number | null;
}

/** Руки рушія — рівно ті, без яких кроку не зробити. */
export interface LadderDeps {
  pc(): RTCPeerConnection | null;
  localStream(): MediaStream | null;
  view(): LadderView;
  patch(next: LadderPatch): void;
  /** Коротка звістка про канал не має висіти вічно — таймер живе в рушії. */
  armNote(): void;
  /** Доставити співрозмовнику нову пропозицію (переговори про ptime). */
  sendOffer(sdp: string | undefined): void;
}

export class OpusLadder {
  private readonly deps: LadderDeps;

  private badStreak = 0;
  private goodStreak = 0;
  /** Відправник відео памʼятаємо окремо: знявши доріжку, ми його вже не знайдемо. */
  private videoSender: RTCRtpSender | null = null;
  /** Останній вимір бітрейту перед сходинкою — доказ, що вона щось змінила. */
  private log: LadderStep[] = [];
  /** Втрати рахуємо як різницю за проміжок: сумарне число нічого не каже. */
  private lastLoss: { lost: number; received: number } | null = null;

  constructor(deps: LadderDeps) {
    this.deps = deps;
  }

  /** Історію стирає лише новий дзвінок: після завершення вона і є доказ. */
  newCall(): void {
    this.log = [];
    this.badStreak = 0;
    this.goodStreak = 0;
  }

  endCall(): void {
    this.badStreak = 0;
    this.goodStreak = 0;
  }

  /** Вимірювання перервалось — різниця від старого виміру була б брехнею. */
  resetLoss(): void {
    this.lastLoss = null;
  }

  /** Доріжку знесли — запамʼятований відправник показує в порожнечу. */
  dropSender(): void {
    this.videoSender = null;
  }

  /** Що драбина встигла зробити — для доказів, а не для екрана. */
  history(): LadderStep[] {
    return [...this.log];
  }

  /**
   * Сходинки від кращої до гіршої. Відео — окрема, найдорожча: на вузькому
   * каналі воно з'їдає все, а розмова живе голосом, не картинкою. Тому першим
   * ділом гине відео, і лише потім починає худнути звук.
   */
  private rungs(): Rung[] {
    const ladder: Rung[] = [];
    if (this.deps.view().hasCamera) ladder.push({ video: true, level: 'full' });
    AUDIO_LEVELS.forEach((level) => ladder.push({ video: false, level }));
    return ladder;
  }

  private rungIndex(): number {
    const ladder = this.rungs();
    const view = this.deps.view();
    const wantVideo = view.hasCamera && !view.videoDropped;
    const found = ladder.findIndex(
      (r) => r.video === wantVideo && r.level === view.audioLevel,
    );
    return found < 0 ? 0 : found;
  }

  private rungName(): string {
    const rung = this.rungs()[this.rungIndex()];
    return rung.video ? `відео+${rung.level}` : rung.level;
  }

  /** Ставить те, що вже записано в знімку, на живі доріжки. */
  async applyRung(): Promise<boolean> {
    const pc = this.deps.pc();
    if (!pc) return false;
    const senders = pc.getSenders();

    const video = senders.find((s) => s.track?.kind === 'video' || s === this.videoSender);
    if (video) {
      const view = this.deps.view();
      const want = view.hasCamera && !view.videoDropped;
      // replaceTrack(null), а не track.enabled=false: вимкнена доріжка все
      // одно жене чорні кадри в канал, а нам треба, щоб не йшло нічого.
      if (!want && video.track) {
        this.videoSender = video;
        try {
          await video.replaceTrack(null);
        } catch {
          /* не вийшло зняти — звук усе одно отримає свою стелю */
        }
      } else if (want && !video.track) {
        const track = this.deps.localStream()?.getVideoTracks()[0] ?? null;
        if (track) {
          try {
            await video.replaceTrack(track);
          } catch {
            /* камера могла вже зникнути */
          }
        }
      }
    }

    return capSender(
      senders.find((s) => s.track?.kind === 'audio'),
      this.deps.view().audioLevel,
    );
  }

  /**
   * Спуск або підйом на одну сходинку. Крок робиться `setParameters` —
   * миттєво і без переговорів. ptime так не змінити, тож для двох нижніх
   * сходинок пробуємо ще й нову пропозицію; не вийде — стеля бітрейту вже
   * стоїть, і саме її буде видно у вимірах.
   */
  private async step(delta: number, why: string): Promise<void> {
    const ladder = this.rungs();
    const next = Math.min(ladder.length - 1, Math.max(0, this.rungIndex() + delta));
    if (next === this.rungIndex()) return;

    this.badStreak = 0;
    this.goodStreak = 0;
    const view = this.deps.view();
    this.log.push({
      at: Date.now(),
      rung: `${this.rungName()} → ${ladder[next].video ? `відео+${ladder[next].level}` : ladder[next].level}`,
      kbpsBefore: view.stats?.kbps ?? null,
    });

    const target = ladder[next];
    this.deps.patch({
      audioLevel: target.level,
      videoDropped: !target.video && view.hasCamera,
      linkNote: why,
    });
    this.deps.armNote();
    await this.applyRung();
    if (delta > 0) void this.renegotiatePtime();
  }

  /**
   * Довгий ptime — головний виграш на вузькому каналі, але він живе тільки в
   * SDP. Пробуємо домовитись заново поверх тієї самої доріжки: ICE не
   * перезапускаємо, тож розмова не рветься. Пропонує лише той, хто набирав —
   * інакше дві пропозиції зустрілись би посередині і не встала б жодна.
   */
  private async renegotiatePtime(): Promise<void> {
    const pc = this.deps.pc();
    const view = this.deps.view();
    if (!pc || !view.callId || !view.outgoing) return;
    if (pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        type: 'offer',
        sdp: tuneOpus(offer.sdp ?? '', this.deps.view().audioLevel),
      });
      this.deps.sendOffer(pc.localDescription?.sdp);
    } catch {
      /* не домовились — стеля бітрейту вже діє, і це не привід валити дзвінок */
    }
  }

  /** Тест-хук і ручний режим: тримати сходинку силою, автоспуск не заважає. */
  async force(level: AudioLevel | 'video' | 'auto'): Promise<string> {
    if (level === 'auto') {
      this.deps.patch({ ladderPinned: false });
      return 'автоспуск увімкнено';
    }
    const ladder = this.rungs();
    const index =
      level === 'video'
        ? 0
        : ladder.findIndex((r) => !r.video && r.level === level);
    if (index < 0) return 'такої сходинки немає';
    const target = ladder[index];
    this.deps.patch({
      ladderPinned: true,
      audioLevel: target.level,
      videoDropped: !target.video && this.deps.view().hasCamera,
    });
    const applied = await this.applyRung();
    await this.renegotiatePtime();
    return applied ? `сходинка ${this.rungName()}` : `сходинка ${this.rungName()} (без setParameters)`;
  }

  /**
   * Один вимір — один вирок каналу, і за ним крок драбини.
   *
   * Втрати рахуємо ЗА ПРОМІЖОК, а не сумарні: сумарне число росте вічно й
   * після поганої хвилини назавжди виглядало б погано, навіть коли канал уже
   * вилікувався.
   */
  judgeLink(
    rttMs: number | null,
    packetsLost: number | null,
    packetsReceived: number,
  ): void {
    const prev = this.lastLoss;
    this.lastLoss = { lost: packetsLost ?? 0, received: packetsReceived };
    if (!prev) return;

    const lost = Math.max(0, (packetsLost ?? 0) - prev.lost);
    const got = Math.max(0, packetsReceived - prev.received);
    const total = lost + got;
    // Нічого не приїхало за проміжок — це не «0% втрат», це відсутність виміру.
    if (total === 0) return;
    const lossPct = (lost / total) * 100;

    const bad = lossPct >= LOSS_BAD_PCT || (rttMs !== null && rttMs >= RTT_BAD_MS);
    const good =
      lossPct <= LOSS_GOOD_PCT && rttMs !== null && rttMs <= RTT_GOOD_MS;

    if (bad) {
      this.goodStreak = 0;
      this.badStreak += 1;
    } else if (good) {
      this.badStreak = 0;
      this.goodStreak += 1;
    } else {
      this.badStreak = 0;
      this.goodStreak = 0;
    }

    if (this.deps.view().ladderPinned) return;

    if (this.badStreak >= BAD_SAMPLES_TO_DROP) {
      void this.step(
        1,
        `Канал просів — ${Math.round(lossPct)}% втрат. Тримаємо голос.`,
      );
    } else if (this.goodStreak >= GOOD_SAMPLES_TO_RISE) {
      void this.step(-1, 'Канал вирівнявся — повертаємо якість.');
    }
  }
}
