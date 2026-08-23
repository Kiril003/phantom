/**
 * Дзвінок на екрані. Малює рівно те, що рушій справді має.
 *
 * Немає відеодоріжки — чорна плашка з ініціалами, а не «Camera 1080p Active».
 * Немає першого виміру getStats — «вимірюю…», а не вигадана латентність.
 * Таймер рахує від моменту, коли зʼєднання стало connected, і ні секундою раніше.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Radio } from 'lucide-react';
import { callEngine } from '../../services/callEngine';
import type { CallSnapshot } from '../../services/callEngine';
import { AUDIO_LEVEL_LABEL } from '../../services/callOpus';

const PAPER = '#FDFCF9';
const INK = '#21261F';
const HAIRLINE = '#E8E1D3';
const ACCENT = '#D96C35';
const END = '#B85425';
const MUTED = '#8A8577';
const TRUST_OK = '#4C8A55';
const TRUST_WARN = '#C98A2E';
/** Тепле паперове тло для тривожної, але не смертельної звістки. */
const NOTE_BG = '#FDF6EC';
const NOTE_EDGE = '#EBD9BE';
const NOTE_INK = '#8C5A1A';

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

/**
 * Стан звірки особи — і тільки він. Це не про шифрування: замок і напис «E2E»
 * тут були б обіцянкою, якої дзвінок не дає. Звірили число — зелена крапка,
 * не звірили — бурштинова, не питали вузол — кажемо, що не знаємо.
 *
 * Кажемо «вами», бо звірка однобічна: вона живе на вашому вузлі й нікуди не
 * їде. У співрозмовника в цю саму мить може стояти «Не звірено вами» — і це
 * не суперечність, а два різні записи про одну розмову.
 */
const TrustRow: React.FC<{ verified?: boolean | null }> = ({ verified }) => {
  if (verified === true || verified === false) {
    const tone = verified ? TRUST_OK : TRUST_WARN;
    return (
      <span
        data-call-trust={verified ? 'verified' : 'unverified'}
        className="inline-flex items-center gap-1.5 text-[11.5px]"
        style={{ color: tone }}
        title={
          verified
            ? 'Ви звірили число безпеки цього співрозмовника на своєму вузлі. У нього свій окремий запис — там може стояти «не звірено».'
            : 'Ви ще не звіряли число безпеки цього співрозмовника. Звірка робиться на кожному вузлі окремо.'
        }
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone }} />
        {verified ? 'Звірено вами ✓' : 'Не звірено вами'}
      </span>
    );
  }
  return (
    <span data-call-trust="unknown" className="text-[11.5px]" style={{ color: MUTED }}>
      стан звірки невідомий
    </span>
  );
};

/**
 * Сходинка звуку — поруч із телеметрією, тими самими словами, що й у рушії.
 * «Повний» тут означає 64 кбіт/с, а не «HD»: обіцяти студію по дроту, якого
 * немає, — це рівно те, від чого ми тікаємо.
 */
const LadderChip: React.FC<{ snapshot: CallSnapshot }> = ({ snapshot }) => {
  if (snapshot.radio) return null;
  const narrow = snapshot.audioLevel === 'narrow';
  return (
    <span
      data-call-level={snapshot.audioLevel}
      className="text-[11px] whitespace-nowrap"
      style={{ color: narrow ? NOTE_INK : MUTED }}
      title={
        // Сходинка — про ВИХІДНИЙ звук, а телеметрія поруч — про вхідний.
        // Числа можуть не збігатися, і людина має знати чому.
        (snapshot.ladderPinned
          ? 'Сходинку тримають вручну — автоспуск не втручається. '
          : 'Сходинка обирається сама за втратами і затримкою. ') +
        'Це про звук, який відсилаєте ВИ; телеметрія поруч — про той, що приходить.'
      }
    >
      звук: {AUDIO_LEVEL_LABEL[snapshot.audioLevel]}
      {snapshot.videoDropped ? ' · відео знято' : ''}
      {snapshot.ladderPinned ? ' · вручну' : ''}
    </span>
  );
};

const StatsLine: React.FC<{ snapshot: CallSnapshot }> = ({ snapshot }) => {
  // У рації міряти нічого: доріжки немає. Свої лічильники в неї власні, і
  // вони в банері — а RTT доріжки, якої не існує, показувати не можна.
  if (snapshot.radio) return null;
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
  // Тип пари кандидатів: host — та сама мережа, srflx — крізь NAT, relay —
  // через TURN. Саме це каже, чи встане цей дзвінок поза локальною мережею.
  if (s.localCandidate || s.remoteCandidate) {
    parts.push(`шлях ${s.localCandidate ?? '?'}↔${s.remoteCandidate ?? '?'}`);
  }
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

/**
 * Рація. Головне тут — не злякати: дзвінок НЕ впав, він змінив спосіб їзди.
 * Тому банер каже і ціну (затримка), і виграш (нічого не губиться), і показує
 * лічильники, за якими це видно, а не просить вірити на слово.
 */
const RadioBanner: React.FC<{ snapshot: CallSnapshot }> = ({ snapshot }) => {
  const radio = snapshot.radio;
  if (!radio) return null;
  return (
    <div
      data-call-radio="on"
      className="px-5 py-3 border-b"
      style={{ background: NOTE_BG, borderColor: NOTE_EDGE }}
    >
      <div className="flex items-start gap-2.5">
        <Radio className="w-4 h-4 mt-0.5 shrink-0" style={{ color: NOTE_INK }} />
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold" style={{ color: NOTE_INK }}>
            Канал вузький — режим рації
          </div>
          <div className="text-[11.5px] leading-relaxed" style={{ color: NOTE_INK }}>
            Затримка кілька секунд, але жодне слово не губиться.
            {snapshot.radioReason ? ` Причина: ${snapshot.radioReason}.` : ''}
          </div>
          <div
            className="mt-1 text-[11px] flex items-center gap-2 flex-wrap"
            style={{ color: NOTE_INK, fontVariantNumeric: 'tabular-nums' }}
            data-call-radio-tally
          >
            {radio.speaking ? (
              <span
                data-call-radio-speaking="yes"
                className="inline-flex items-center gap-1.5 font-semibold"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: ACCENT }}
                />
                говорить…
              </span>
            ) : (
              <span data-call-radio-speaking="no" style={{ opacity: 0.7 }}>
                слухаю
              </span>
            )}
            <span style={{ opacity: 0.45 }}>·</span>
            <span>надіслано {radio.delivered}/{radio.sent}</span>
            <span style={{ opacity: 0.45 }}>·</span>
            <span>відтворено {radio.played}</span>
            {radio.missing > 0 && (
              <>
                <span style={{ opacity: 0.45 }}>·</span>
                <span>загублено {radio.missing}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
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
  if (
    snapshot.state === 'ringing' ||
    snapshot.state === 'calling' ||
    snapshot.state === 'connecting' ||
    snapshot.state === 'ended'
  ) {
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
              : snapshot.stall
                ? snapshot.stall.kind === 'no-path'
                  ? 'зʼєднання не встає'
                  : 'відповіді немає'
                : ringing
                  ? snapshot.media === 'video'
                    ? 'вхідний відеодзвінок'
                    : 'вхідний дзвінок'
                  : snapshot.state === 'connecting'
                    ? 'зʼєднуємось…'
                    : 'набираю…'}
          </div>
          {snapshot.state !== 'ended' && (
            <div className="mt-2 flex justify-center">
              <TrustRow verified={snapshot.peer?.verified} />
            </div>
          )}

          {/* Зʼєднання не встало за відведений час. Мовчати далі — брехати
              очікуванням; кажемо межу вголос і даємо вийти. */}
          {snapshot.stall && snapshot.state !== 'ended' && (
            <div
              data-call-stalled={snapshot.stall.kind}
              className="mt-4 p-3 rounded-2xl text-left"
              style={{ background: '#FDF6EC', border: '1px solid #EBD9BE' }}
            >
              <span className="text-[11.5px] leading-relaxed block" style={{ color: '#8C5A1A' }}>
                {snapshot.stall.note}
              </span>
              <button
                type="button"
                onClick={() => callEngine.hangup()}
                className="mt-2 text-[11.5px] font-bold active:scale-95 transition-transform"
                style={{ color: END }}
              >
                Припинити
              </button>
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
      data-call-mode={snapshot.radio ? 'radio' : 'live'}
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
            <div className="flex items-center gap-2.5 text-[12px] flex-wrap" style={{ color: MUTED }}>
              <CallTimer startedAt={snapshot.startedAt} />
              <span style={{ color: HAIRLINE }}>·</span>
              <TrustRow verified={snapshot.peer?.verified} />
              <span style={{ color: HAIRLINE }}>·</span>
              <LadderChip snapshot={snapshot} />
            </div>
          </div>
          <StatsLine snapshot={snapshot} />
        </div>

        <RadioBanner snapshot={snapshot} />

        {/* Коротка звістка про канал: сходинка змінилась або доріжка ожила.
            Живе кілька секунд і зникає — постійний банер про те, що вже
            минуло, тільки відволікає. */}
        {snapshot.linkNote && !snapshot.radio && (
          <div
            data-call-note
            className="px-5 py-2 text-[11.5px] border-b"
            style={{ background: NOTE_BG, borderColor: NOTE_EDGE, color: NOTE_INK }}
          >
            {snapshot.linkNote}
          </div>
        )}

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
              snapshot.radio
                ? 'У режимі рації відео не їде — тільки голос'
                : !snapshot.hasCamera
                  ? 'Дзвінок без відео'
                  : snapshot.cameraOn
                    ? 'Вимкнути камеру'
                    : 'Увімкнути камеру'
            }
            tone={snapshot.hasCamera && snapshot.cameraOn && !snapshot.radio ? 'plain' : 'accent'}
            disabled={!snapshot.hasCamera || !!snapshot.radio}
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
