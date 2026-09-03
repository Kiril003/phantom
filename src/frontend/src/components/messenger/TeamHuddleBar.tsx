import React, { useState } from 'react';
import { Radio, Mic, MicOff, PhoneOff, Maximize2 } from 'lucide-react';
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

  // ЩО БУЛО: список `participants` із двома вписаними в код людьми — «Саня»
  // (нібито говорить, приєднався «5 хв тому») і «Марина» (нібито з вимкненим
  // мікрофоном, «3 хв тому»), обидві з фотографіями з images.unsplash.com.
  // Поверх них ще й крутився setInterval, який кожні 1500 мс перекидав
  // `isSpeaking` через `Math.random() > 0.4` — тобто вигадана людина ще й
  // вигадано говорила, і чіп у шапці показував «Huddle (2)» у порожній кімнаті.
  // ЧОМУ ПРИБРАНО: вузли не переказують одне одному стану гуртків узагалі,
  // тож ані другого учасника, ані його мовлення взятися нізвідки. Лічильник
  // теж прибрано: рахувати тут можна тільки себе, і про це чесніше словом.

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
            <span>{inHuddle ? 'Huddle · ви' : 'Huddle'}</span>
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
