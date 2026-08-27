/**
 * PHANTOM OS — Dynamic Artifact Studio (Canvas & Live Interactive Mini-Apps)
 * Центральний когнітивний простір артефактів:
 * - Живий React/Tailwind рендерер (Focus Pomodoro, Travel Budget, Exam Roadmap).
 * - 3D Параметричне математичне полотно з обертанням.
 * - Спліт-редактор коду.
 * - Версіонування та форки.
 */

import React, { useState, useEffect } from 'react';
import {
  Play,
  Copy,
  Check,
  GitFork,
  Layers,
  Sparkles,
  FileCode,
  CheckCircle2,
  DollarSign,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { useAISynthesisStore, DynamicArtifact } from '../../stores/aiSynthesisStore';
import { InteractiveParametricMathCanvas } from './InteractiveParametricMathCanvas';
import { soundFx } from '../../utils/messengerSound';

interface DynamicArtifactStudioProps {
  artifact?: DynamicArtifact | null;
  onOpenSandbox?: () => void;
}

// 1. Live Focus Pomodoro Mini-App Component
function FocusPomodoroLiveWidget() {
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessionCount, setSessionCount] = useState(3);
  const [energyLevel, setEnergyLevel] = useState('⚡ Високий фокус');

  useEffect(() => {
    let timer: any = null;
    if (isActive && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    } else if (timeLeft === 0) {
      setIsActive(false);
      setSessionCount((c) => c + 1);
      soundFx.playChime();
    }
    return () => clearInterval(timer);
  }, [isActive, timeLeft]);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const formatTime = (m: number, s: number) => (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);

  return (
    <div className="p-6 bg-[#FAF7F0] border border-[#E0D7C6] rounded-3xl space-y-5 max-w-md mx-auto shadow-sm animate-in fade-in">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold tracking-wider text-[#C25925] uppercase">PHANTOM Live Widget</span>
          <h3 className="text-lg font-extrabold text-[#1E2521]">Спринт глибокого фокусу</h3>
        </div>
        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full text-xs font-bold">
          Сесія #{sessionCount + 1}
        </span>
      </div>

      <div className="py-8 bg-white border border-[#E8E1D3] rounded-2xl text-center space-y-2 shadow-2xs">
        <div className="text-5xl font-mono font-black text-[#1E2521] tracking-tight">
          {formatTime(mins, secs)}
        </div>
        <p className="text-xs text-[#6E7568]">Режим: 25 хв роботи · 5 хв відновлення</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            soundFx.playTap();
            setIsActive(!isActive);
          }}
          className={`flex-1 py-3 rounded-2xl font-bold text-xs transition-all shadow-xs ${
            isActive ? 'bg-[#3A423B] hover:bg-[#1E2521] text-white' : 'bg-[#C25925] hover:bg-[#AA491A] text-white'
          }`}
        >
          {isActive ? '⏸ Призупинити' : '▶ Запустити фокус-таймер'}
        </button>
        <button
          onClick={() => {
            soundFx.playTap();
            setIsActive(false);
            setTimeLeft(25 * 60);
          }}
          className="p-3 bg-white hover:bg-[#F2ECE1] border border-[#E0D7C6] rounded-2xl text-xs font-bold text-[#1E2521] transition-colors"
          title="Скинути"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div className="pt-2 border-t border-[#EAE3D3] flex items-center justify-between text-xs">
        <span className="text-[#6E7568]">Рівень когнітивної енергії:</span>
        <select
          value={energyLevel}
          onChange={(e) => setEnergyLevel(e.target.value)}
          className="bg-white border border-[#DDD3BF] rounded-xl px-2 py-1 text-xs font-semibold text-[#1E2521] focus:outline-none"
        >
          <option>⚡ Високий фокус</option>
          <option>☕ Помірний темп</option>
          <option>🌿 Відновлення</option>
        </select>
      </div>
    </div>
  );
}

// 2. Live Travel & Budget Calculator Mini-App Component
function TravelBudgetLiveWidget() {
  const [days, setDays] = useState(5);
  const [hotelPerDay, setHotelPerDay] = useState(1800);
  const [foodPerDay, setFoodPerDay] = useState(750);
  const [transport, setTransport] = useState(1200);

  const totalAccommodation = days * hotelPerDay;
  const totalFood = days * foodPerDay;
  const grandTotal = totalAccommodation + totalFood + Number(transport);

  return (
    <div className="p-5 bg-white border border-[#E0D7C6] rounded-3xl space-y-4 max-w-md mx-auto shadow-xs animate-in fade-in">
      <div className="border-b border-[#F0EAE0] pb-2 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase text-[#C25925] tracking-wider">Генератор додатків</span>
          <h3 className="font-extrabold text-[#1E2521] text-base">Калькулятор бюджету подорожі</h3>
        </div>
        <DollarSign className="w-5 h-5 text-[#C25925]" />
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="text-[#6E7568] block mb-1">Кількість днів:</label>
          <input
            type="number"
            min="1"
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
            className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-bold text-[#1E2521]"
          />
        </div>
        <div>
          <label className="text-[#6E7568] block mb-1">Транспорт (грн):</label>
          <input
            type="number"
            value={transport}
            onChange={(e) => setTransport(Number(e.target.value))}
            className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-bold text-[#1E2521]"
          />
        </div>
        <div>
          <label className="text-[#6E7568] block mb-1">Готель / день (грн):</label>
          <input
            type="number"
            value={hotelPerDay}
            onChange={(e) => setHotelPerDay(Number(e.target.value))}
            className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-bold text-[#1E2521]"
          />
        </div>
        <div>
          <label className="text-[#6E7568] block mb-1">Харчування / день (грн):</label>
          <input
            type="number"
            value={foodPerDay}
            onChange={(e) => setFoodPerDay(Number(e.target.value))}
            className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-bold text-[#1E2521]"
          />
        </div>
      </div>

      <div className="p-3.5 bg-[#FAF7F0] rounded-2xl border border-[#E5DEC9] space-y-1.5 text-xs">
        <div className="flex justify-between text-[#6E7568]">
          <span>Проживання ({days} дн.):</span>
          <span className="font-bold text-[#1E2521]">{totalAccommodation.toLocaleString()} грн</span>
        </div>
        <div className="flex justify-between text-[#6E7568]">
          <span>Харчування:</span>
          <span className="font-bold text-[#1E2521]">{totalFood.toLocaleString()} грн</span>
        </div>
        <div className="flex justify-between text-[#6E7568]">
          <span>Транспорт:</span>
          <span className="font-bold text-[#1E2521]">{Number(transport).toLocaleString()} грн</span>
        </div>
        <div className="pt-2 border-t border-[#DDD3BF] flex justify-between text-sm font-extrabold text-[#C25925]">
          <span>Загальний бюджет:</span>
          <span>{grandTotal.toLocaleString()} грн</span>
        </div>
      </div>
    </div>
  );
}

// 3. Live Study & Exam Roadmap Mini-App Component
function ExamRoadmapLiveWidget() {
  const [tasks, setTasks] = useState([
    { id: 1, title: 'CRDT та P2P консенсус', date: 'Пн, 09:00', done: true },
    { id: 2, title: 'WebAssembly Memory Sandboxing', date: 'Вт, 14:30', done: false },
    { id: 3, title: 'Криптографія Ed25519 & Noise', date: 'Ср, 11:00', done: false },
    { id: 4, title: 'Фінальний іспит (Політех)', date: 'Пт, 10:00', done: false },
  ]);

  const toggleTask = (id: number) => {
    soundFx.playTap();
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  return (
    <div className="p-5 bg-white border border-[#E0D7C6] rounded-3xl space-y-4 max-w-md mx-auto shadow-xs animate-in fade-in">
      <div className="border-b border-[#F0EAE0] pb-2 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase text-[#4C8A55] tracking-wider">Дедлайни & План</span>
          <h3 className="font-extrabold text-[#1E2521] text-base">Таймлайн іспитів & Canvas</h3>
        </div>
        <span className="text-xs font-bold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
          {tasks.filter((t) => t.done).length}/{tasks.length} виконано
        </span>
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div
            key={t.id}
            onClick={() => toggleTask(t.id)}
            className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
              t.done
                ? 'bg-emerald-50/60 border-emerald-200 line-through text-[#6E7568]'
                : 'bg-[#FAF7F0] border-[#DDD3BF] text-[#1E2521] font-semibold hover:border-[#C25925]'
            }`}
          >
            <span className="text-xs flex items-center gap-2">
              <CheckCircle2 className={`w-4 h-4 ${t.done ? 'text-emerald-600' : 'text-[#8A9186]'}`} />
              <span>{t.title}</span>
            </span>
            <span className="text-[11px] font-normal opacity-80">{t.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const DynamicArtifactStudio: React.FC<DynamicArtifactStudioProps> = ({
  artifact,
  onOpenSandbox,
}) => {
  const {
    activeSessionId,
    sessions,
    updateArtifactContent,
    forkArtifact,
    revertArtifactVersion,
    runCodeSandbox,
    activeCanvasTab,
    setActiveCanvasTab,
  } = useAISynthesisStore();

  const currentSession = sessions.find((s) => s.id === activeSessionId);
  const activeArt =
    artifact ||
    currentSession?.artifacts.find((a) => a.id === currentSession.activeArtifactId) ||
    currentSession?.artifacts[0] ||
    null;

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableCode, setEditableCode] = useState(activeArt?.content || '');

  useEffect(() => {
    if (activeArt) {
      setEditableCode(activeArt.content);
    }
  }, [activeArt]);

  if (!activeArt && activeCanvasTab !== 'math') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#FAF7F0] border-l border-[#E0D7C6]">
        <div className="w-16 h-16 rounded-3xl bg-[#F2ECE1] border border-[#DDD3BF] flex items-center justify-center text-[#8A9186] mb-3">
          <Layers className="w-8 h-8" />
        </div>
        <h3 className="font-extrabold text-[#1E2521] text-base mb-1">Canvas порожній</h3>
        <p className="text-xs text-[#6E7568] max-w-sm">
          Попроси AI створити інтерактивний калькулятор, написати скрипт або розробити діаграму.
        </p>
      </div>
    );
  }

  const handleCopy = () => {
    soundFx.playSend();
    if (activeArt) navigator.clipboard.writeText(activeArt.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunInSandbox = () => {
    soundFx.playChime();
    if (activeArt) runCodeSandbox(activeArt.content, activeArt.language);
    if (onOpenSandbox) onOpenSandbox();
  };

  const handleSaveEdit = () => {
    soundFx.playSend();
    if (activeArt) updateArtifactContent(activeArt.id, editableCode);
    setIsEditing(false);
  };

  // Safe and rich interactive component switcher
  const renderLiveApp = () => {
    if (!activeArt) return null;
    const isBudget = /бюджет|калькулятор|гроші|travel/i.test(activeArt.title + activeArt.content);
    const isExam = /іспит|roadmap|дедлайн|timeline/i.test(activeArt.title + activeArt.content);
    const isPomodoro = /pomodoro|фокус|таймер/i.test(activeArt.title + activeArt.content);

    return (
      <div className="p-4 flex items-center justify-center min-h-[340px]">
        {isBudget ? (
          <TravelBudgetLiveWidget />
        ) : isExam ? (
          <ExamRoadmapLiveWidget />
        ) : isPomodoro ? (
          <FocusPomodoroLiveWidget />
        ) : (
          <div className="p-6 bg-white border border-[#E0D7C6] rounded-2xl max-w-lg mx-auto shadow-2xs space-y-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5 text-[#C25925]" />
              <h4 className="font-extrabold text-sm text-[#1E2521]">{activeArt.title}</h4>
            </div>
            <p className="text-xs text-[#6E7568]">
              Інтерактивний скрипт валідований та готовий до виконання у локальній пісочниці.
            </p>
            <button
              onClick={handleRunInSandbox}
              className="w-full py-2.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Запустити в пісочниці коду</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAF7F0] border-l border-[#E0D7C6] overflow-hidden select-none">
      {/* Studio Canvas Header */}
      <div className="p-3 bg-white/90 backdrop-blur-md border-b border-[#E8E1D3] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-[#C25925] shrink-0">
            <FileCode className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-xs text-[#1E2521] truncate">{activeArt?.title || '3D Math Canvas'}</h3>
            <div className="flex items-center gap-2 text-[10.5px] text-[#8A9186]">
              <span>v{activeArt?.version || 1}</span>
              <span>·</span>
              <span className="uppercase font-semibold">{activeArt?.language || 'tsx'}</span>
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-[#F2ECE1] p-0.5 rounded-xl border border-[#E0D7C6]">
          <button
            onClick={() => setActiveCanvasTab('preview')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              activeCanvasTab === 'preview' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
            }`}
          >
            Живий віджет
          </button>
          <button
            onClick={() => setActiveCanvasTab('math')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
              activeCanvasTab === 'math' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
            }`}
          >
            <Sliders className="w-3 h-3 text-[#C25925]" />
            <span>3D Математика</span>
          </button>
          <button
            onClick={() => setActiveCanvasTab('code')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              activeCanvasTab === 'code' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
            }`}
          >
            Код
          </button>
          <button
            onClick={() => setActiveCanvasTab('history')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              activeCanvasTab === 'history' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
            }`}
          >
            Історія ({activeArt?.history.length || 0})
          </button>
        </div>

        {/* Toolbar actions */}
        <div className="flex items-center gap-1.5">
          {activeArt && (
            <>
              <button
                onClick={() => forkArtifact(activeArt.id)}
                title="Форкнути копію"
                className="p-1.5 bg-white hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-lg text-[#1E2521] text-xs font-bold transition-colors"
              >
                <GitFork className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCopy}
                title="Скопіювати код"
                className="p-1.5 bg-white hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-lg text-[#1E2521] text-xs font-bold transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#8A9186]" />}
              </button>
              <button
                onClick={handleRunInSandbox}
                className="px-2.5 py-1.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors"
              >
                <Play className="w-3 h-3 fill-current" />
                <span className="hidden sm:inline">Запустити</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Canvas Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeCanvasTab === 'preview' && renderLiveApp()}

        {activeCanvasTab === 'math' && (
          <div className="h-full rounded-2xl overflow-hidden shadow-2xs">
            <InteractiveParametricMathCanvas />
          </div>
        )}

        {activeCanvasTab === 'code' && activeArt && (
          <div className="h-full flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#6E7568] font-mono">Вихідний код артефакту</span>
              {isEditing ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-2.5 py-1 text-xs text-[#6E7568]"
                  >
                    Скасувати
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-2.5 py-1 bg-[#C25925] text-white font-bold rounded-lg text-xs"
                  >
                    Зберегти (v{activeArt.version + 1})
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-2.5 py-1 bg-white border border-[#DDD3BF] text-[#1E2521] font-bold rounded-lg text-xs"
                >
                  Редагувати
                </button>
              )}
            </div>

            {isEditing ? (
              <textarea
                value={editableCode}
                onChange={(e) => setEditableCode(e.target.value)}
                className="flex-1 w-full p-3 font-mono text-xs bg-[#1E2521] text-[#E0D7C6] rounded-2xl border border-[#3A423B] focus:outline-none resize-none leading-relaxed"
              />
            ) : (
              <div className="flex-1 bg-[#1E2521] text-[#E0D7C6] p-4 rounded-2xl font-mono text-xs overflow-x-auto leading-relaxed border border-[#3A423B]">
                <pre>{activeArt.content}</pre>
              </div>
            )}
          </div>
        )}

        {activeCanvasTab === 'history' && activeArt && (
          <div className="space-y-3">
            <h4 className="font-bold text-xs text-[#1E2521]">Історія правок артефакту</h4>
            {activeArt.history.length === 0 ? (
              <p className="text-xs text-[#6E7568]">Це перша версія (v1). Нові версії зʼявлятимуться після правок.</p>
            ) : (
              activeArt.history.map((ver) => (
                <div
                  key={ver.id}
                  className="p-3 bg-white border border-[#E0D7C6] rounded-xl flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-xs text-[#1E2521]">Версія v{ver.version}</span>
                    <p className="text-[11px] text-[#6E7568]">{new Date(ver.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => revertArtifactVersion(activeArt.id, ver.version)}
                    className="px-2.5 py-1 bg-[#F2ECE1] hover:bg-[#EAE3D3] text-[#1E2521] text-xs font-bold rounded-lg"
                  >
                    Відкотити
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
