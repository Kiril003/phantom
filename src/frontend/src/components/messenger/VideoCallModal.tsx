import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  PhoneOff,
  Hand,
  Disc,
  Sparkles,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Zap,
  Volume2
} from 'lucide-react';
import type { AudioHuddleState } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface VideoCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  huddleState: AudioHuddleState;
  currentUserId?: string;
  onToggleMute: () => void;
  isMuted: boolean;
  onToggleVideo: () => void;
  isVideoOn: boolean;
  onToggleScreenShare: () => void;
  isScreenSharing: boolean;
  onToggleHand: () => void;
  hasRaisedHand: boolean;
  onToggleRecording: () => void;
  isRecording: boolean;
  onLeaveHuddle: () => void;
}

export const VideoCallModal: React.FC<VideoCallModalProps> = ({
  isOpen,
  onClose,
  huddleState,
  onToggleMute,
  isMuted,
  onToggleVideo,
  isVideoOn,
  onToggleScreenShare,
  isScreenSharing,
  onToggleHand,
  hasRaisedHand,
  onToggleRecording,
  isRecording,
  onLeaveHuddle,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [studioQuality, setStudioQuality] = useState<'studio-hd-48khz' | 'standard'>('studio-hd-48khz');
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  if (!isOpen) return null;

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md animate-fadeIn select-none p-2 sm:p-4">
      <div className={`flex flex-col bg-[#141A16] border border-[#2D3930] rounded-3xl w-full h-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl transition-all duration-300 relative`}>
        
        {/* 1. Top Bar */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-[#232F26] bg-[#19221C]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-[#E87A42]/20 flex items-center justify-center text-[#E87A42] border border-[#E87A42]/30">
              <Zap className="w-5 h-5 text-[#E87A42]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base sm:text-lg">{huddleState.title || 'Studio HD Room'}</h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#26372B] text-[#55C778] border border-[#3E5C46] flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  E2EE Захищено
                </span>
                {isRecording && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-950/80 text-red-400 border border-red-800 flex items-center gap-1.5 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    REC {formatTimer(recordingSeconds)} · Хмарний запис
                  </span>
                )}
              </div>
              <p className="text-xs text-[#8A9C8F] flex items-center gap-2 mt-0.5">
                <span>{huddleState.participants.length} учасників</span>
                <span>•</span>
                <span className="text-[#E87A42] font-mono">Opus 48kHz (128 kbps) Fullband Stereo</span>
              </p>
            </div>
          </div>

          {/* Right Top Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                soundFx.playTap();
                setStudioQuality(studioQuality === 'studio-hd-48khz' ? 'standard' : 'studio-hd-48khz');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                studioQuality === 'studio-hd-48khz'
                  ? 'bg-[#E87A42]/20 text-[#E87A42] border border-[#E87A42]/40'
                  : 'bg-[#232F26] text-[#A6B8AB] hover:text-white'
              }`}
              title="Перемкнути аудіопрофіль"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{studioQuality === 'studio-hd-48khz' ? 'HD Studio' : 'Eco'}</span>
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 text-[#8A9C8F] hover:text-white hover:bg-[#232F26] rounded-xl transition-colors"
              title={isFullscreen ? 'Згорнути' : 'На весь екран'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-[#8A9C8F] hover:text-white hover:bg-[#232F26] rounded-xl transition-colors ml-1"
              title="Згорнути у плашку"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 2. Main Stage & Video Grid */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">
          {/* Video / Screen Tiles Stage */}
          <div className="flex-1 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto bg-[#0E1310] auto-rows-fr">
            {/* My tile */}
            <div className="relative rounded-2xl overflow-hidden bg-[#1B241E] border border-[#2D3930] flex flex-col items-center justify-center group shadow-md min-h-[180px]">
              {isVideoOn ? (
                <div className="w-full h-full bg-gradient-to-tr from-slate-900 via-emerald-950 to-stone-900 flex items-center justify-center relative">
                  <span className="text-sm font-semibold text-emerald-300">Камера 1080p Active (HD)</span>
                  <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/60 rounded-md text-[10px] text-emerald-400 font-mono">
                    60 FPS • 3.2 Mbps
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=faces"
                      alt="Ви"
                      className="w-20 h-20 rounded-full object-cover ring-4 ring-[#2D3930]"
                    />
                    {!isMuted && (
                      <span className="absolute inset-0 rounded-full ring-4 ring-[#55C778] animate-ping opacity-60 pointer-events-none" />
                    )}
                  </div>
                  <span className="text-xs font-semibold text-white">Ви (Я)</span>
                </div>
              )}

              {/* Status pills inside tile */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <span className="px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-lg text-xs font-medium text-white/90">
                  Ви {isScreenSharing && '• 🖥️ Екран'}
                </span>
                <div className="flex items-center gap-1.5">
                  {hasRaisedHand && (
                    <span className="p-1 bg-amber-500/80 rounded-md text-white">
                      <Hand className="w-3 h-3" />
                    </span>
                  )}
                  {isMuted ? (
                    <span className="p-1 bg-red-500/80 rounded-md text-white">
                      <MicOff className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className="p-1 bg-emerald-500/80 rounded-md text-white animate-pulse">
                      <Mic className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Other participants tiles */}
            {huddleState.participants.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-2xl overflow-hidden bg-[#1B241E] border ${
                  p.isSpeaking ? 'border-[#E87A42] ring-2 ring-[#E87A42]/40 shadow-lg' : 'border-[#2D3930]'
                } flex flex-col items-center justify-center min-h-[180px]`}
              >
                {p.isVideoOn ? (
                  <div className="w-full h-full bg-gradient-to-tr from-stone-900 to-amber-950 flex items-center justify-center relative">
                    <span className="text-sm font-semibold text-amber-200">{p.name} (Live Stream)</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <img
                        src={p.avatar}
                        alt={p.name}
                        className="w-20 h-20 rounded-full object-cover ring-4 ring-[#2D3930]"
                      />
                      {p.isSpeaking && (
                        <span className="absolute inset-0 rounded-full ring-4 ring-[#E87A42] animate-ping opacity-75 pointer-events-none" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-white">{p.name}</span>
                  </div>
                )}

                {/* Status bottom bar */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                  <span className="px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-lg text-xs font-medium text-white/90">
                    {p.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {p.hasRaisedHand && (
                      <span className="p-1 bg-amber-500/80 rounded-md text-white">
                        <Hand className="w-3 h-3" />
                      </span>
                    )}
                    {p.isMuted ? (
                      <span className="p-1 bg-red-500/80 rounded-md text-white">
                        <MicOff className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="p-1 bg-emerald-500/80 rounded-md text-white">
                        <Mic className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right Side: Gemini Live Scribe & Meeting Transcript */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[#232F26] bg-[#161E18] flex flex-col shrink-0">
            <div className="p-3 border-b border-[#232F26] flex items-center gap-2 text-xs font-bold text-[#55C778]">
              <Sparkles className="w-4 h-4 text-[#E87A42]" />
              <span>Gemini Live Scribe (Розшифровка)</span>
            </div>
            
            <div className="flex-1 p-3 overflow-y-auto space-y-2.5 font-sans">
              {huddleState.liveTranscript.map((t, idx) => (
                <div key={idx} className="p-2.5 rounded-xl bg-[#1D2720] border border-[#2B392E] text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[#E87A42]">{t.speaker}</span>
                    <span className="text-[10px] text-[#7A8C7E] font-mono">{t.time}</span>
                  </div>
                  <p className="text-[#D3DFD6] leading-relaxed">{t.text}</p>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-[#232F26] bg-[#121814]">
              <p className="text-[11px] text-[#86998B] leading-tight">
                ✦ ШІ автоматично фіксує домовленості та згенерує протокол зустрічі після завершення.
              </p>
            </div>
          </div>
        </div>

        {/* 3. Bottom Control Bar */}
        <div className="px-6 py-4 bg-[#19221C] border-t border-[#232F26] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* Live Audio Level Equalizer Bars */}
            <div className="flex items-center gap-1 h-6 px-3 bg-[#121814] rounded-full border border-[#2B392E]">
              {[14, 28, 18, 32, 16, 26, 20, 30, 12].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-[#55C778] rounded-full transition-all duration-150"
                  style={{
                    height: isMuted ? '4px' : `${h}px`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Center Call Actions */}
          <div className="flex items-center gap-3">
            {/* Mic Toggle */}
            <button
              onClick={() => {
                soundFx.playTap();
                onToggleMute();
              }}
              className={`p-3.5 rounded-2xl font-bold transition-all shadow-md active:scale-95 ${
                isMuted
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                  : 'bg-[#55C778] text-[#0E1310] hover:bg-[#4BB66B]'
              }`}
              title={isMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* Video Toggle */}
            <button
              onClick={() => {
                soundFx.playTap();
                onToggleVideo();
              }}
              className={`p-3.5 rounded-2xl font-bold transition-all shadow-md active:scale-95 ${
                !isVideoOn
                  ? 'bg-[#28362C] text-[#8EA093] hover:text-white'
                  : 'bg-[#55C778] text-[#0E1310] hover:bg-[#4BB66B]'
              }`}
              title={isVideoOn ? 'Вимкнути камеру' : 'Увімкнути камеру 1080p'}
            >
              {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>

            {/* Screen Share */}
            <button
              onClick={() => {
                soundFx.playTap();
                onToggleScreenShare();
              }}
              className={`p-3.5 rounded-2xl font-bold transition-all shadow-md active:scale-95 ${
                isScreenSharing
                  ? 'bg-[#E87A42] text-white'
                  : 'bg-[#28362C] text-[#8EA093] hover:text-white'
              }`}
              title="Поділитися екраном"
            >
              <ScreenShare className="w-5 h-5" />
            </button>

            {/* Raise Hand */}
            <button
              onClick={() => {
                soundFx.playTap();
                onToggleHand();
              }}
              className={`p-3.5 rounded-2xl font-bold transition-all shadow-md active:scale-95 ${
                hasRaisedHand
                  ? 'bg-amber-500 text-[#0E1310]'
                  : 'bg-[#28362C] text-[#8EA093] hover:text-white'
              }`}
              title="Підняти руку"
            >
              <Hand className="w-5 h-5" />
            </button>

            {/* Recording Toggle */}
            <button
              onClick={() => {
                soundFx.playChime();
                onToggleRecording();
              }}
              className={`p-3.5 rounded-2xl font-bold transition-all shadow-md active:scale-95 ${
                isRecording
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'bg-[#28362C] text-[#8EA093] hover:text-white'
              }`}
              title="Запис зустрічі у хмару"
            >
              <Disc className="w-5 h-5" />
            </button>

            {/* Leave / End Call */}
            <button
              onClick={() => {
                soundFx.playHuddleLeave();
                onLeaveHuddle();
                onClose();
              }}
              className="px-5 py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-2 shadow-lg active:scale-95 transition-all ml-2"
            >
              <PhoneOff className="w-5 h-5" />
              <span className="hidden sm:inline">Завершити</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[#28362C] text-xs font-bold text-white rounded-xl hover:bg-[#344538] transition-colors"
            >
              Згорнути
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
