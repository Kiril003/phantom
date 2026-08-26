import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Hand,
  Radio,
  Share2,
  Check,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface Participant {
  id: string;
  name: string;
  avatar: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  handRaised: boolean;
  role: 'host' | 'speaker' | 'listener';
  volume: number;
}

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

  const [participants, setParticipants] = useState<Participant[]>([
    {
      id: 'p_kiril',
      name: 'Кирило (Ви)',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      isMuted: false,
      isSpeaking: false,
      isScreenSharing: false,
      handRaised: false,
      role: 'host',
      volume: 0,
    },
    {
      id: 'p_sanya',
      name: 'Саня (Lead Dev)',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
      isMuted: false,
      isSpeaking: true,
      isScreenSharing: false,
      handRaised: false,
      role: 'speaker',
      volume: 68,
    },
    {
      id: 'p_maryna',
      name: 'Марина (Designer)',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
      isMuted: true,
      isSpeaking: false,
      isScreenSharing: false,
      handRaised: true,
      role: 'listener',
      volume: 0,
    },
  ]);

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

          setParticipants((prev) =>
            prev.map((p) =>
              p.id === 'p_kiril'
                ? { ...p, isSpeaking: !isMuted && vol > 15, volume: isMuted ? 0 : vol }
                : p
            )
          );

          animFrameRef.current = requestAnimationFrame(updateVol);
        };
        updateVol();
      } catch (err) {
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
    setParticipants((prev) =>
      prev.map((p) => (p.id === 'p_kiril' ? { ...p, handRaised: !isHandRaised } : p))
    );
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[88vh] bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden flex flex-col text-[#21261F]">
        {/* Top Bar */}
        <div className="p-4 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-emerald-700 shadow-sm">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#21261F]">Huddle: {chatTitle}</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold font-mono">
                  ● LIVE {formatTime(secondsActive)}
                </span>
              </div>
              <p className="text-xs text-[#6E7568] mt-0.5">
                P2P Mesh аудіо/відео простір • Швидка синхронізація без дзвінків
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyP2PLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E5DEC9] hover:bg-[#FDF5ED] text-xs font-semibold text-[#21261F] transition-all shadow-xs"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5 text-[#D96C35]" />}
              <span>{copiedLink ? 'Скопійовано!' : 'Запросити піра'}</span>
            </button>

            <button
              onClick={() => {
                soundFx.playChime();
                onClose();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-all"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Покинути Huddle</span>
            </button>
          </div>
        </div>

        {/* Main Workspace: Screen Share or Grid */}
        <div className="flex-1 min-h-0 p-5 bg-[#FAF7F0] overflow-y-auto flex flex-col gap-4">
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

          {/* Participant Tiles Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 flex-1">
            {participants.map((p) => (
              <div
                key={p.id}
                className={`relative p-5 rounded-2xl border transition-all flex flex-col items-center justify-center gap-3 ${
                  p.isSpeaking
                    ? 'bg-[#FDF9F3] border-[#D96C35] ring-2 ring-[#D96C35]/30 shadow-md'
                    : 'bg-[#FDFCF9] border-[#E5DEC9] shadow-xs'
                }`}
              >
                {/* Hand raise badge */}
                {p.handRaised && (
                  <div className="absolute top-3 left-3 px-2 py-1 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-bold flex items-center gap-1 animate-bounce">
                    <Hand className="w-3.5 h-3.5" />
                    <span>Підняв руку</span>
                  </div>
                )}

                {/* Role / Mute status */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  {p.isMuted ? (
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
                  <img
                    src={p.avatar}
                    alt={p.name}
                    className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md"
                  />
                  {p.isSpeaking && (
                    <div
                      className="absolute inset-0 rounded-full border-4 border-[#D96C35] animate-ping opacity-60 pointer-events-none"
                      style={{ animationDuration: '1.2s' }}
                    />
                  )}
                </div>

                {/* Name & Volume Indicator */}
                <div className="text-center w-full px-2">
                  <h4 className="text-sm font-bold text-[#21261F] truncate">{p.name}</h4>
                  <p className="text-[11px] text-[#6E7568]">
                    {p.role === 'host' ? '👑 Організатор' : p.role === 'speaker' ? '🎙️ Спікер' : 'Слухач'}
                  </p>

                  {/* Dynamic waveform bar */}
                  <div className="w-full bg-[#E5DEC9] h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-[#D96C35] transition-all duration-100"
                      style={{ width: `${p.volume}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Floating Emoji Reactions Overlay */}
          {activeReaction && (
            <div className="fixed bottom-24 right-1/2 translate-x-1/2 px-4 py-2 rounded-2xl bg-black/80 text-white text-3xl animate-bounce shadow-2xl z-50">
              {activeReaction}
            </div>
          )}
        </div>

        {/* Bottom Control Dock */}
        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs shadow-xs transition-all ${
                isMuted
                  ? 'bg-red-50 text-red-700 border border-red-300'
                  : 'bg-[#D96C35] hover:bg-[#B85425] text-white'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{isMuted ? 'Мікрофон вимкнено' : 'Мікрофон ON'}</span>
            </button>

            <button
              onClick={toggleScreenShare}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs border transition-all ${
                isScreenSharing
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                  : 'bg-white hover:bg-[#FDF5ED] text-[#21261F] border-[#E5DEC9]'
              }`}
            >
              <Monitor className="w-4 h-4 text-indigo-600" />
              <span>{isScreenSharing ? 'Зупинити екран' : 'Поділитися екраном'}</span>
            </button>

            <button
              onClick={toggleHand}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-2xl font-bold text-xs border transition-all ${
                isHandRaised
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-white hover:bg-[#FDF5ED] text-[#6E7568] border-[#E5DEC9]'
              }`}
              title="Підняти руку"
            >
              <Hand className="w-4 h-4" />
              <span>{isHandRaised ? 'Руку піднято' : 'Підняти руку'}</span>
            </button>
          </div>

          {/* Quick Reaction Bar */}
          <div className="flex items-center gap-1.5 bg-white border border-[#E5DEC9] p-1.5 rounded-2xl">
            {['🔥', '👏', '💡', '🚀', '❤️', '👍'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="w-8 h-8 rounded-xl hover:bg-[#FAF7F0] text-base flex items-center justify-center transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
