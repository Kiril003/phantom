import React, { useState } from 'react';
import {
  Brain,
  Eye,
  Sparkles,
  X,
  Compass,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface NeuroErgonomicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const NeuroErgonomicsModal: React.FC<NeuroErgonomicsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'decay' | 'routing'>('decay');
  const [isFocusDecayEnabled, setIsFocusDecayEnabled] = useState(true);
  const [decayMinutes] = useState(10);
  const [sampleIntentText, setSampleIntentText] = useState('Де переглянути останні логи LoRa модему?');
  const [suggestedSphere, setSuggestedSphere] = useState<string | null>('Сфера: Робота → Гілка #hardware-telemetry');

  if (!isOpen) return null;

  const handleTestIntent = (text: string) => {
    setSampleIntentText(text);
    if (text.toLowerCase().includes('диплом') || text.toLowerCase().includes('іспит') || text.toLowerCase().includes('формул')) {
      setSuggestedSphere('Сфера: Навчання & Академія → Канал #дискретна-математика');
    } else if (text.toLowerCase().includes('молоко') || text.toLowerCase().includes('купити') || text.toLowerCase().includes('лікар')) {
      setSuggestedSphere('Сфера: Сімʼя & Дім → Смарт-список #покупки');
    } else {
      setSuggestedSphere('Сфера: Робота → Гілка #hardware-telemetry');
    }
  };

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
                Нейро-ергономіка & Зниження когнітивного шуму
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Focus Decay градієнти та Intent-Based маршрутизація
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('decay')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'decay' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Focus Decay
              </button>
              <button
                onClick={() => setActiveTab('routing')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'routing' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Intent Routing
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
          {/* TAB 1: Focus Decay */}
          {activeTab === 'decay' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  <span>Контекстні градієнти шуму (Visual Focus Decay)</span>
                </div>
                <p className="leading-relaxed">
                  Повідомлення без конкретних дій чи запитань ("ок", "зрозумів", реакції) візуально тьмяніють через {decayMinutes} хвилин, залишаючи в центрі вашої уваги лише живі артефакти та ключові рішення.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Режим Focus Decay</h5>
                  <p className="text-[11px] text-[#6E7568]">Затемнення побутового шуму в стрічці</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsFocusDecayEnabled(!isFocusDecayEnabled);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    isFocusDecayEnabled ? 'bg-emerald-600' : 'bg-[#D5CEBF]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isFocusDecayEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Intent-Based Routing */}
          {activeTab === 'routing' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Compass className="w-4 h-4 text-indigo-600" />
                  <span>Маршрутизація за наміром (Intent-Based Contextual Routing)</span>
                </div>
                <p className="leading-relaxed">
                  Система запобігає дублюванню тем: при наборі тексту вона автоматично підказує, у якій сфері чи гілці це питання вже обговорюється.
                </p>
              </div>

              <div className="bg-white border border-[#E5DEC9] p-4 rounded-xl space-y-3 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Тест розпізнавання наміру</h5>
                <input
                  type="text"
                  value={sampleIntentText}
                  onChange={(e) => handleTestIntent(e.target.value)}
                  className="w-full p-2.5 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none"
                />

                {suggestedSphere && (
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#D96C35]" />
                      <span className="font-semibold text-[#21261F]">{suggestedSphere}</span>
                    </div>
                    <span className="text-[10px] text-emerald-700 font-bold font-mono">0 дублювань</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Neuro-Ergonomics System</span>
          <span className="font-mono">Cognitive Zero-Fatigue</span>
        </div>
      </div>
    </div>
  );
};
