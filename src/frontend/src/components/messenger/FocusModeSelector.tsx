import React, { useState } from 'react';
import { Target, Headphones, Zap, Moon, Check, ShieldCheck, ChevronDown, BellOff } from 'lucide-react';
import { FocusModeType } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface FocusModeSelectorProps {
  currentMode?: FocusModeType;
  onModeChange?: (mode: FocusModeType) => void;
}

export const FocusModeSelector: React.FC<FocusModeSelectorProps> = ({
  currentMode = 'available',
  onModeChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<FocusModeType>(currentMode);
  const [allowVipPings, setAllowVipPings] = useState(true);

  const modes: { id: FocusModeType; label: string; icon: any; color: string; desc: string }[] = [
    {
      id: 'available',
      label: 'На звʼязку',
      icon: Zap,
      color: 'text-emerald-600 bg-emerald-50 border-emerald-300',
      desc: 'Всі сповіщення надходять у звичайному режимі',
    },
    {
      id: 'deep_focus',
      label: 'Глибокий фокус',
      icon: Target,
      color: 'text-[#D96C35] bg-[#FDF5ED] border-[#EADCC8]',
      desc: 'Тільки VIP пінги (@urgent та керівник)',
    },
    {
      id: 'in_huddle',
      label: 'На мітингу',
      icon: Headphones,
      color: 'text-indigo-600 bg-indigo-50 border-indigo-300',
      desc: 'Звук вимкнено, статус видно команді',
    },
    {
      id: 'async_only',
      label: 'Async Only',
      icon: BellOff,
      color: 'text-amber-700 bg-amber-50 border-amber-300',
      desc: 'Пакетна доставка повідомлень раз на годину',
    },
    {
      id: 'dnd',
      label: 'Не турбувати',
      icon: Moon,
      color: 'text-slate-600 bg-slate-100 border-slate-300',
      desc: 'Повна тиша до вимкнення режиму',
    },
  ];

  const handleSelect = (modeId: FocusModeType) => {
    soundFx.playTap();
    setActiveMode(modeId);
    onModeChange?.(modeId);
    setIsOpen(false);
  };

  const current = modes.find((m) => m.id === activeMode) || modes[0];
  const Icon = current.icon;

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-bold transition-all shadow-xs ${current.color}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-72 bg-[#FDFCF9] border border-[#E5DEC9] rounded-2xl shadow-xl z-50 p-2 text-[#21261F] animate-in zoom-in-95 duration-100">
            <div className="px-2.5 py-1.5 border-b border-[#EAE4D7] mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E7568]">
                Режими фокусу та стрес-фільтр
              </span>
            </div>

            <div className="space-y-1">
              {modes.map((m) => {
                const MIcon = m.icon;
                const isSelected = activeMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 ${
                      isSelected
                        ? 'bg-[#FDF5ED] border border-[#EADCC8]'
                        : 'hover:bg-[#FAF7F0] border border-transparent'
                    }`}
                  >
                    <div className="p-1 rounded-lg bg-white border border-[#E5DEC9] mt-0.5 shrink-0">
                      <MIcon className="w-3.5 h-3.5 text-[#D96C35]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#21261F]">{m.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#D96C35]" />}
                      </div>
                      <p className="text-[10.5px] text-[#6E7568] leading-tight mt-0.5">{m.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[#EAE4D7] px-2 py-1 flex items-center justify-between text-[11px] text-[#6E7568]">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#D96C35]" />
                <span>Пропускати VIP (@urgent)</span>
              </span>
              <input
                type="checkbox"
                checked={allowVipPings}
                onChange={(e) => setAllowVipPings(e.target.checked)}
                className="accent-[#D96C35] rounded cursor-pointer"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
