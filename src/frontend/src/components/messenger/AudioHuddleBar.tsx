import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Hand,
  Video,
  PhoneOff,
  FileText,
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
  const transcript = huddleState.liveTranscript;

  if (!huddleState.active) return null;

  return (
    <div className="bg-[#FDFCF9]/95 backdrop-blur-xl border-b border-[#E6DFD3] shadow-md select-none z-20 text-[#1E2521]">
      {/* Compact Main Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Left: Indicator & Active Participants */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#F1EDE3] text-[#E87A42] rounded-full text-xs font-bold shrink-0 border border-[#E6DFD3]">
            <Mic className="w-3 h-3" />
            <span>Аудіо-простір</span>
          </div>

          {/* Participant Avatars with live speaking ring */}
          <div className="flex items-center -space-x-2 overflow-hidden">
            {huddleState.participants.map((p) => (
              <div key={p.id} className="relative group">
                <img
                  src={p.avatar}
                  alt={p.name}
                  className={`w-7 h-7 rounded-full object-cover ring-2 ${
                    p.isSpeaking ? 'ring-[#E87A42] scale-105' : 'ring-[#FDFCF9]'
                  }`}
                />
                {p.isSpeaking && (
                  <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#E87A42] rounded-full ring-1 ring-[#FDFCF9] animate-pulse" />
                )}
              </div>
            ))}
          </div>

          <span className="text-xs font-semibold text-[#1E2521] hidden sm:inline truncate">
            {huddleState.title}
          </span>
        </div>

        {/* Center: Mic status */}
        <div className="hidden md:flex items-center gap-1.5 h-6 px-3 bg-[#F7F5EE] rounded-full border border-[#E6DFD3]">
          {isMuted ? (
            <MicOff className="w-3 h-3 text-[#5F6A60]" />
          ) : (
            <Mic className="w-3 h-3 text-[#E87A42]" />
          )}
          <span className="text-[10px] font-medium text-[#5F6A60]">
            {isMuted ? 'Мікрофон вимкнено' : 'Мікрофон увімкнено'}
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
                ? 'bg-[#F9F7F1] text-[#5F6A60] hover:bg-[#E6DFD3]'
                : 'bg-[#E87A42] text-[#F7F5EE] shadow-sm font-bold'
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
                ? 'bg-[#F9F7F1] text-[#FBBF24] border border-[#E6DFD3]'
                : 'bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#E6DFD3] border border-[#E6DFD3]'
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
              className="p-2 bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#E87A42] rounded-full transition-colors border border-[#DDD4C4]"
              title="Відкрити HD Відео-Студію"
            >
              <Video className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2.5 py-1.5 bg-[#F9F7F1] hover:bg-[#E6DFD3] text-[#1E2521] border border-[#E6DFD3] rounded-full text-xs font-semibold flex items-center gap-1 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-[#E87A42]" />
            <span className="hidden lg:inline">Стенограма</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onLeaveHuddle();
            }}
            className="p-2 bg-[#F9F7F1] hover:bg-[#F9F7F1] text-red-400 rounded-full transition-colors border border-[#E6DFD3]"
            title="Залишити аудіо-ефір"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Стенограма: тільки те, що вузол справді записав */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-[#E6DFD3] bg-[#F7F5EE]/95 space-y-2 text-xs">
          <div className="flex items-center gap-1 text-[11px] font-bold text-[#5F6A60]">
            <FileText className="w-3.5 h-3.5 text-[#E87A42]" />
            <span>Стенограма зустрічі</span>
          </div>

          {transcript.length === 0 ? (
            <p className="text-[11px] text-[#7A8479] py-2">
              Стенограми ще немає — розпізнавання мовлення в аудіо-просторі не ведеться.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {transcript.map((t, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded-xl border text-xs flex items-start justify-between gap-2 bg-[#FDFCF9] border-[#F1EDE3] text-[#1E2521]"
                >
                  <div className="min-w-0">
                    <span className="font-bold mr-1.5 text-[#1E2521]">{t.speaker}:</span>
                    <span>{t.text}</span>
                  </div>
                  <span className="text-[10px] text-[#7A8479] shrink-0 font-mono">
                    {t.time}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
