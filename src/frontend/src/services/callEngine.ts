/**
 * Дзвінок 1:1 — справжній: getUserMedia, RTCPeerConnection, ICE.
 *
 * Медіа йде між браузерами напряму (DTLS-SRTP), вузол його не бачить і не
 * може бачити. Вузол переносить лише SDP і кандидатів — див.
 * `api/routes_calls.py`. Тому все, що тут показано як «дзвінок», або справді
 * зʼєдналось, або чесно каже, що ні: жоден стан не малюється наперед.
 *
 * РЕТРАНСЛЯТОР. Коли прямої дороги немає, медіа їде через TURN — і змінюється
 * тільки маршрут: ключі лишаються в браузерах, тож ретранслятор возить той
 * самий шифротекст, якого не розуміє. Список доріг питаємо у вузла
 * (`GET /messenger/ice`): TURN належить вузлу, і його наявність — факт із
 * відповіді, а не константа в збірці.
 *
 * Таймер починає рахувати не з натискання кнопки, а з моменту, коли
 * з'єднання перейшло в `connected` — інакше він рахував би очікування.
 * Статистика береться з `getStats()`; поки перший вимір не прийшов, її немає,
 * і показувати замість неї щось правдоподібне не можна.
 *
 * ДРАБИНА. Канал не буває «є» або «нема» — він буває різний, і дзвінок має
 * спускатися, а не вмирати. Сходинки: відео → повний звук → економний →
 * вузький (див. `callOpus.ts`, там же й фізика). Спуск робить `setParameters`
 * на відправнику — це діє миттєво і не чіпає ані ICE, ані DTLS, тож розмова
 * не переривається. ptime живе в SDP і без нової пропозиції не змінюється;
 * рушій пробує її дотягнути окремо і не вдає, що вийшло, якщо не вийшло.
 * Механіка кроків — у `callLadder.ts`.
 *
 * РАЦІЯ. Коли доріжки немає зовсім, дзвінок не завершується: голос переходить
 * на кадри листування (`callRadio.ts`). Це остання сходинка драбини, а не
 * окремий режим — тому кнопка «Завершити» лишається тією ж, а розмова тією ж.
 */

import { request } from './api';
import { wsClient } from './websocket';
import { tuneOpus } from './callOpus';
import type { AudioLevel } from './callOpus';
import { OpusLadder } from './callLadder';
import type { LadderStep } from './callLadder';
import { RadioLink } from './callRadio';
import type { RadioTally } from './callRadio';

const STATS_PERIOD_MS = 2000;
/** Скільки триматися на екрані після завершення, перш ніж зникнути. */
const ENDED_LINGER_MS = 2600;
/** Скільки чекати зʼєднання, перш ніж сказати людині правду замість «набираю…». */
const STALL_AFTER_MS = 8000;

/** Скільки триматися в `disconnected`, перш ніж визнати доріжку мертвою. */
const DEAD_LINK_MS = 10000;
/** Як часто з рації пробувати повернутись у реальний час. */
const REVIVE_PERIOD_MS = 20000;

/**
 * Дороги для медіа. STUN лише повідомляє браузеру його зовнішню адресу;
 * провести медіа крізь симетричний NAT він не може — це робить тільки TURN.
 * Список приходить від вузла (`GET /messenger/ice`), бо ретранслятор належить
 * вузлу, а не збірці: у власника він є, у сусіда може не бути.
 */
interface IceConfig {
  iceServers: RTCIceServer[];
  /** Чи є в списку ретранслятор. Прапорець від вузла, а не здогад із urls. */
  turn: boolean;
  /** Скільки секунд живе видана пара креденшелів. 0 — пари немає. */
  ttl: number;
}

const STUN_ONLY: IceConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
  turn: false,
  ttl: 0,
};

/** Як часто перепитувати вузол, коли ретранслятора в нього немає. */
const NO_TURN_RETRY_MS = 60_000;

/**
 * Чи має цей вузол ретранслятор. Живе від відповіді `/ice` — тобто від факту,
 * а не від константи в коді: підняли TURN на вузлі, і тексти нижче змінились
 * самі, без нової збірки.
 */
let hasTurn = false;

/**
 * Що показати, коли доріжка не встає, хоч співрозмовник уже відповів. Без TURN
 * це не «щось підвисло», а відома межа вузла, і людина має почути саме її.
 * З TURN казати це було б брехнею — тож текст залежить від виміряного стану.
 */
export const linkStallNote = (): string =>
  hasTurn
    ? 'Не вдається зʼєднатися напряму. Пробуємо через ретранслятор — це може зайняти ще кілька секунд.'
    : 'Не вдається зʼєднатися напряму. Без TURN-сервера дзвінок за суворим NAT неможливий — це відома межа поточної версії.';

/**
 * А це — інша біда, і плутати їх не можна: відповіді ще не було, тож про
 * доріжку ми поки нічого не знаємо і валити все на TURN не маємо права.
 */
export const NO_ANSWER_NOTE =
  'Співрозмовник не бере слухавку. Дзвінок доїхав до його вузла, але відповіді ще немає.';

/** Чому дзвінок стоїть: `no-answer` — не відповіли, `no-path` — немає дороги. */
export interface CallStall {
  kind: 'no-answer' | 'no-path';
  note: string;
}

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ended';
export type CallMedia = 'audio' | 'video';

export interface CallPeer {
  contactId?: string;
  peerNodeId?: string;
  displayName: string;
  /** Чи звірили число безпеки. null — вузол цього не сказав. */
  verified?: boolean | null;
}

/** Виміряне, не оцінене. null означає «ще не міряли», а не нуль. */
export interface CallStats {
  rttMs: number | null;
  packetsLost: number | null;
  audioCodec: string | null;
  videoCodec: string | null;
  kbps: number | null;
  /**
   * Тип пари кандидатів, якою реально йде медіа: host — те саме LAN,
   * srflx — крізь NAT по STUN, relay — через TURN. Саме це число каже,
   * чи встане такий самий дзвінок поза локальною мережею.
   */
  localCandidate: string | null;
  remoteCandidate: string | null;
}

export interface CallSnapshot {
  state: CallState;
  callId: string | null;
  peer: CallPeer | null;
  media: CallMedia;
  /** true — ми набрали; false — набрали нас. */
  outgoing: boolean;
  micOn: boolean;
  cameraOn: boolean;
  /** Чи є в цьому дзвінку відеодоріжка взагалі. */
  hasCamera: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Мілісекунди епохи, коли доріжка справді відкрилась. */
  startedAt: number | null;
  stats: CallStats | null;
  /** Чому все скінчилось: словами, які можна показати людині. */
  endedReason: string | null;
  /** Зʼєднання не встало за відведений час — час сказати причину вголос. */
  stall: CallStall | null;
  /** На якій сходинці звук просто зараз. */
  audioLevel: AudioLevel;
  /** Сходинку тримає рука (тест-хук), а не вимір — автоспуск вимкнено. */
  ladderPinned: boolean;
  /** Відеодоріжку зняли, щоб урятувати звук. */
  videoDropped: boolean;
  /** null — рація не потрібна. Не null — розмова йде кадрами. */
  radio: RadioTally | null;
  /** Чому ми в рації, словами для людини. */
  radioReason: string | null;
  /** Коротка звістка про канал: «Канал відновлено» і подібне. */
  linkNote: string | null;
}

interface SignalResult {
  delivered: boolean;
  call_id: string;
  detail: string;
}

interface CallFrame {
  channel: string;
  type: string;
  data: {
    call_id?: string;
    kind?: string;
    from_node_id?: string;
    contact_id?: string;
    display_name?: string;
    verified?: boolean;
    sdp?: string | null;
    candidate?: RTCIceCandidateInit | null;
    media?: string | null;
    reason?: string | null;
    /** Тільки для kind='radio': номер шматка і сам звук. */
    seq?: number;
    audio_b64?: string;
  };
}

const IDLE: CallSnapshot = {
  state: 'idle',
  callId: null,
  peer: null,
  media: 'audio',
  outgoing: false,
  micOn: true,
  cameraOn: false,
  hasCamera: false,
  localStream: null,
  remoteStream: null,
  startedAt: null,
  stats: null,
  endedReason: null,
  stall: null,
  audioLevel: 'full',
  ladderPinned: false,
  videoDropped: false,
  radio: null,
  radioReason: null,
  linkNote: null,
};

const newCallId = (): string =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

class CallEngine {
  private snapshot: CallSnapshot = IDLE;
  private listeners = new Set<() => void>();

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private offWs: (() => void) | null = null;

  /** Кандидати, що прилетіли раніше, ніж зʼявилось куди їх класти. */
  private pendingIce: RTCIceCandidateInit[] = [];
  /** Пропозиція чекає, поки людина візьме слухавку. */
  private pendingOffer: string | null = null;
  /** Попередній вимір — щоб порахувати бітрейт як різницю, а не як здогад. */
  private lastBytes: { at: number; bytes: number } | null = null;
  /** Чи озвалась інша сторона. Без цього «немає дороги» — це здогад, не факт. */
  private answered = false;
  /** Дороги від вузла і мить, до якої їм можна вірити. */
  private ice: { config: IceConfig; until: number } | null = null;

  /* ── драбина ────────────────────────────────────────────────────────── */

  /** Драбині даємо руки, а не рушій — щоб не було кола імпортів. */
  private readonly ladder = new OpusLadder({
    pc: () => this.pc,
    localStream: () => this.localStream,
    view: () => this.snapshot,
    patch: (next) => this.patch(next),
    armNote: () => this.armNote(),
    sendOffer: (sdp) => {
      const callId = this.snapshot.callId;
      if (!callId) return;
      void this.post('offer', callId, { sdp, media: this.snapshot.media });
    },
  });

  /* ── рація ──────────────────────────────────────────────────────────── */

  private radio: RadioLink | null = null;
  private deadLinkTimer: ReturnType<typeof setTimeout> | null = null;
  private reviveTimer: ReturnType<typeof setInterval> | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── підписка ───────────────────────────────────────────────────────── */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): CallSnapshot => this.snapshot;

  private patch(next: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        /* підписник упав — це не привід валити дзвінок */
      }
    });
  }

  /** Вмикає слухання сигналів із вузла. Повертає функцію відписки. */
  attach(): () => void {
    if (this.offWs) return this.offWs;
    const off = wsClient.on('call', (msg) => {
      void this.onSignal(msg as unknown as CallFrame);
    });
    this.offWs = () => {
      off();
      this.offWs = null;
    };
    return this.offWs;
  }

  /* ── вихідний дзвінок ───────────────────────────────────────────────── */

  async startCall(peer: CallPeer, media: CallMedia = 'audio'): Promise<void> {
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'ended') return;
    this.clearLinger();
    this.answered = false;
    this.ladder.newCall();

    const callId = newCallId();
    this.patch({
      ...IDLE,
      state: 'calling',
      callId,
      peer,
      media,
      outgoing: true,
    });

    let stream: MediaStream;
    try {
      stream = await this.grabMedia(media);
    } catch (err) {
      this.finish(this.mediaError(err));
      return;
    }

    const pc = this.buildPeerConnection(callId, await this.iceConfig());
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: media === 'video',
      });
      // FEC і DTX треба поставити ДО setLocalDescription: після нього опис уже
      // не змінити, а домовлятись про них посеред розмови нема як.
      await pc.setLocalDescription({
        type: 'offer',
        sdp: tuneOpus(offer.sdp ?? '', this.snapshot.audioLevel),
      });
      const result = await this.post('offer', callId, {
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        media,
      });
      if (!result.delivered) {
        this.finish(result.detail || 'вузол співрозмовника не прийняв дзвінок');
        return;
      }
      // Пропозиція пішла — з цієї миті мовчання означає проблему зі звʼязком.
      this.armStall(callId);
    } catch (err) {
      this.finish(this.plainError(err, 'не вдалося скласти пропозицію'));
    }
  }

  /* ── вхідний дзвінок ────────────────────────────────────────────────── */

  async accept(): Promise<void> {
    if (this.snapshot.state !== 'ringing' || !this.pendingOffer) return;
    const callId = this.snapshot.callId;
    if (!callId) return;

    const offerSdp = this.pendingOffer;
    this.pendingOffer = null;
    // Пропозиція в руках — інша сторона точно на звʼязку.
    this.answered = true;
    // Слухавку взято — «вхідний дзвінок» із кнопкою «Прийняти» з цієї миті
    // був би брехнею. ICE ще попереду, тож і «розмова йде» — теж.
    this.patch({ state: 'connecting' });

    let stream: MediaStream;
    try {
      stream = await this.grabMedia(this.snapshot.media);
    } catch (err) {
      void this.post('hangup', callId, { reason: 'no-media' });
      this.finish(this.mediaError(err));
      return;
    }

    const pc = this.buildPeerConnection(callId, await this.iceConfig());
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({
        type: 'answer',
        sdp: tuneOpus(answer.sdp ?? '', this.snapshot.audioLevel),
      });
      await this.drainIce();
      const result = await this.post('answer', callId, {
        sdp: pc.localDescription?.sdp ?? answer.sdp,
      });
      if (!result.delivered) {
        this.finish(result.detail || 'відповідь не доїхала до співрозмовника');
        return;
      }
      // Той, хто взяв слухавку, чекає на зʼєднання так само — і має право
      // почути ту саму правду, якщо воно не встає.
      this.armStall(callId);
    } catch (err) {
      this.finish(this.plainError(err, 'не вдалося прийняти дзвінок'));
    }
  }

  decline(): void {
    if (this.snapshot.state !== 'ringing') return;
    const callId = this.snapshot.callId;
    if (callId) void this.post('hangup', callId, { reason: 'declined' });
    this.finish('відхилено');
  }

  hangup(): void {
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'ended') return;
    const callId = this.snapshot.callId;
    if (callId) void this.post('hangup', callId, { reason: 'hangup' });
    this.finish('завершено');
  }

  /* ── мікрофон і камера ──────────────────────────────────────────────── */

  toggleMic(): void {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const on = !this.snapshot.micOn;
    tracks.forEach((t) => {
      t.enabled = on;
    });
    this.patch({ micOn: on });
  }

  toggleCamera(): void {
    const tracks = this.localStream?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const on = !this.snapshot.cameraOn;
    tracks.forEach((t) => {
      t.enabled = on;
    });
    this.patch({ cameraOn: on });
  }

  /* ── сигнали з вузла ────────────────────────────────────────────────── */

  private async onSignal(msg: CallFrame): Promise<void> {
    const data = msg?.data;
    const kind = data?.kind ?? msg?.type?.replace('call:', '');
    const callId = data?.call_id;
    if (!kind || !callId) return;

    if (kind === 'offer') {
      await this.onOffer(callId, data);
      return;
    }

    // Усе інше стосується лише того дзвінка, який зараз іде.
    if (callId !== this.snapshot.callId) return;

    if (kind === 'radio') {
      // Рацію слухаємо ЗАВЖДИ під час дзвінка. Інша сторона могла помітити
      // смерть доріжки раніше за нас — її голос має бути чутно вже зараз, а
      // не після того, як наш власний сторож дозріє.
      if (!this.radio) await this.enterRadio('співрозмовник перейшов на рацію');
      void this.radio?.receive(Number(data.seq ?? 0), String(data.audio_b64 ?? ''));
      return;
    }

    if (kind === 'answer' && data.sdp) {
      const pc = this.pc;
      // Відповідь на пропозицію, якої ми вже не чекаємо (переговори про ptime
      // розминулись із перебудовою) — це не помилка, а запізнілий лист.
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        this.answered = true;
        await this.drainIce();
      } catch (err) {
        if (!this.radio) this.finish(this.plainError(err, 'відповідь співрозмовника не прийнялась'));
      }
      return;
    }

    if (kind === 'ice' && data.candidate) {
      await this.addIce(data.candidate);
      return;
    }

    if (kind === 'hangup') {
      this.finish(data.reason === 'declined' ? 'співрозмовник відхилив' : 'співрозмовник поклав слухавку');
    }
  }

  private async onOffer(callId: string, data: CallFrame['data']): Promise<void> {
    // Пропозиція під номером дзвінка, який уже йде, — це не другий дзвінок, а
    // ті самі переговори: новий ptime або спроба підняти доріжку з рації.
    if (callId === this.snapshot.callId && this.snapshot.state !== 'idle' && data.sdp) {
      await this.onReoffer(callId, data.sdp);
      return;
    }
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'ended') {
      // Уже в розмові — другий дзвінок не тримаємо мовчки в черзі, а чесно
      // відмовляємо, щоб той, хто набирає, побачив це одразу.
      const busy: CallPeer = { peerNodeId: data.from_node_id, displayName: '' };
      void this.postTo(busy, 'hangup', callId, { reason: 'busy' });
      return;
    }
    if (!data.sdp) return;

    this.clearLinger();
    this.answered = false;
    this.pendingOffer = data.sdp;
    this.pendingIce = [];
    this.patch({
      ...IDLE,
      state: 'ringing',
      callId,
      media: data.media === 'video' ? 'video' : 'audio',
      outgoing: false,
      peer: {
        contactId: data.contact_id,
        peerNodeId: data.from_node_id,
        displayName: data.display_name || 'Невідомий вузол',
        verified: data.verified ?? null,
      },
    });
  }

  /**
   * Ті самі переговори поверх того самого дзвінка. Доріжки може вже не бути
   * зовсім (нас витягують із рації) — тоді будуємо її заново, але номер
   * дзвінка, розмова й таймер лишаються ті самі.
   */
  private async onReoffer(callId: string, sdp: string): Promise<void> {
    let pc = this.pc;
    if (!pc || pc.connectionState === 'closed') {
      const stream = this.localStream;
      if (!stream) return;
      this.teardownPc();
      pc = this.buildPeerConnection(callId, await this.iceConfig());
      stream.getTracks().forEach((track) => {
        if (track.kind === 'video' && this.snapshot.videoDropped) return;
        pc?.addTrack(track, stream);
      });
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({
        type: 'answer',
        sdp: tuneOpus(answer.sdp ?? '', this.snapshot.audioLevel),
      });
      await this.drainIce();
      await this.post('answer', callId, { sdp: pc.localDescription?.sdp });
    } catch {
      // Переговори не склались — те, що вже працює (рація або стара доріжка),
      // від цього не зупиняється.
    }
  }

  /* ── нутрощі ────────────────────────────────────────────────────────── */

  private async grabMedia(media: CallMedia): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === 'video',
    });
    this.localStream = stream;
    const hasCamera = stream.getVideoTracks().length > 0;
    this.patch({ localStream: stream, hasCamera, cameraOn: hasCamera, micOn: true });
    return stream;
  }

  /**
   * Дороги питаємо у вузла, а не вигадуємо. Креденшели ретранслятора живуть
   * годину, тож тримаємо їх у пам'яті пів цього часу: пара, видана зараз,
   * точно переживе дзвінок, який починається зараз. Вузол не відповів —
   * лишається STUN: у тій самій мережі дзвінок від цього не постраждає.
   */
  private async iceConfig(): Promise<IceConfig> {
    const now = Date.now();
    if (this.ice && now < this.ice.until) return this.ice.config;
    try {
      const got = await request<IceConfig>('GET', '/messenger/ice');
      const servers = Array.isArray(got?.iceServers) ? got.iceServers : [];
      const config: IceConfig = {
        iceServers: servers.length ? servers : STUN_ONLY.iceServers,
        turn: got?.turn === true,
        ttl: Number(got?.ttl) || 0,
      };
      hasTurn = config.turn;
      this.ice = {
        config,
        until: now + (config.ttl > 0 ? (config.ttl * 1000) / 2 : NO_TURN_RETRY_MS),
      };
      return config;
    } catch {
      hasTurn = false;
      return STUN_ONLY;
    }
  }

  /** Що вузол віддав минулого разу — для екрана налаштувань і доказів. */
  async iceInfo(): Promise<{ turn: boolean; ttl: number; urls: string[] }> {
    const config = await this.iceConfig();
    const urls = config.iceServers.flatMap((server) =>
      (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
        (u): u is string => typeof u === 'string',
      ),
    );
    // Креденшели сюди не потрапляють свідомо: екрану вони не потрібні, а в
    // логу доказу були б зайвим життям пари, яка й так вмирає за годину.
    return { turn: config.turn, ttl: config.ttl, urls };
  }

  private buildPeerConnection(callId: string, ice: IceConfig): RTCPeerConnection {
    // Тест-хук: змушує браузер відкинути host і srflx і піти виключно через
    // ретранслятор. Потрібен, щоб relay можна було ДОВЕСТИ, а не чекати
    // симетричного NAT, якого на цьому столі немає.
    const forceRelay =
      import.meta.env.DEV &&
      typeof window !== 'undefined' &&
      (window as unknown as Record<string, unknown>).__phantomForceRelay === true;

    const pc = new RTCPeerConnection({
      iceServers: ice.iceServers,
      ...(forceRelay ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
    });
    this.pc = pc;

    const remote = new MediaStream();
    this.patch({ remoteStream: remote });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.post('ice', callId, { candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((t) => {
        if (!remote.getTrackById(t.id)) remote.addTrack(t);
      });
      // Той самий обʼєкт, але React має побачити зміну.
      this.patch({ remoteStream: remote });
    };

    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected') {
        this.clearStall();
        this.clearDeadLink();
        // Доріжка встала — рація більше не потрібна. Це саме те місце, де
        // повернення в реальний час стає фактом, а не надією.
        if (this.radio) this.exitRadio();
        if (this.snapshot.state !== 'active') {
          this.patch({ state: 'active', startedAt: Date.now(), stall: null });
        }
        this.startStats();
        void this.ladder.applyRung();
      } else if (pc.connectionState === 'failed') {
        this.onLinkLost('доріжка не тримається');
      } else if (pc.connectionState === 'disconnected') {
        // Не вирок: `disconnected` часто саме себе лікує за кілька секунд.
        // Ховаємо слухавку лише коли воно затягнулось.
        this.armDeadLink('доріжка пропала');
      }
    };

    // ICE ламається раніше, ніж падає зʼєднання загалом: саме тут видно,
    // що прохідних пар кандидатів не лишилось.
    pc.oniceconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.iceConnectionState === 'failed') this.onLinkLost('прохідних пар кандидатів не лишилось');
      else if (pc.iceConnectionState === 'disconnected') this.armDeadLink('доріжка пропала');
      else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.clearDeadLink();
      }
    };

    return pc;
  }

  /* ── доріжка вмирає ─────────────────────────────────────────────────── */

  /**
   * Доріжки немає. Далі є рівно два чесні виходи: якщо на тому боці точно
   * хтось є — переходимо на рацію, розмова триває. Якщо ніхто не відповідав —
   * рація нікому не потрібна, і дзвінок закінчується правдою.
   */
  private onLinkLost(why: string): void {
    this.clearDeadLink();
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'ended') return;
    if (this.answered && this.canRadio()) {
      void this.enterRadio(why);
      return;
    }
    this.finish(this.linkFailureReason());
  }

  private armDeadLink(why: string): void {
    if (this.deadLinkTimer) return;
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'ended') return;
    this.deadLinkTimer = setTimeout(() => {
      this.deadLinkTimer = null;
      const pc = this.pc;
      if (!pc) return;
      if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') return;
      this.onLinkLost(why);
    }, DEAD_LINK_MS);
  }

  private clearDeadLink(): void {
    if (this.deadLinkTimer) clearTimeout(this.deadLinkTimer);
    this.deadLinkTimer = null;
  }

  /** Рація тримається на кадрах до вузла — без адреси співрозмовника її нема. */
  private canRadio(): boolean {
    const peer = this.snapshot.peer;
    return !!(peer && (peer.contactId || peer.peerNodeId) && this.localStream);
  }

  /* ── чесна межа звʼязку ─────────────────────────────────────────────── */

  /** Зʼєднання не встало жодного разу — це не «обірвалось», а не зійшлось. */
  private linkFailureReason(): string {
    if (this.snapshot.startedAt !== null) return 'звʼязок обірвався';
    return this.answered ? linkStallNote() : 'зʼєднання не встановилось';
  }

  private armStall(callId: string): void {
    this.clearStall();
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (this.snapshot.callId !== callId) return;
      if (
        this.snapshot.state === 'calling' ||
        this.snapshot.state === 'ringing' ||
        this.snapshot.state === 'connecting'
      ) {
        // Слухавку взяли, а доріжка так і не встала. Дзвінок, який ніколи не
        // з'єднався, теж має право жити рацією: людина на тому боці є.
        if (this.answered && this.canRadio()) {
          void this.enterRadio('пряма доріжка так і не встала');
          return;
        }
        this.patch({
          stall: this.answered
            ? { kind: 'no-path', note: linkStallNote() }
            : { kind: 'no-answer', note: NO_ANSWER_NOTE },
        });
      }
    }, STALL_AFTER_MS);
  }

  private clearStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* кандидат, який не лягає, — не привід валити дзвінок */
    }
  }

  private async drainIce(): Promise<void> {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) await this.addIce(candidate);
  }

  private post(
    kind: 'offer' | 'answer' | 'ice' | 'hangup',
    callId: string,
    body: Record<string, unknown>,
  ): Promise<SignalResult> {
    return this.postTo(this.snapshot.peer, kind, callId, body);
  }

  private async postTo(
    peer: CallPeer | null,
    kind: 'offer' | 'answer' | 'ice' | 'hangup',
    callId: string,
    body: Record<string, unknown>,
  ): Promise<SignalResult> {
    try {
      return await request<SignalResult>('POST', `/messenger/call/${kind}`, {
        call_id: callId,
        contact_id: peer?.contactId ?? null,
        peer_node_id: peer?.peerNodeId ?? null,
        ...body,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'вузол не прийняв сигнал';
      return { delivered: false, call_id: callId, detail };
    }
  }

  /* ── драбина ────────────────────────────────────────────────────────── */

  /** Тест-хук і ручний режим — сама механіка в `callLadder.ts`. */
  forceLadder(level: AudioLevel | 'video' | 'auto'): Promise<string> {
    return this.ladder.force(level);
  }

  /** Що драбина встигла зробити — для доказів, а не для екрана. */
  ladderHistory(): LadderStep[] {
    return this.ladder.history();
  }

  /* ── рація ──────────────────────────────────────────────────────────── */

  private async enterRadio(why: string): Promise<void> {
    if (this.radio || !this.canRadio()) return;
    const callId = this.snapshot.callId;
    if (!callId) return;

    this.clearStall();
    this.clearDeadLink();
    this.stopStats();

    const link = new RadioLink((tally) => this.patch({ radio: tally }));
    this.radio = link;
    // Стан ставимо в active навіть якщо доріжка ніколи не вставала: розмова
    // ЙДЕ, і картка «набираю…» тут була б брехнею.
    this.patch({
      state: 'active',
      startedAt: this.snapshot.startedAt ?? Date.now(),
      stall: null,
      radioReason: why,
      radio: null,
      linkNote: null,
      // Телеметрія доріжки, якої вже немає, — це брехня з точністю до
      // кілобіта. Останній вимір помер разом із доріжкою.
      stats: null,
    });
    link.start(
      {
        callId,
        contactId: this.snapshot.peer?.contactId,
        peerNodeId: this.snapshot.peer?.peerNodeId,
      },
      this.localStream,
    );

    this.clearRevive();
    this.reviveTimer = setInterval(() => void this.tryRevive(), REVIVE_PERIOD_MS);
  }

  private exitRadio(): void {
    const link = this.radio;
    if (!link) return;
    this.radio = null;
    link.stop();
    this.clearRevive();
    this.patch({ radio: null, radioReason: null, linkNote: 'Канал відновлено' });
    this.armNote();
  }

  /**
   * Спроба повернутись у реальний час. Пробує лише той, хто набирав: якби
   * пробували обидва, дві пропозиції зустрілись би посередині.
   */
  private async tryRevive(): Promise<void> {
    if (!this.radio || !this.snapshot.outgoing) return;
    const callId = this.snapshot.callId;
    if (!callId) return;

    const pc = this.pc;
    if (pc && pc.connectionState !== 'closed' && pc.signalingState === 'stable') {
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription({
          type: 'offer',
          sdp: tuneOpus(offer.sdp ?? '', this.snapshot.audioLevel),
        });
        await this.post('offer', callId, {
          sdp: pc.localDescription?.sdp,
          media: this.snapshot.media,
        });
        return;
      } catch {
        /* нижче спробуємо з чистого аркуша */
      }
    }
    await this.rebuildAndOffer(callId);
  }

  /** Доріжки немає взагалі — будуємо з нуля під тим самим номером дзвінка. */
  private async rebuildAndOffer(callId: string): Promise<void> {
    const stream = this.localStream;
    if (!stream) return;
    this.teardownPc();
    const pc = this.buildPeerConnection(callId, await this.iceConfig());
    stream.getTracks().forEach((track) => {
      if (track.kind === 'video' && this.snapshot.videoDropped) return;
      pc.addTrack(track, stream);
    });
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.snapshot.media === 'video',
      });
      await pc.setLocalDescription({
        type: 'offer',
        sdp: tuneOpus(offer.sdp ?? '', this.snapshot.audioLevel),
      });
      await this.post('offer', callId, {
        sdp: pc.localDescription?.sdp,
        media: this.snapshot.media,
      });
    } catch {
      /* не вийшло — рація тримає розмову далі, спробуємо через 20 с */
    }
  }

  private clearRevive(): void {
    if (this.reviveTimer) clearInterval(this.reviveTimer);
    this.reviveTimer = null;
  }

  /** Коротка звістка про канал не має висіти вічно. */
  private armNote(): void {
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.noteTimer = null;
      this.patch({ linkNote: null });
    }, 4000);
  }

  /* ── статистика ─────────────────────────────────────────────────────── */

  private startStats(): void {
    this.stopStats();
    void this.sampleStats();
    this.statsTimer = setInterval(() => void this.sampleStats(), STATS_PERIOD_MS);
  }

  private stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.lastBytes = null;
    this.ladder.resetLoss();
  }

  private async sampleStats(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return;
    }

    const rows = new Map<string, Record<string, unknown>>();
    report.forEach((value: Record<string, unknown>, key: string) => rows.set(key, value));

    const codecOf = (row: Record<string, unknown> | undefined): string | null => {
      const codecId = row?.codecId as string | undefined;
      const codec = codecId ? rows.get(codecId) : undefined;
      const mime = codec?.mimeType as string | undefined;
      return mime ? mime.split('/')[1] ?? mime : null;
    };

    // Тип кандидата беремо з рядка, на який посилається пара, — вигадати
    // його з SDP не можна, а саме він каже, чи це LAN, STUN чи ретранслятор.
    const candidateTypeOf = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      const type = rows.get(id)?.candidateType;
      return typeof type === 'string' ? type : null;
    };

    let rttMs: number | null = null;
    let packetsLost: number | null = null;
    let audioCodec: string | null = null;
    let videoCodec: string | null = null;
    let localCandidate: string | null = null;
    let remoteCandidate: string | null = null;
    let bytes = 0;
    let packetsReceived = 0;

    rows.forEach((row) => {
      if (row.type === 'candidate-pair' && (row.nominated === true || row.state === 'succeeded')) {
        const rtt = row.currentRoundTripTime as number | undefined;
        if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
        localCandidate = candidateTypeOf(row.localCandidateId) ?? localCandidate;
        remoteCandidate = candidateTypeOf(row.remoteCandidateId) ?? remoteCandidate;
      }
      if (row.type === 'inbound-rtp') {
        const lost = row.packetsLost as number | undefined;
        if (typeof lost === 'number') packetsLost = (packetsLost ?? 0) + lost;
        const got = row.packetsReceived as number | undefined;
        if (typeof got === 'number') packetsReceived += got;
        const received = row.bytesReceived as number | undefined;
        if (typeof received === 'number') bytes += received;
        if (row.kind === 'audio') audioCodec = codecOf(row) ?? audioCodec;
        if (row.kind === 'video') videoCodec = codecOf(row) ?? videoCodec;
      }
    });

    const now = Date.now();
    let kbps: number | null = null;
    if (this.lastBytes && now > this.lastBytes.at) {
      const delta = bytes - this.lastBytes.bytes;
      if (delta >= 0) kbps = Math.round((delta * 8) / (now - this.lastBytes.at));
    }
    this.lastBytes = { at: now, bytes };

    // Порожній вимір — це «ще нема», а не «нуль»: показувати нулі як
    // результат вимірювання не можна.
    if (
      rttMs === null &&
      packetsLost === null &&
      !audioCodec &&
      !videoCodec &&
      kbps === null &&
      !localCandidate &&
      !remoteCandidate
    ) {
      return;
    }
    this.patch({
      stats: { rttMs, packetsLost, audioCodec, videoCodec, kbps, localCandidate, remoteCandidate },
    });
    // Вирок каналу — лише живій розмові: у рації доріжки немає, судити нічого.
    if (this.snapshot.state === 'active' && !this.radio) {
      this.ladder.judgeLink(rttMs, packetsLost, packetsReceived);
    }
  }

  /* ── завершення ─────────────────────────────────────────────────────── */

  /** Знімає доріжку, не чіпаючи ані розмови, ані мікрофона. */
  private teardownPc(): void {
    const pc = this.pc;
    this.pc = null;
    this.ladder.dropSender();
    if (!pc) return;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* уже закритий */
    }
  }

  private finish(reason: string): void {
    if (this.snapshot.state === 'idle') return;
    this.stopStats();
    this.clearStall();
    this.clearDeadLink();
    this.clearRevive();
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = null;
    this.radio?.stop();
    this.radio = null;
    this.ladder.endCall();
    this.answered = false;
    this.pendingIce = [];
    this.pendingOffer = null;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.teardownPc();

    // Історію драбини НЕ чистимо: після завершення саме вона відповідає на
    // питання «а що взагалі відбувалось із каналом». Її стирає новий дзвінок.
    this.patch({
      state: 'ended',
      localStream: null,
      remoteStream: null,
      endedReason: reason,
      stall: null,
      radio: null,
      radioReason: null,
      linkNote: null,
    });

    this.clearLinger();
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      if (this.snapshot.state === 'ended') this.patch({ ...IDLE });
    }, ENDED_LINGER_MS);
  }

  private clearLinger(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
  }

  private mediaError(err: unknown): string {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'доступ до мікрофона й камери не дано';
    if (name === 'NotFoundError') return 'мікрофона чи камери не знайдено';
    return this.plainError(err, 'пристрої захоплення недоступні');
  }

  private plainError(err: unknown, fallback: string): string {
    const message = err instanceof Error ? err.message : '';
    return message || fallback;
  }

  /**
   * Вбиває доріжку, не чіпаючи розмови — так, як це робить погана мережа.
   * Потрібно, щоб перехід на рацію можна було ДОВЕСТИ, а не описати словами.
   */
  /** Сирий рядок відправника з getStats — щоб сходинку можна було ЗМІРЯТИ. */
  async probeRtp(): Promise<Record<string, unknown> | null> {
    const pc = this.pc;
    if (!pc) return null;
    const report = await pc.getStats();
    const found: Array<Record<string, unknown>> = [];
    report.forEach((row: Record<string, unknown>) => {
      if (row.type === 'outbound-rtp' && row.kind === 'audio') {
        found.push({
          bytesSent: row.bytesSent,
          packetsSent: row.packetsSent,
          targetBitrate: row.targetBitrate,
          at: Date.now(),
        });
      }
    });
    const out = found[found.length - 1] ?? null;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    const encoding = sender?.getParameters().encodings?.[0] as
      | { maxBitrate?: number; ptime?: number }
      | undefined;
    return out
      ? { ...out, maxBitrate: encoding?.maxBitrate ?? null, ptime: encoding?.ptime ?? null }
      : null;
  }

  /**
   * Куди саме їде медіа: обрана пара кандидатів із адресами й лічильниками.
   * `candidateType: 'relay'` з адресою ретранслятора — це і є доказ, що байти
   * ідуть крізь нього, а не повз. Вигадати це з SDP неможливо.
   */
  async probePath(): Promise<Record<string, unknown> | null> {
    const pc = this.pc;
    if (!pc) return null;
    const report = await pc.getStats();
    const rows = new Map<string, Record<string, unknown>>();
    report.forEach((row: Record<string, unknown>, id: string) => rows.set(id, row));

    const pairs: Array<Record<string, unknown>> = [];
    rows.forEach((row) => {
      if (row.type === 'candidate-pair' && (row.nominated === true || row.state === 'succeeded')) {
        pairs.push(row);
      }
    });
    // Пар може бути кілька; медіа їде тією, якою течуть байти.
    pairs.sort((a, b) => Number(b.bytesSent ?? 0) - Number(a.bytesSent ?? 0));
    const pair = pairs[0];
    if (!pair) return null;

    const side = (id: unknown): Record<string, unknown> => {
      const row = typeof id === 'string' ? rows.get(id) : undefined;
      return {
        type: row?.candidateType ?? null,
        address: row?.address ?? row?.ip ?? null,
        port: row?.port ?? null,
        protocol: row?.protocol ?? null,
        relayProtocol: row?.relayProtocol ?? null,
      };
    };

    const rtt = pair.currentRoundTripTime;
    return {
      at: Date.now(),
      state: pair.state ?? null,
      bytesSent: pair.bytesSent ?? null,
      bytesReceived: pair.bytesReceived ?? null,
      rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null,
      local: side(pair.localCandidateId),
      remote: side(pair.remoteCandidateId),
    };
  }

  killLinkForTest(): string {
    if (!this.pc) return 'доріжки й так немає';
    this.teardownPc();
    this.stopStats();
    this.onLinkLost('доріжку обірвано вручну');
    return 'доріжку закрито';
  }
}

export const callEngine = new CallEngine();

/** Запуск дзвінка ззовні — Header приєднається сюди, коли буде готовий. */
export const startCall = (peer: CallPeer, media: CallMedia = 'audio'): Promise<void> =>
  callEngine.startCall(peer, media);

// Ручки для доказів. Живуть тільки в dev-збірці: у продукт вони не їдуть, бо
// дають стороннім скриптам керувати чужим дзвінком.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__phantomCallLadder = (level: AudioLevel | 'video' | 'auto') =>
    callEngine.forceLadder(level);
  w.__phantomCallKillLink = () => callEngine.killLinkForTest();
  w.__phantomCallRtp = () => callEngine.probeRtp();
  w.__phantomCallPath = () => callEngine.probePath();
  w.__phantomIce = () => callEngine.iceInfo();
  // Текст про межу звʼязку — щоб було видно, що він живе від стану вузла.
  w.__phantomLinkNote = () => linkStallNote();
  w.__phantomCallState = () => {
    const s = callEngine.getSnapshot();
    return {
      state: s.state,
      audioLevel: s.audioLevel,
      videoDropped: s.videoDropped,
      pinned: s.ladderPinned,
      stats: s.stats,
      radio: s.radio,
      radioReason: s.radioReason,
      linkNote: s.linkNote,
      ladder: callEngine.ladderHistory(),
    };
  };
}
