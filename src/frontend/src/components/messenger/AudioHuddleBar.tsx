import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Hand,
  Video,
  PhoneOff,
  Sparkles,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { AudioHuddleState } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface AudioHuddleBarProps {
  huddleState: AudioHuddleState;
  onLeaveHuddle: () => void;
  onToggleMute: () => void;
  isMuted: boolean;
  onRaiseHand: () => void;
  hasRaisedHand: boolean;
  onOpenVideoModal?: () => void;
}

export const AudioHuddleBar: React.FC<AudioHuddleBarProps> = ({
  huddleState,
  onLeaveHuddle,
  onToggleMute,
  isMuted,
  onRaiseHand,
  hasRaisedHand,
  onOpenVideoModal,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(huddleState.liveTranscript);

  // Simulate incoming live transcript notes from audio
  useEffect(() => {
    if (!huddleState.active) return;
    const interval = setInterval(() => {
      const phrases = [
        { speaker: 'Марта', text: 'Я вже взяла столик на терасі біля квітів 🌸' },
        { speaker: 'Тарас', text: 'Зараз паркуюся біля Змієнка 🚗' },
        { speaker: 'Gemini Scribe ✦', text: 'Ключовий пункт: зустріч узгоджена на терасі, Тарас прибуває.' },
      ];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      setLiveTranscript((prev) => [
        ...prev.slice(-4),
        { ...randomPhrase, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    }, 12000);
    return () => clearInterval(interval);
  }, [huddleState.active]);

  if (!huddleState.active) return null;

  return (
    <div className="bg-[#121A15]/95 backdrop-blur-xl border-b border-[#1F2B22] shadow-md select-none z-20 text-[#E4EDE7]">
      {/* Compact Main Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Left: Indicator & Active Participants */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#183021] text-[#55C778] rounded-full text-xs font-bold shrink-0 border border-[#2A5439]">
            <span className="w-2 h-2 rounded-full bg-[#55C778] animate-ping" />
            <span>Живий аудіо-ефір</span>
          </div>

          {/* Participant Avatars with live speaking ring */}
          <div className="flex items-center -space-x-2 overflow-hidden">
            {huddleState.participants.map((p) => (
              <div key={p.id} className="relative group">
                <img
                  src={p.avatar}
                  alt={p.name}
                  className={`w-7 h-7 rounded-full object-cover ring-2 ${
                    p.isSpeaking ? 'ring-[#55C778] scale-105' : 'ring-[#121A15]'
                  }`}
                />
                {p.isSpeaking && (
                  <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#55C778] rounded-full ring-1 ring-[#121A15] animate-pulse" />
                )}
              </div>
            ))}
          </div>

          <span className="text-xs font-semibold text-white hidden sm:inline truncate">
            {huddleState.title}
          </span>
        </div>

        {/* Center: Live Waveform simulation */}
        <div className="hidden md:flex items-center gap-1 h-6 px-3 bg-[#0E1410] rounded-full border border-[#1F2B22]">
          {[12, 24, 18, 28, 14, 26, 16, 22, 10].map((h, i) => (
            <div
              key={i}
              className="w-1 bg-[#55C778] rounded-full"
              style={{
                height: isMuted ? '4px' : `${h}px`,
                transition: 'height 0.2s ease',
              }}
            />
          ))}
          <span className="text-[10px] font-medium text-[#8EA093] ml-1">
            {isMuted ? 'Мікрофон вимкнено' : 'Пряма мова'}
          </span>
        </div>

        {/* Right: Controls (Mic, Hand, AI Notes Toggle, Leave) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              soundFx.playTap();
              onToggleMute();
            }}
            className={`p-2 rounded-full font-semibold text-xs flex items-center gap-1 transition-all ${
              isMuted
                ? 'bg-[#1A251E] text-[#8EA093] hover:bg-[#223126]'
                : 'bg-[#55C778] text-[#0C120E] shadow-sm font-bold'
            }`}
            title={isMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onRaiseHand();
            }}
            className={`p-2 rounded-full transition-colors ${
              hasRaisedHand
                ? 'bg-[#2E2413] text-[#FBBF24] border border-[#4E3C1E]'
                : 'bg-[#1A251E] text-[#8EA093] hover:text-white hover:bg-[#223126] border border-[#26372B]'
            }`}
            title="Підняти руку"
          >
            <Hand className="w-3.5 h-3.5" />
          </button>

          {onOpenVideoModal && (
            <button
              onClick={() => {
                soundFx.playTap();
                onOpenVideoModal();
              }}
              className="p-2 bg-[#1A261D] hover:bg-[#223326] text-[#55C778] rounded-full transition-colors border border-[#2B3E31]"
              title="Відкрити HD Відео-Студію"
            >
              <Video className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2.5 py-1.5 bg-[#1A251E] hover:bg-[#223126] text-[#E4EDE7] border border-[#26372B] rounded-full text-xs font-semibold flex items-center gap-1 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#55C778]" />
            <span className="hidden lg:inline">AI Стенограма</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onLeaveHuddle();
            }}
            className="p-2 bg-[#2D1616] hover:bg-[#3D1E1E] text-red-400 rounded-full transition-colors border border-[#4D2424]"
            title="Залишити аудіо-ефір"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded Live AI Transcript drawer */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-[#1F2B22] bg-[#0E1410]/95 space-y-2 text-xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#8EA093]">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[#55C778]" />
              Жива стенограма та авто-протокол зустрічі (Gemini Live Scribe)
            </span>
            <span>Оновлюється в реальному часі</span>
          </div>

          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {liveTranscript.map((t, idx) => (
              <div
                key={idx}
                className={`p-2 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                  t.speaker.includes('Gemini')
                    ? 'bg-[#142318] border-[#223A28] text-[#55C778]'
                    : 'bg-[#141C16] border-[#233127] text-[#D1DFD6]'
                }`}
              >
                <div className="min-w-0">
                  <span className="font-bold mr-1.5 text-white">{t.speaker}:</span>
                  <span>{t.text}</span>
                </div>
                <span className="text-[10px] text-[#6B8072] shrink-0 font-mono">
                  {t.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
