import React, { useState } from 'react';
import {
  Wifi,
  MapPin,
  X,
  BellOff,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface TriggerRule {
  id: string;
  type: 'wifi' | 'geo';
  identifier: string;
  targetSphere: string;
  enabled: boolean;
}

interface AmbientContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const AmbientContextModal: React.FC<AmbientContextModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'triggers' | 'attention'>('triggers');
  const [cognitiveLoadLevel] = useState<'Low' | 'Focused' | 'Deep Work'>('Focused');
  const [isBatchingEnabled, setIsBatchingEnabled] = useState(true);

  const [triggers, setTriggers] = useState<TriggerRule[]>([
    { id: 'tr1', type: 'wifi', identifier: 'Office_Radxa_5G (BSSID: 04:d9:f5...)', targetSphere: 'Робота (Work OS)', enabled: true },
    { id: 'tr2', type: 'wifi', identifier: 'Home_Podil_Fiber', targetSphere: 'Сімʼя & Дім', enabled: true },
    { id: 'tr3', type: 'geo', identifier: 'Геолокація: Київ, Поділ (Радіус 200м)', targetSphere: 'Особистий простір', enabled: false },
  ]);

  if (!isOpen) return null;

  const toggleTrigger = (id: string) => {
    soundFx.playTap();
    setTriggers(triggers.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
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
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Ambient Computing & Контекстна поведінка
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Wi-Fi / Гео-тригери сфер та Attention Budgeting
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('triggers')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'triggers' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Wi-Fi / Гео Тригери
              </button>
              <button
                onClick={() => setActiveTab('attention')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'attention' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Attention Budgeting
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
          {/* TAB 1: Wi-Fi & Geo Triggers */}
          {activeTab === 'triggers' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <span>Автоматичне перемикання сфери при зміні локації чи мережі</span>
                <span className="font-mono font-bold text-indigo-700">0 дій від користувача</span>
              </div>

              <div className="space-y-2.5">
                {triggers.map((tr) => (
                  <div key={tr.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        {tr.type === 'wifi' ? (
                          <Wifi className="w-4 h-4 text-[#D96C35]" />
                        ) : (
                          <MapPin className="w-4 h-4 text-red-500" />
                        )}
                        <span className="font-bold text-xs text-[#21261F]">{tr.identifier}</span>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">Цільова сфера: <span className="font-semibold text-[#21261F]">{tr.targetSphere}</span></p>
                    </div>

                    <button
                      onClick={() => toggleTrigger(tr.id)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                        tr.enabled ? 'bg-[#D96C35]' : 'bg-[#D5CEBF]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          tr.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Attention Budgeting */}
          {activeTab === 'attention' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <BellOff className="w-4 h-4 text-[#D96C35]" />
                  <span>Захист когнітивного ресурсу (Attention Budgeting)</span>
                </div>
                <p className="leading-relaxed">
                  Система запобігає фрагментації уваги: замість десятків дрібних пушів щогодини, нетермінові повідомлення акумулюються у фоні та видаються єдиним структурованим дайджестом у момент природної перерви.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Режим пакетування сповіщень (Batching)</h5>
                  <p className="text-[11px] text-[#6E7568]">Поточний статус фокусу: {cognitiveLoadLevel}</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsBatchingEnabled(!isBatchingEnabled);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    isBatchingEnabled ? 'bg-emerald-600' : 'bg-[#D5CEBF]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isBatchingEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Ambient Computing Layer</span>
          <span className="font-mono">Context-Aware AI</span>
        </div>
      </div>
    </div>
  );
};
