import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Hand,
  Radio,
  Share2,
  Check,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { Avatar } from './Avatar';
import { useMessengerStore } from '../../stores/messengerStore';

// ЩО БУЛО: тип `Participant` описував список із трьох учасників гуртка.
// ЧОМУ ПРИБРАНО: двоє з тих трьох були вписані в код (див. коментар біля
// плитки нижче), а третій — це ви. На одного локального учасника список
// не потрібен: його стан тримають звичайні прапорці нижче.

interface TeamHuddleStudioProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle: string;
}

export const TeamHuddleStudio: React.FC<TeamHuddleStudioProps> = ({
  isOpen,
  onClose,
  chatTitle,
}) => {
  const currentUser = useMessengerStore((st) => st.currentUser);

  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [secondsActive, setSecondsActive] = useState(0);
  const [activeReaction, setActiveReaction] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Єдиний учасник, про якого тут є правда, — ви. Гучність і «говорить»
  // рахуються з живого мікрофонного потоку нижче, а не задаються числом.
  const [selfVolume, setSelfVolume] = useState(0);
  const [selfSpeaking, setSelfSpeaking] = useState(false);

  // Timer
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setSecondsActive((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  // Real Microphone Capture & Visualizer
  useEffect(() => {
    if (!isOpen) {
      cleanupStreams();
      return;
    }

    async function initMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStreamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateVol = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const vol = Math.min(100, Math.round((avg / 128) * 100));

          setSelfSpeaking(!isMuted && vol > 15);
          setSelfVolume(isMuted ? 0 : vol);

          animFrameRef.current = requestAnimationFrame(updateVol);
        };
        updateVol();
      } catch (err) {
        // Мікрофон не дали або його немає. Нічого не підставляємо: смуга
        // гучності лишається на нулі, «говорить» — false. Саме тут раніше
        // було найлегше намалювати живу кімнату там, де немає навіть звуку.
        console.warn('Real microphone capture not permitted or available:', err);
      }
    }

    initMic();

    return () => cleanupStreams();
  }, [isOpen, isMuted]);

  const cleanupStreams = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const toggleScreenShare = async () => {
    soundFx.playTap();
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = stream;
          screenVideoRef.current.play().catch(() => {});
        }
        setIsScreenSharing(true);
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
        };
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
      }
    } else {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      setIsScreenSharing(false);
    }
  };

  const toggleMic = () => {
    soundFx.playTap();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (micStreamRef.current) {
      micStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    }
  };

  const toggleHand = () => {
    soundFx.playTap();
    setIsHandRaised(!isHandRaised);
  };

  const sendReaction = (emoji: string) => {
    soundFx.playSend();
    setActiveReaction(emoji);
    setTimeout(() => setActiveReaction(null), 2500);
  };

  const copyP2PLink = () => {
    soundFx.playTap();
    navigator.clipboard.writeText(`https://try.phantom-os.dev/huddle/${encodeURIComponent(chatTitle)}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] bg-[#FDFCF9] border border-[#E5DEC9] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#21261F] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="px-4 py-3 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-emerald-700 shadow-xs shrink-0">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#21261F] truncate">Huddle: {chatTitle}</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold font-mono shrink-0">
                  ● LIVE {formatTime(secondsActive)}
                </span>
              </div>
              <p className="text-[11px] text-[#6E7568] truncate">
                P2P Mesh аудіо/відео простір • Швидка синхронізація
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={copyP2PLink}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#E5DEC9] hover:bg-[#FDF5ED] text-xs font-semibold text-[#21261F] transition-all shadow-2xs"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5 text-[#D96C35]" />}
              <span className="hidden sm:inline">{copiedLink ? 'Скопійовано!' : 'Запросити'}</span>
            </button>

            <button
              onClick={() => {
                soundFx.playChime();
                onClose();
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-xs transition-all"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Покинути</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors ml-1"
              title="Закрити вікно"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Workspace: Screen Share or Grid */}
        <div className="flex-1 min-h-0 p-4 sm:p-5 bg-[#FAF7F0] overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {/* Active Screen Sharing Display */}
          {isScreenSharing && (
            <div className="relative w-full aspect-video max-h-[50vh] bg-[#111] rounded-2xl overflow-hidden border border-[#E5DEC9] shadow-lg flex items-center justify-center">
              <video
                ref={screenVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-xl text-white text-xs font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Ваша демонстрація екрана</span>
              </div>
            </div>
          )}

          {/* ЩО БУЛО: сітка з трьох плиток. Дві з них — «Саня (Lead Dev)» і
              «Марина (Designer)» — були вписані просто в код, разом із
              фотографіями з images.unsplash.com, власними isMuted/isSpeaking/
              handRaised і навіть гучністю 68. Тобто Саня «говорив», а Марина
              «підняла руку» в кімнаті, до якої ніхто ніколи не приєднувався.
              Третя плитка звалася «Кирило (Ви)» — ім'я власника, вписане в код.
              ЧОМУ ПРИБРАНО: вузли не обмінюються сигналами про гуртки взагалі,
              тож будь-який другий учасник тут може бути тільки вигаданим.
              Лишився один справжній — ви: гучність береться з живого потоку
              мікрофона, а ім'я та аватарка — з вашого профілю, не з рядка. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div
              className={`relative p-5 rounded-2xl border transition-all flex flex-col items-center justify-center gap-3 ${
                selfSpeaking
                  ? 'bg-[#FDF9F3] border-[#D96C35] ring-2 ring-[#D96C35]/30 shadow-md'
                  : 'bg-[#FDFCF9] border-[#E5DEC9] shadow-xs'
              }`}
            >
              {/* Hand raise badge */}
              {isHandRaised && (
                <div className="absolute top-3 left-3 px-2 py-1 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-bold flex items-center gap-1 animate-bounce">
                  <Hand className="w-3.5 h-3.5" />
                  <span>Підняв руку</span>
                </div>
              )}

              {/* Mute status */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                {isMuted ? (
                  <span className="p-1 rounded-lg bg-red-100 text-red-600" title="Вимкнено мікрофон">
                    <MicOff className="w-3.5 h-3.5" />
                  </span>
                ) : (
                  <span className="p-1 rounded-lg bg-emerald-100 text-emerald-700" title="Мікрофон активний">
                    <Mic className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>

              {/* Avatar with Live Volume Ring */}
              <div className="relative">
                <Avatar
                  src={currentUser.avatar}
                  name={currentUser.name}
                  className="w-20 h-20 text-xl border-2 border-white shadow-md"
                  radius="rounded-full"
                />
                {selfSpeaking && (
                  <div
                    className="absolute inset-0 rounded-full border-4 border-[#D96C35] animate-ping opacity-60 pointer-events-none"
                    style={{ animationDuration: '1.2s' }}
                  />
                )}
              </div>

              {/* Name & Volume Indicator */}
              <div className="text-center w-full px-2">
                <h4 className="text-sm font-bold text-[#21261F] truncate">{currentUser.name}</h4>
                <p className="text-[11px] text-[#6E7568]">Ви · цей пристрій</p>

                {/* Dynamic waveform bar */}
                <div className="w-full bg-[#E5DEC9] h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-[#D96C35] transition-all duration-100"
                    style={{ width: `${selfVolume}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Порожньо тут не через тишу співрозмовників, а через відсутність
              каналу — і сказати треба саме це. */}
          <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl text-center space-y-1">
            <p className="text-sm font-bold text-[#21261F]">Крім вас, у гуртку нікого немає</p>
            <p className="text-[11px] text-[#6E7568] leading-relaxed">
              Мікрофон і демонстрація екрана працюють на цьому пристрої. Інші
              учасники не з'являться не тому, що мовчать: вузли поки не
              переказують одне одному, що гурток відкрито, тож приєднатися
              сюди нема як.
            </p>
          </div>

          {/* Floating Emoji Reactions Overlay */}
          {activeReaction && (
            <div className="fixed bottom-24 right-1/2 translate-x-1/2 px-4 py-2 rounded-2xl bg-black/80 text-white text-3xl animate-bounce shadow-2xl z-50">
              {activeReaction}
            </div>
          )}
        </div>

        {/* Bottom Control Dock */}
        <div className="p-3 sm:p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs shadow-xs transition-all ${
                isMuted
                  ? 'bg-red-50 text-red-700 border border-red-300'
                  : 'bg-[#D96C35] hover:bg-[#B85425] text-white'
              }`}
            >
              {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{isMuted ? 'Мікрофон OFF' : 'Мікрофон ON'}</span>
            </button>

            <button
              onClick={toggleScreenShare}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs border transition-all ${
                isScreenSharing
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                  : 'bg-white hover:bg-[#FDF5ED] text-[#21261F] border-[#E5DEC9]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isScreenSharing ? 'Зупинити' : 'Екран'}</span>
            </button>

            <button
              onClick={toggleHand}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs border transition-all ${
                isHandRaised
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-white hover:bg-[#FDF5ED] text-[#6E7568] border-[#E5DEC9]'
              }`}
              title="Підняти руку"
            >
              <Hand className="w-3.5 h-3.5" />
              <span>{isHandRaised ? 'Рука' : 'Підняти'}</span>
            </button>
          </div>

          {/* Quick Reaction Bar */}
          <div className="flex items-center gap-1 bg-white border border-[#E5DEC9] p-1 rounded-xl">
            {['🔥', '👏', '💡', '🚀', '❤️', '👍'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="w-7 h-7 rounded-lg hover:bg-[#FAF7F0] text-sm flex items-center justify-center transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
