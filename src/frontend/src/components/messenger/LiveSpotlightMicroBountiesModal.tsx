import React, { useState } from 'react';
import {
  Target,
  X,
  MousePointer,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface MicroBounty {
  id: string;
  taskTitle: string;
  rewardUAH: number;
  author: string;
  claimedBy?: string;
  status: 'Open' | 'Claimed & Paid';
}

interface LiveSpotlightMicroBountiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const LiveSpotlightMicroBountiesModal: React.FC<LiveSpotlightMicroBountiesModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Інтерактивна взаємодія',
}) => {
  const [activeTab, setActiveTab] = useState<'spotlight' | 'micro_bounties'>('spotlight');
  const [isFollowingLead, setIsFollowingLead] = useState(true);

  const [bounties, setBounties] = useState<MicroBounty[]>([
    { id: 'b1', taskTitle: 'Виправити таймінг відправки пакета LoRa SX1262', rewardUAH: 800, author: 'Кирило', status: 'Open' },
    { id: 'b2', taskTitle: 'Оптимізувати Merkle Tree генерацію гешу', rewardUAH: 1500, author: 'Марина', claimedBy: 'Саня', status: 'Claimed & Paid' },
  ]);

  if (!isOpen) return null;

  const handleClaimBounty = (id: string) => {
    soundFx.playSend();
    setBounties(
      bounties.map((b) =>
        b.id === id ? { ...b, status: 'Claimed & Paid', claimedBy: 'Ви (@Кирило)' } : b
      )
    );
    useUIStore.getState().toast({ kind: 'success', message: 'Мікро-нагороду зараховано на баланс простору після валідації PR' });
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
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Live Spotlight Follow Mode & Quick Micro-Bounties
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Слідування за ведучим та смарт-нагороди за закриття блокерів
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('spotlight')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'spotlight' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Live Spotlight
              </button>
              <button
                onClick={() => setActiveTab('micro_bounties')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'micro_bounties' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Micro-Bounties ({bounties.length})
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
          {/* TAB 1: Live Spotlight / Pointer Following */}
          {activeTab === 'spotlight' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900">Режим «Слідувати за ведучим» (Live Spotlight)</span>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsFollowingLead(!isFollowingLead);
                    }}
                    className={`px-3 py-1 rounded-lg font-bold text-xs shadow-xs transition-all ${
                      isFollowingLead ? 'bg-indigo-700 text-white' : 'bg-gray-300 text-gray-700'
                    }`}
                  >
                    {isFollowingLead ? 'Слідування: Увімкнено ✓' : 'Слідування: Вимкнено'}
                  </button>
                </div>
                <p className="text-[11px]">
                  Ваш екран плавно скролиться вслід за рухами миші доповідача під час огляду коду чи макетів.
                </p>
              </div>

              <div className="p-6 bg-[#21261F] text-white rounded-xl h-48 flex flex-col justify-between items-center relative shadow-2xs">
                <div className="w-full flex justify-between text-xs text-[#8A9186]">
                  <span>Спікер огляду: @Марина (SecOps Lead)</span>
                  <span className="text-emerald-400 font-mono">Фокус: Рядок 84 у VFS Storage</span>
                </div>

                <div className="p-3 bg-indigo-500/20 border border-indigo-400 rounded-full text-indigo-200 font-mono text-xs flex items-center gap-2 animate-pulse">
                  <MousePointer className="w-4 h-4 fill-indigo-400 text-indigo-400" />
                  <span>Курсор ведучої: «Зверніть увагу на перевірку прав POSIX»</span>
                </div>

                <span className="text-[10px] text-[#8A9186]">Синхронізація скролу активна</span>
              </div>
            </div>
          )}

          {/* TAB 2: Quick Micro-Bounties */}
          {activeTab === 'micro_bounties' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs text-amber-950">
                <span className="font-bold text-amber-900">Мікро-винагороди за закриття блокерів</span>
                <p className="text-[11px]">
                  Винагорода автоматично зараховується на баланс першому розробнику, чий PR пройде тести.
                </p>
              </div>

              <div className="space-y-2.5">
                {bounties.map((b) => (
                  <div
                    key={b.id}
                    className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded border border-[#E5DEC9]">
                          {b.rewardUAH} ₴
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{b.taskTitle}</h5>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">
                        Автор: @{b.author} {b.claimedBy ? `· Отримав: ${b.claimedBy}` : ''}
                      </p>
                    </div>

                    {b.status === 'Open' ? (
                      <button
                        onClick={() => handleClaimBounty(b.id)}
                        className="px-3 py-1.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                      >
                        Взяти задачу & PR
                      </button>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Виплачено ✓
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Live Spotlight & Micro-Bounties</span>
          <span className="font-mono">Escrow Bounty Engine</span>
        </div>
      </div>
    </div>
  );
};
