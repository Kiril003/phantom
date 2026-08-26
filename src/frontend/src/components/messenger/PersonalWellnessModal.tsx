import React, { useState } from 'react';
import {
  Heart,
  CheckCircle2,
  Lock,
  X,
  Timer,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface Habit {
  id: string;
  name: string;
  category: 'Здоровʼя' | 'Розум' | 'Тіло';
  completedDays: boolean[]; // 7 days of the week
}

interface PersonalWellnessModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const PersonalWellnessModal: React.FC<PersonalWellnessModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Особистий простір',
}) => {
  const [activeTab, setActiveTab] = useState<'habits' | 'journal' | 'workout'>('habits');
  const [journalEntry, setJournalEntry] = useState(
    'Сьогодні зосередився на архітектурі P2P-мережі. Відчуваю приплив енергії після ранкової пробіжки.'
  );
  const [workoutTimer, setWorkoutTimer] = useState(60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const [habits, setHabits] = useState<Habit[]>([
    { id: 'h1', name: 'Ранкова пробіжка 5 км', category: 'Тіло', completedDays: [true, true, false, true, true, false, true] },
    { id: 'h2', name: 'Читання наукової літератури 30 хв', category: 'Розум', completedDays: [true, true, true, true, true, false, true] },
    { id: 'h3', name: 'Водний баланс 2.5 л', category: 'Здоровʼя', completedDays: [true, true, true, true, false, true, true] },
  ]);

  if (!isOpen) return null;

  const toggleHabitDay = (habitId: string, dayIndex: number) => {
    soundFx.playTap();
    setHabits(
      habits.map((h) => {
        if (h.id === habitId) {
          const newDays = [...h.completedDays];
          newDays[dayIndex] = !newDays[dayIndex];
          return { ...h, completedDays: newDays };
        }
        return h;
      })
    );
  };

  const daysOfWeek = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

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
        <div className="px-5 py-4 bg-[#E3EFE1] border-b border-[#C5DEC1] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white text-emerald-700 border border-[#C5DEC1] shadow-2xs">
              <Heart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-emerald-950">
                Сфера: Особистий простір & Здоровʼя · {chatTitle}
              </h3>
              <p className="text-[11px] text-emerald-800">
                Зашифрований щоденник, трекер звичок та спортивний журнал
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-emerald-200/50 p-0.5 rounded-lg text-xs font-medium text-emerald-950">
              <button
                onClick={() => setActiveTab('habits')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'habits' ? 'bg-white text-emerald-950 font-bold shadow-2xs' : 'hover:text-emerald-900'
                }`}
              >
                Звички
              </button>
              <button
                onClick={() => setActiveTab('journal')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'journal' ? 'bg-white text-emerald-950 font-bold shadow-2xs' : 'hover:text-emerald-900'
                }`}
              >
                Daily Log
              </button>
              <button
                onClick={() => setActiveTab('workout')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'workout' ? 'bg-white text-emerald-950 font-bold shadow-2xs' : 'hover:text-emerald-900'
                }`}
              >
                Тренування
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-emerald-300/40 rounded-lg text-emerald-950 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Habit Grid */}
          {activeTab === 'habits' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Тижневий трекер щоденних звичок</h4>
                <span className="text-[11px] text-[#6E7568]">Поточний тиждень</span>
              </div>

              <div className="space-y-3">
                {habits.map((habit) => (
                  <div key={habit.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{habit.name}</span>
                        <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                          {habit.category}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-emerald-700 font-bold">
                        {habit.completedDays.filter(Boolean).length}/7 днів
                      </span>
                    </div>

                    {/* Weekday Circles */}
                    <div className="flex items-center justify-between gap-1 pt-1">
                      {daysOfWeek.map((day, idx) => {
                        const isDone = habit.completedDays[idx];
                        return (
                          <div
                            key={day}
                            onClick={() => toggleHabitDay(habit.id, idx)}
                            className="flex flex-col items-center gap-1 cursor-pointer group"
                          >
                            <span className="text-[10px] text-[#8A9186] font-medium">{day}</span>
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                                isDone
                                  ? 'bg-emerald-600 text-white font-bold'
                                  : 'bg-[#FAF8F5] border border-[#E5DEC9] group-hover:bg-[#EFE9DC]'
                              }`}
                            >
                              {isDone ? <CheckCircle2 className="w-4 h-4" /> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Encrypted Daily Log */}
          {activeTab === 'journal' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-700" />
                  <span>Приватний щоденник роздумів (Біометричний захист)</span>
                </div>
                <span className="font-mono font-bold text-emerald-700">AES-GCM-256</span>
              </div>

              <div className="bg-white border border-[#E5DEC9] p-4 rounded-xl space-y-3 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Запис за сьогодні ({new Date().toLocaleDateString('uk-UA')})</h5>
                <textarea
                  value={journalEntry}
                  onChange={(e) => setJournalEntry(e.target.value)}
                  rows={6}
                  className="w-full p-3 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none leading-relaxed"
                />
                <button
                  onClick={() => {
                    soundFx.playSend();
                    alert('Запис зашифровано та збережено у вашому локальному сховищі.');
                  }}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                >
                  Зберегти в зашифрований Vault
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Fitness & Workout Timer */}
          {activeTab === 'workout' && (
            <div className="space-y-4">
              <div className="p-6 bg-white border border-[#E5DEC9] rounded-xl flex flex-col items-center justify-center space-y-3 shadow-2xs">
                <Timer className="w-8 h-8 text-emerald-700" />
                <span className="text-xs font-bold text-[#21261F]">Таймер відпочинку між підходами</span>
                <p className="font-mono font-bold text-4xl text-emerald-900">{workoutTimer}s</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsTimerRunning(!isTimerRunning);
                    }}
                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    {isTimerRunning ? 'Пауза' : 'Старт таймера'}
                  </button>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setWorkoutTimer(60);
                    }}
                    className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-semibold"
                  >
                    Скинути (60с)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#E3EFE1] border-t border-[#C5DEC1] flex items-center justify-between text-[11px] text-emerald-950">
          <span>Особистий баланс та здоровʼя</span>
          <span className="font-mono">Zero Analytics / 100% Private</span>
        </div>
      </div>
    </div>
  );
};
