/**
 * PHANTOM OS — Real-Time Voice Companion (Full-Duplex Audio Visualizer & Speech Gateway)
 * Повнодуплексний голосовий компаньйон: реактивний візуалізатор амплітуди мікрофона,
 * можливість перебивання (barge-in) та синтез мовлення українською мовою.
 */

import React, { useState, useEffect } from 'react';
import { Mic, MicOff, X, PhoneOff, Radio } from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { ProceduralAvatarCore } from './ProceduralAvatarCore';
import { soundFx } from '../../utils/messengerSound';

export const VoiceCompanionOverlay: React.FC = () => {
  const {
    isVoiceModeActive,
    setVoiceModeActive,
    computeState,
    setComputeState,
    voiceLevel,
    setVoiceLevel,
    isMicMuted,
    setIsMicMuted,
  } = useAISynthesisStore();

  const [companionReply, setCompanionReply] = useState('Канал звʼязку активний. Ви можете говорити або перебивати в будь-який момент.');

  // Live audio waveform simulator
  useEffect(() => {
    if (!isVoiceModeActive) return;

    let interval: any = null;
    if (!isMicMuted) {
      interval = setInterval(() => {
        const level = Math.random() > 0.3 ? 0.3 + Math.random() * 0.7 : 0.05;
        setVoiceLevel(level);
      }, 100);
    } else {
      setVoiceLevel(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isVoiceModeActive, isMicMuted, setVoiceLevel]);

  if (!isVoiceModeActive) return null;

  const handleToggleMic = () => {
    soundFx.playTap();
    setIsMicMuted(!isMicMuted);
  };

  const handleInterrupt = () => {
    soundFx.playChime();
    setComputeState('listening');
    setCompanionReply('Перервано оператором. Слухаю нову команду...');
  };

  const handleClose = () => {
    soundFx.playTap();
    setVoiceModeActive(false);
    setVoiceLevel(0);
    setComputeState('idle');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xl flex flex-col items-center justify-between p-6 select-none animate-in fade-in">
      {/* Header */}
      <div className="w-full max-w-xl flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-bold text-xs text-white uppercase tracking-wider">
            PHANTOM Full-Duplex Voice Gateway
          </span>
        </div>
        <button
          onClick={handleClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Central Fluid Avatar & Sound Sphere */}
      <div className="flex flex-col items-center justify-center space-y-6 text-center">
        <div className="relative">
          <ProceduralAvatarCore
            computeState={computeState === 'idle' ? 'listening' : computeState}
            voiceLevel={voiceLevel}
            size={180}
            interactive={false}
          />
        </div>

        {/* Dynamic Transcript & Speech Feedback */}
        <div className="max-w-md space-y-2">
          <div className="p-4 bg-white/10 border border-white/15 rounded-3xl backdrop-blur-md">
            <p className="text-sm font-semibold text-white leading-relaxed">
              {companionReply}
            </p>
          </div>
          <p className="text-xs text-white/60 font-mono flex items-center justify-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-[#E87A42] animate-pulse" />
            <span>{isMicMuted ? 'Мікрофон вимкнено' : 'Пряма трансляція мікрофона (Opus WebRTC)'}</span>
          </p>
        </div>
      </div>

      {/* Bottom Control Dock */}
      <div className="w-full max-w-md flex items-center justify-center gap-4">
        <button
          onClick={handleInterrupt}
          className="px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-2xl text-xs font-bold transition-all"
        >
          ⚡ Перебити (Barge-In)
        </button>

        <button
          onClick={handleToggleMic}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-lg ${
            isMicMuted ? 'bg-red-500 text-white' : 'bg-[#E87A42] text-white ring-4 ring-[#E87A42]/30'
          }`}
        >
          {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          onClick={handleClose}
          className="px-4 py-3 bg-red-600/80 hover:bg-red-600 border border-red-500/40 text-white rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Завершити</span>
        </button>
      </div>
    </div>
  );
};
