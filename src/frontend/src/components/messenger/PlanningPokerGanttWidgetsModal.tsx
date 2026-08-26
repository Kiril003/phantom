import React, { useState } from 'react';
import {
  Kanban,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface PokerVote {
  user: string;
  points: number | null;
  revealed: boolean;
}

interface GanttTask {
  id: string;
  name: string;
  startDay: number;
  durationDays: number;
  dependsOn?: string;
}

interface PlanningPokerGanttWidgetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const PlanningPokerGanttWidgetsModal: React.FC<PlanningPokerGanttWidgetsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Командне планування',
}) => {
  const [activeTab, setActiveTab] = useState<'planning_poker' | 'gantt' | 'mini_widgets'>('planning_poker');
  const [myVote, setMyVote] = useState<number | null>(null);
  const [isVotesRevealed, setIsVotesRevealed] = useState(false);
  const [budgetSlider, setBudgetSlider] = useState(25000);

  const [votes, setVotes] = useState<PokerVote[]>([
    { user: 'Кирило', points: myVote, revealed: isVotesRevealed },
    { user: 'Марина', points: 5, revealed: isVotesRevealed },
    { user: 'Саня', points: 8, revealed: isVotesRevealed },
    { user: 'Олексій', points: 5, revealed: isVotesRevealed },
  ]);

  const [tasks] = useState<GanttTask[]>([
    { id: 't1', name: 'Архітектура P2P WireGuard Mesh', startDay: 1, durationDays: 3 },
    { id: 't2', name: 'Wasm VFS POSIX пісочниця', startDay: 4, durationDays: 4, dependsOn: 't1' },
    { id: 't3', name: 'Тестування стійкості до блекауту', startDay: 8, durationDays: 2, dependsOn: 't2' },
  ]);

  if (!isOpen) return null;

  const handleVote = (points: number) => {
    soundFx.playTap();
    setMyVote(points);
    setVotes((prev) =>
      prev.map((v) => (v.user === 'Кирило' ? { ...v, points } : v))
    );
  };

  const handleRevealVotes = () => {
    soundFx.playSend();
    setIsVotesRevealed(true);
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_poker_reveal_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Planning Poker Engine',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: '🃏 **[Результати Planning Poker — Задача #8491]**\n• Оцінки команди: Кирило (5 SP), Марина (5 SP), Саня (8 SP), Олексій (5 SP)\n• **Фінальна оцінка: 5.75 Story Points (Округлено: 5 SP)** ✓',
    });
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
              <Kanban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Planning Poker, Gantt Шкала & In-Message Віджети
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Оцінювання складності, інтерактивний таймлайн та форми в чаті
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('planning_poker')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'planning_poker' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Planning Poker
              </button>
              <button
                onClick={() => setActiveTab('gantt')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'gantt' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Шкала Ганта
              </button>
              <button
                onClick={() => setActiveTab('mini_widgets')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'mini_widgets' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                In-Message Віджети
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
          {/* TAB 1: Planning Poker */}
          {activeTab === 'planning_poker' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Таємне оцінювання задачі: Ed25519 Ratchet Protocol</span>
                <p className="text-[11px]">
                  Оберіть свою оцінку. Картки відкриються одночасно після натискання «Відкрити карти».
                </p>
              </div>

              {/* Story Points Cards */}
              <div className="flex gap-2 justify-center">
                {[1, 2, 3, 5, 8, 13].map((pt) => (
                  <button
                    key={pt}
                    onClick={() => handleVote(pt)}
                    className={`w-12 h-16 rounded-xl border font-bold text-base transition-all shadow-2xs flex items-center justify-center ${
                      myVote === pt
                        ? 'bg-[#D96C35] text-white border-[#D96C35] scale-105'
                        : 'bg-white hover:bg-[#FAF8F5] border-[#E5DEC9] text-[#21261F]'
                    }`}
                  >
                    {pt}
                  </button>
                ))}
              </div>

              {/* Team Votes Result */}
              <div className="grid grid-cols-4 gap-2.5 pt-2">
                {votes.map((v) => (
                  <div key={v.user} className="p-3 bg-white border border-[#E5DEC9] rounded-xl text-center shadow-2xs">
                    <span className="text-[10px] text-[#8A9186] font-bold block">{v.user}</span>
                    <span className="font-mono font-bold text-sm text-[#21261F] mt-1 block">
                      {isVotesRevealed ? `${v.points || myVote || '?'} SP` : (v.points || myVote ? '✓ Проголосував' : '...')}
                    </span>
                  </div>
                ))}
              </div>

              {!isVotesRevealed && (
                <button
                  onClick={handleRevealVotes}
                  className="w-full py-2.5 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                >
                  Відкрити карти для всієї команди →
                </button>
              )}
            </div>
          )}

          {/* TAB 2: Interactive Gantt Chart */}
          {activeTab === 'gantt' && (
            <div className="space-y-4">
              <h4 className="font-bold text-xs text-[#21261F]">Таймлайн спринту та зв'язки задач</h4>
              <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="space-y-1 text-xs">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-bold text-[#21261F]">{task.name}</span>
                      <span className="font-mono text-[#8A9186]">День {task.startDay} - {task.startDay + task.durationDays}</span>
                    </div>

                    <div className="w-full bg-white border border-[#E5DEC9] rounded-full h-3 relative overflow-hidden">
                      <div
                        className="bg-[#D96C35] h-full rounded-full absolute"
                        style={{
                          left: `${(task.startDay / 10) * 100}%`,
                          width: `${(task.durationDays / 10) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Dynamic In-Message Mini-Apps */}
          {activeTab === 'mini_widgets' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Інтерактивний калькулятор бюджету проекту</h5>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Вибір фонду розробки:</span>
                    <span className="font-mono font-bold text-emerald-700">{budgetSlider.toLocaleString('uk-UA')} ₴</span>
                  </div>
                  <input
                    type="range"
                    min="5000"
                    max="100000"
                    step="5000"
                    value={budgetSlider}
                    onChange={(e) => {
                      soundFx.playTap();
                      setBudgetSlider(Number(e.target.value));
                    }}
                    className="w-full accent-[#D96C35]"
                  />
                </div>

                <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center text-xs">
                  <span className="text-[#6E7568]">Орієнтовний час розробки:</span>
                  <span className="font-mono font-bold text-[#21261F]">
                    ~{Math.round(budgetSlider / 12000)} тижнів
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Interactive Agile & Gantt Widgets</span>
          <span className="font-mono">Planning Poker Engine</span>
        </div>
      </div>
    </div>
  );
};
