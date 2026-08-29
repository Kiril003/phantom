import React, { useState, useEffect } from 'react';
import { Radio, Mic, MicOff, PhoneOff, Maximize2 } from 'lucide-react';
import { HuddleParticipant } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { TeamHuddleStudio } from './TeamHuddleStudio';

interface TeamHuddleBarProps {
  chatTitle: string;
  isHuddleActive: boolean;
  onStartHuddle?: () => void;
  onLeaveHuddle?: () => void;
}

export const TeamHuddleBar: React.FC<TeamHuddleBarProps> = ({
  chatTitle,
  isHuddleActive,
  onStartHuddle,
  onLeaveHuddle,
}) => {
  const [inHuddle, setInHuddle] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);

  const [participants, setParticipants] = useState<HuddleParticipant[]>([
    {
      userId: 'u_sanya',
      name: 'Саня',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
      isMuted: false,
      isSpeaking: true,
      isScreenSharing: false,
      joinedAt: '5 хв тому',
    },
    {
      userId: 'u_maryna',
      name: 'Марина',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
      isMuted: true,
      isSpeaking: false,
      isScreenSharing: false,
      joinedAt: '3 хв тому',
    },
  ]);

  useEffect(() => {
    if (!inHuddle) return;
    const interval = setInterval(() => {
      setParticipants((prev) =>
        prev.map((p) => ({
          ...p,
          isSpeaking: p.isMuted ? false : Math.random() > 0.4,
        }))
      );
    }, 1500);
    return () => clearInterval(interval);
  }, [inHuddle]);

  const toggleJoin = () => {
    soundFx.playTap();
    if (!inHuddle) {
      setInHuddle(true);
      setIsStudioOpen(true);
      onStartHuddle?.();
    } else {
      setInHuddle(false);
      setIsStudioOpen(false);
      onLeaveHuddle?.();
    }
  };

  return (
    <>
      {!isHuddleActive && !inHuddle ? (
        <button
          onClick={toggleJoin}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF7F0] hover:bg-[#FDF5ED] border border-[#E5DEC9] text-[#6E7568] hover:text-[#D96C35] text-xs font-semibold transition-all shadow-2xs"
          title="Розпочати швидкий голосовий Huddle"
        >
          <Radio className="w-3.5 h-3.5 text-[#D96C35]" />
          <span>Huddle</span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-300 rounded-full shadow-2xs">
          <button
            onClick={() => setIsStudioOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
            title="Розгорнути студію Huddle"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Huddle ({participants.length})</span>
            <Maximize2 className="w-3 h-3 text-emerald-700" />
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              setIsMuted(!isMuted);
            }}
            className={`p-1 rounded-full border transition-colors ${
              isMuted ? 'bg-red-100 text-red-600 border-red-200' : 'bg-white text-emerald-800 border-emerald-200'
            }`}
            title={isMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
          >
            {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          </button>

          <button
            onClick={toggleJoin}
            className="p-1 rounded-full bg-red-600 hover:bg-red-700 text-white"
            title="Вийти з Huddle"
          >
            <PhoneOff className="w-3 h-3" />
          </button>
        </div>
      )}

      {isStudioOpen && (
        <TeamHuddleStudio
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          chatTitle={chatTitle}
        />
      )}
    </>
  );
};
