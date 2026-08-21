import React, { useState } from 'react';
import { X, Clock, Check, ListFilter } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ScheduleMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSchedule?: (scheduledTimeString: string) => void;
  onSchedule?: (scheduledTimeString: string) => void;
  onOpenScheduledList?: () => void;
}

export const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({
  isOpen,
  onClose,
  onConfirmSchedule,
  onSchedule,
  onOpenScheduledList,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('Сьогодні о 18:00');
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customTime, setCustomTime] = useState<string>('18:00');
  const [customDate, setCustomDate] = useState<string>(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const presets = [
    { label: 'Сьогодні о 18:00', value: 'Сьогодні о 18:00' },
    { label: 'Сьогодні о 20:30', value: 'Сьогодні о 20:30' },
    { label: 'Завтра вранці о 09:30', value: 'Завтра о 09:30' },
    { label: 'У понеділок о 10:00', value: 'Понеділок о 10:00' },
  ];

  const handleConfirm = () => {
    soundFx.playTap();
    const finalSchedule = isCustom
      ? `${customDate} о ${customTime}`
      : selectedPreset;
    
    if (onConfirmSchedule) {
      onConfirmSchedule(finalSchedule);
    }
    if (onSchedule) {
      onSchedule(finalSchedule);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FAF8F3] border border-[#DCD3C1] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden select-none animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E8DFD1] flex items-center justify-between bg-[#F5EFE4]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#FCE7D8] text-[#E87A42] flex items-center justify-center shadow-2xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-[#1F2521]">
                Відкладене надсилання
              </h3>
              <p className="text-xs text-[#717E75]">Повідомлення буде доставлено у вказаний час</p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#717E75] hover:text-[#1F2521] hover:bg-[#EBE2D3] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-xs font-bold text-[#556157]">
            <span>Швидкі пресети:</span>
            <button
              type="button"
              onClick={() => setIsCustom(!isCustom)}
              className="text-[#E87A42] hover:underline"
            >
              {isCustom ? '← Обрати пресет' : 'Власний календар/час →'}
            </button>
          </div>

          {!isCustom ? (
            <div className="space-y-2">
              {presets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setSelectedPreset(p.value);
                  }}
                  className={`w-full p-2.5 rounded-xl text-xs font-semibold text-left border flex items-center justify-between transition-all ${
                    selectedPreset === p.value
                      ? 'bg-[#FCE7D8] border-[#E87A42] text-[#8C461A]'
                      : 'bg-white border-[#DFD6C5] text-[#3F4B41] hover:bg-[#FAF6EE]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-[#E87A42]" />
                    <span>{p.label}</span>
                  </span>
                  {selectedPreset === p.value && <Check className="w-4 h-4 text-[#E87A42]" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-3 bg-white border border-[#DFD6C5] rounded-2xl">
              <div>
                <label className="text-[11px] font-bold text-[#556157] block mb-1">Дата:</label>
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="w-full p-2 bg-[#FAF8F3] border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1F2521]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-[#556157] block mb-1">Час:</label>
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="w-full p-2 bg-[#FAF8F3] border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1F2521]"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleConfirm}
            className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 mt-2"
          >
            <Check className="w-4 h-4" />
            <span>Встановити час для цього повідомлення</span>
          </button>

          {/* Link to view all scheduled messages */}
          {onOpenScheduledList && (
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                onClose();
                onOpenScheduledList();
              }}
              className="w-full py-2 px-3 bg-[#F0EAE0] hover:bg-[#E5DCCF] text-[#6B5A4B] rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
            >
              <ListFilter className="w-3.5 h-3.5 text-[#E87A42]" />
              <span>Переглянути всі заплановані повідомлення</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

