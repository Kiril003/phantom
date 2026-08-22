/**
 * Дзвінок на екрані. Малює рівно те, що рушій справді має.
 *
 * Немає відеодоріжки — чорна плашка з ініціалами, а не «Camera 1080p Active».
 * Немає першого виміру getStats — «вимірюю…», а не вигадана латентність.
 * Таймер рахує від моменту, коли зʼєднання стало connected, і ні секундою раніше.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneOff } from 'lucide-react';
import { callEngine } from '../../services/callEngine';
import type { CallSnapshot } from '../../services/callEngine';

const PAPER = '#FDFCF9';
const INK = '#21261F';
const HAIRLINE = '#E8E1D3';
const ACCENT = '#D96C35';
const END = '#B85425';
const MUTED = '#8A8577';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/** Таймер живе окремо, щоб щосекундний тік не перемальовував відео. */
const CallTimer: React.FC<{ startedAt: number | null }> = ({ startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return <span style={{ color: MUTED }}>зʼєднуємось…</span>;
  return (
    <span data-call-timer style={{ fontVariantNumeric: 'tabular-nums' }}>
      {clock(now - startedAt)}
    </span>
  );
};

const VideoPane: React.FC<{
  stream: MediaStream | null;
  muted: boolean;
  name: string;
  mirrored?: boolean;
  /** Підказка від рушія: вимкнену камеру видно одразу, а не за тік опитування. */
  enabled?: boolean;
}> = ({ stream, muted, name, mirrored, enabled }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);

    const refresh = () => setHasVideo((stream?.getVideoTracks() ?? []).some((t) => t.enabled));
    refresh();
    if (!stream) return;
    stream.addEventListener('addtrack', refresh);
    stream.addEventListener('removetrack', refresh);
    const id = setInterval(refresh, 1000);
    return () => {
      stream.removeEventListener('addtrack', refresh);
      stream.removeEventListener('removetrack', refresh);
      clearInterval(id);
    };
  }, [stream]);

  const show = hasVideo && enabled !== false;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#121310]">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-cover"
        style={{
          transform: mirrored ? 'scaleX(-1)' : undefined,
          opacity: show ? 1 : 0,
        }}
      />
      {!show && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-semibold tracking-wide"
            style={{ color: '#6E6A5E', fontSize: 'clamp(20px, 6vw, 44px)' }}
          >
            {initialsOf(name)}
          </span>
        </div>
      )}
    </div>
  );
};

const StatsLine: React.FC<{ snapshot: CallSnapshot }> = ({ snapshot }) => {
  const s = snapshot.stats;
  if (!s) {
    return (
      <span className="text-[11px]" data-call-stats style={{ color: MUTED }}>
        вимірюю…
      </span>
    );
  }
  const parts: string[] = [];
  if (s.rttMs !== null) parts.push(`RTT ${s.rttMs} мс`);
  if (s.packetsLost !== null) parts.push(`втрачено ${s.packetsLost}`);
  if (s.kbps !== null) parts.push(`${s.kbps} кбіт/с`);
  const codecs = [s.audioCodec, s.videoCodec].filter(Boolean).join(' · ');
  if (codecs) parts.push(codecs);
  return (
    <span
      className="text-[11px]"
      data-call-stats
      style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}
    >
      {parts.length ? parts.join('  ·  ') : 'вимірюю…'}
    </span>
  );
};

const RoundButton: React.FC<{
  onClick: () => void;
  title: string;
  tone: 'plain' | 'accent' | 'end';
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, tone, disabled, children }) => {
  const bg = tone === 'end' ? END : tone === 'accent' ? ACCENT : PAPER;
  const fg = tone === 'plain' ? INK : PAPER;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="w-12 h-12 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40"
      style={{ background: bg, color: fg, border: `1px solid ${tone === 'plain' ? HAIRLINE : bg}` }}
    >
      {children}
    </button>
  );
};

export const CallOverlay: React.FC = () => {
  const snapshot = useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot);
  if (snapshot.state === 'idle' || typeof document === 'undefined') return null;

  const name = snapshot.peer?.displayName || 'Невідомий вузол';
  const card = `rounded-3xl border shadow-2xl overflow-hidden`;

  /* Вхідний і вихідний до зʼєднання — невелика картка, а не весь екран. */
  if (snapshot.state === 'ringing' || snapshot.state === 'calling' || snapshot.state === 'ended') {
    const ringing = snapshot.state === 'ringing';
    return createPortal(
      <div
        data-call-overlay
        data-call-state={snapshot.state}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ background: 'rgba(20,22,18,0.45)' }}
      >
        <div
          className={`${card} w-full max-w-[380px] p-7 text-center`}
          style={{ background: PAPER, borderColor: HAIRLINE, color: INK }}
        >
          <div
            className="w-20 h-20 rounded-full mx-auto flex items-center justify-center text-2xl font-semibold"
            style={{ background: '#F1ECE1', color: INK, border: `1px solid ${HAIRLINE}` }}
          >
            {initialsOf(name)}
          </div>
          <div className="mt-4 text-lg font-semibold">{name}</div>
          <div className="mt-1 text-[13px]" style={{ color: MUTED }}>
            {snapshot.state === 'ended'
              ? snapshot.endedReason ?? 'дзвінок завершено'
              : ringing
                ? snapshot.media === 'video'
                  ? 'вхідний відеодзвінок'
                  : 'вхідний дзвінок'
                : 'набираю…'}
          </div>
          {snapshot.peer?.verified === false && snapshot.state !== 'ended' && (
            <div className="mt-2 text-[11px]" style={{ color: MUTED }}>
              число безпеки не звірено
            </div>
          )}

          {/* Дві кнопки однієї теплої родини сплутати легко, тож підписуємо:
              помилитись у «прийняти / відхилити» людина не має права. */}
          {snapshot.state !== 'ended' && (
            <div className="mt-7 flex items-start justify-center gap-9">
              {ringing && (
                <div className="flex flex-col items-center gap-2">
                  <RoundButton
                    onClick={() => void callEngine.accept()}
                    title="Прийняти"
                    tone="accent"
                  >
                    <Phone className="w-5 h-5" />
                  </RoundButton>
                  <span className="text-[11px]" style={{ color: MUTED }}>
                    Прийняти
                  </span>
                </div>
              )}
              <div className="flex flex-col items-center gap-2">
                <RoundButton
                  onClick={() => (ringing ? callEngine.decline() : callEngine.hangup())}
                  title={ringing ? 'Відхилити' : 'Завершити'}
                  tone="end"
                >
                  <PhoneOff className="w-5 h-5" />
                </RoundButton>
                <span className="text-[11px]" style={{ color: MUTED }}>
                  {ringing ? 'Відхилити' : 'Завершити'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  /* Розмова йде. */
  return createPortal(
    <div
      data-call-overlay
      data-call-state="active"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-0 sm:p-6"
      style={{ background: 'rgba(20,22,18,0.55)' }}
    >
      <div
        className={`${card} w-full h-full sm:max-w-[900px] sm:h-[80vh] flex flex-col`}
        style={{ background: PAPER, borderColor: HAIRLINE, color: INK }}
      >
        <div
          className="px-5 py-3 flex items-center justify-between border-b"
          style={{ borderColor: HAIRLINE }}
        >
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate">{name}</div>
            <div className="text-[12px]" style={{ color: MUTED }}>
              <CallTimer startedAt={snapshot.startedAt} />
            </div>
          </div>
          <StatsLine snapshot={snapshot} />
        </div>

        <div className="relative flex-1 min-h-0" data-call-remote>
          <VideoPane stream={snapshot.remoteStream} muted={false} name={name} />
          <div
            className="absolute bottom-4 right-4 w-28 h-40 sm:w-36 sm:h-24 rounded-2xl overflow-hidden border shadow-lg"
            style={{ borderColor: HAIRLINE }}
            data-call-local
          >
            <VideoPane
              stream={snapshot.localStream}
              muted
              name="Я"
              mirrored
              enabled={snapshot.cameraOn}
            />
          </div>
        </div>

        <div
          className="px-5 py-4 flex items-center justify-center gap-4 border-t"
          style={{ borderColor: HAIRLINE }}
        >
          <RoundButton
            onClick={() => callEngine.toggleMic()}
            title={snapshot.micOn ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'}
            tone={snapshot.micOn ? 'plain' : 'accent'}
          >
            {snapshot.micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </RoundButton>
          <RoundButton
            onClick={() => callEngine.toggleCamera()}
            title={
              !snapshot.hasCamera
                ? 'Дзвінок без відео'
                : snapshot.cameraOn
                  ? 'Вимкнути камеру'
                  : 'Увімкнути камеру'
            }
            tone={snapshot.hasCamera && snapshot.cameraOn ? 'plain' : 'accent'}
            disabled={!snapshot.hasCamera}
          >
            {snapshot.cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </RoundButton>
          <RoundButton onClick={() => callEngine.hangup()} title="Завершити" tone="end">
            <PhoneOff className="w-5 h-5" />
          </RoundButton>
        </div>
      </div>
    </div>,
    document.body,
  );
};
