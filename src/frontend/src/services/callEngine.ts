/**
 * Дзвінок 1:1 — справжній: getUserMedia, RTCPeerConnection, ICE.
 *
 * Медіа йде між браузерами напряму (DTLS-SRTP), вузол його не бачить і не
 * може бачити. Вузол переносить лише SDP і кандидатів — див.
 * `api/routes_calls.py`. Тому все, що тут показано як «дзвінок», або справді
 * зʼєдналось, або чесно каже, що ні: жоден стан не малюється наперед.
 *
 * Таймер починає рахувати не з натискання кнопки, а з моменту, коли
 * з'єднання перейшло в `connected` — інакше він рахував би очікування.
 * Статистика береться з `getStats()`; поки перший вимір не прийшов, її немає,
 * і показувати замість неї щось правдоподібне не можна.
 */

import { request } from './api';
import { wsClient } from './websocket';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const STATS_PERIOD_MS = 2000;
/** Скільки триматися на екрані після завершення, перш ніж зникнути. */
const ENDED_LINGER_MS = 2600;

export type CallState = 'idle' | 'calling' | 'ringing' | 'active' | 'ended';
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
  private offWs: (() => void) | null = null;

  /** Кандидати, що прилетіли раніше, ніж зʼявилось куди їх класти. */
  private pendingIce: RTCIceCandidateInit[] = [];
  /** Пропозиція чекає, поки людина візьме слухавку. */
  private pendingOffer: string | null = null;
  /** Попередній вимір — щоб порахувати бітрейт як різницю, а не як здогад. */
  private lastBytes: { at: number; bytes: number } | null = null;

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

    const pc = this.buildPeerConnection(callId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: media === 'video',
      });
      await pc.setLocalDescription(offer);
      const result = await this.post('offer', callId, {
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        media,
      });
      if (!result.delivered) {
        this.finish(result.detail || 'вузол співрозмовника не прийняв дзвінок');
      }
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

    let stream: MediaStream;
    try {
      stream = await this.grabMedia(this.snapshot.media);
    } catch (err) {
      void this.post('hangup', callId, { reason: 'no-media' });
      this.finish(this.mediaError(err));
      return;
    }

    const pc = this.buildPeerConnection(callId);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.drainIce();
      const result = await this.post('answer', callId, {
        sdp: pc.localDescription?.sdp ?? answer.sdp,
      });
      if (!result.delivered) {
        this.finish(result.detail || 'відповідь не доїхала до співрозмовника');
      }
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

    if (kind === 'answer' && data.sdp) {
      try {
        await this.pc?.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.drainIce();
      } catch (err) {
        this.finish(this.plainError(err, 'відповідь співрозмовника не прийнялась'));
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
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'ended') {
      // Уже в розмові — другий дзвінок не тримаємо мовчки в черзі, а чесно
      // відмовляємо, щоб той, хто набирає, побачив це одразу.
      const busy: CallPeer = { peerNodeId: data.from_node_id, displayName: '' };
      void this.postTo(busy, 'hangup', callId, { reason: 'busy' });
      return;
    }
    if (!data.sdp) return;

    this.clearLinger();
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

  private buildPeerConnection(callId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
      if (pc.connectionState === 'connected') {
        if (this.snapshot.state !== 'active') {
          this.patch({ state: 'active', startedAt: Date.now() });
          this.startStats();
        }
      } else if (pc.connectionState === 'failed') {
        this.finish('зʼєднання не встановилось');
      } else if (pc.connectionState === 'disconnected' && this.snapshot.state === 'active') {
        this.finish('звʼязок обірвався');
      }
    };

    return pc;
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

    let rttMs: number | null = null;
    let packetsLost: number | null = null;
    let audioCodec: string | null = null;
    let videoCodec: string | null = null;
    let bytes = 0;

    rows.forEach((row) => {
      if (row.type === 'candidate-pair' && (row.nominated === true || row.state === 'succeeded')) {
        const rtt = row.currentRoundTripTime as number | undefined;
        if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
      }
      if (row.type === 'inbound-rtp') {
        const lost = row.packetsLost as number | undefined;
        if (typeof lost === 'number') packetsLost = (packetsLost ?? 0) + lost;
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
    if (rttMs === null && packetsLost === null && !audioCodec && !videoCodec && kbps === null) {
      return;
    }
    this.patch({ stats: { rttMs, packetsLost, audioCodec, videoCodec, kbps } });
  }

  /* ── завершення ─────────────────────────────────────────────────────── */

  private finish(reason: string): void {
    if (this.snapshot.state === 'idle') return;
    this.stopStats();
    this.pendingIce = [];
    this.pendingOffer = null;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* уже закритий */
      }
      this.pc = null;
    }

    this.patch({
      state: 'ended',
      localStream: null,
      remoteStream: null,
      endedReason: reason,
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
}

export const callEngine = new CallEngine();

/** Запуск дзвінка ззовні — Header приєднається сюди, коли буде готовий. */
export const startCall = (peer: CallPeer, media: CallMedia = 'audio'): Promise<void> =>
  callEngine.startCall(peer, media);
