import React, { useState } from 'react';
import {
  Brain,
  Moon,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface HumanCentricBioContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const HumanCentricBioContextModal: React.FC<HumanCentricBioContextModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Особистий простір',
}) => {
  const [activeTab, setActiveTab] = useState<'fatigue' | 'voice_masking'>('fatigue');
  const [isDelaySendEnabled, setIsDelaySendEnabled] = useState(true);
  const [isNeuralNoiseIsolationEnabled, setIsNeuralNoiseIsolationEnabled] = useState(true);
  const [roomPresenceAcoustics, setRoomPresenceAcoustics] = useState(85);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Cognitive Fatigue Protection & Neural Voice Masking
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Захист від вигорання, відкладена нічна відправка та нейроакустика Huddle
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('fatigue')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'fatigue' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Захист від втоми
              </button>
              <button
                onClick={() => setActiveTab('voice_masking')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'voice_masking' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Neural Voice Masking
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Cognitive Fatigue & Burnout Protection */}
          {activeTab === 'fatigue' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <Moon className="w-4 h-4 text-amber-600" />
                  <span>Нічний режим & М'яке перенесення повідомлень на ранок (Delay Send)</span>
                </div>
                <p className="leading-relaxed">
                  Повідомлення, набрані після 22:00, автоматично плануються до відправки на 09:00 ранку для збереження ментального спокою колег та попередження вигорання.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Автоматичний ранковий Delay Send</h5>
                  <p className="text-[11px] text-[#6E7568]">Запланувати відправку на 09:00 замість нічного пінгінгу</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsDelaySendEnabled(!isDelaySendEnabled);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isDelaySendEnabled ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {isDelaySendEnabled ? 'Увімкнено ✓' : 'Вимкнено'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#8A9186]">Тривалість сесії за клавіатурою</span>
                  <p className="font-mono font-bold text-[#21261F]">3 год 40 хв (Рекомендована перерва)</p>
                </div>

                <div className="p-3.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#8A9186]">Рівень когнітивного навантаження</span>
                  <p className="font-mono font-bold text-emerald-700">Оптимальний (Фокус 84%)</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Context-Aware Voice Masking */}
          {activeTab === 'voice_masking' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Нейромережеве шумозаглушення Huddle</h5>
                    <p className="text-[11px] text-[#6E7568]">Повне видалення шуму кав'ярні, вулиці чи клавіатури</p>
                  </div>

                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsNeuralNoiseIsolationEnabled(!isNeuralNoiseIsolationEnabled);
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isNeuralNoiseIsolationEnabled ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'
                    }`}
                  >
                    {isNeuralNoiseIsolationEnabled ? 'Активно ✓' : 'Вимкнено'}
                  </button>
                </div>

                <div className="space-y-2 pt-2 border-t border-[#E8E1D3]">
                  <div className="flex justify-between text-xs">
                    <span>Ефект присутності в одній тихій кімнаті:</span>
                    <span className="font-mono font-bold">{roomPresenceAcoustics}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={roomPresenceAcoustics}
                    onChange={(e) => {
                      soundFx.playTap();
                      setRoomPresenceAcoustics(Number(e.target.value));
                    }}
                    className="w-full accent-[#D96C35]"
                  />
                  <span className="text-[11px] text-[#6E7568] block">
                    Адаптує акустику голосу всіх учасників Huddle дзвінка під єдиний теплий камерний простір.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Human-Centric Bio-Context</span>
          <span className="font-mono">Neural DSP Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
