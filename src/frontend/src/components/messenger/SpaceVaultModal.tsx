import React, { useState } from 'react';
import {
  Coins,
  ShieldCheck,
  CheckCircle2,
  Plus,
  X,
  Vote,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface VaultProposal {
  id: string;
  title: string;
  amount: number;
  recipient: string;
  proposer: string;
  votesFor: number;
  votesAgainst: number;
  threshold: number;
  status: 'active' | 'passed' | 'rejected';
  hasVoted?: boolean;
}

interface SpaceVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SpaceVaultModal: React.FC<SpaceVaultModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [balance, setBalance] = useState(4850);
  const [proposals, setProposals] = useState<VaultProposal[]>([
    {
      id: 'p1',
      title: 'Баунті: Реалізація P2P Mesh STUN Fallback',
      amount: 1200,
      recipient: 'Саня',
      proposer: 'Кирило',
      votesFor: 2,
      votesAgainst: 0,
      threshold: 3,
      status: 'active',
    },
    {
      id: 'p2',
      title: 'Виплата: Аудит безпеки смарт-договору Multi-sig',
      amount: 800,
      recipient: 'Security Audit Team',
      proposer: 'Марина',
      votesFor: 3,
      votesAgainst: 0,
      threshold: 3,
      status: 'passed',
    },
  ]);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('500');
  const [newRecipient, setNewRecipient] = useState('');

  if (!isOpen) return null;

  const handleVote = (id: string, approve: boolean) => {
    soundFx.playTap();
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== id || p.hasVoted) return p;
        const newFor = approve ? p.votesFor + 1 : p.votesFor;
        const newAgainst = !approve ? p.votesAgainst + 1 : p.votesAgainst;
        const passed = newFor >= p.threshold;
        if (passed) {
          setBalance((b) => Math.max(0, b - p.amount));
        }
        return {
          ...p,
          votesFor: newFor,
          votesAgainst: newAgainst,
          status: passed ? 'passed' : p.status,
          hasVoted: true,
        };
      })
    );
  };

  const handleCreateProposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newRecipient.trim()) return;
    soundFx.playSend();
    const newP: VaultProposal = {
      id: `p_${Date.now()}`,
      title: newTitle.trim(),
      amount: parseInt(newAmount, 10) || 100,
      recipient: newRecipient.trim(),
      proposer: 'Ви (Кирило)',
      votesFor: 1,
      votesAgainst: 0,
      threshold: 3,
      status: 'active',
      hasVoted: true,
    };
    setProposals([newP, ...proposals]);
    setShowNewModal(false);
    setNewTitle('');
    setNewRecipient('');
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Спільна скарбниця простору (Multi-sig Vault)
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Демократичні виплати та P2P баунті
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Card */}
        <div className="p-5 bg-[#FAF8F5]/50 border-b border-[#E8E1D3] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs text-[#8A9186] font-medium">Баланс скарбниці</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-black text-[#21261F] font-mono">{balance.toLocaleString()}</span>
              <span className="text-xs font-bold text-[#D96C35]">PHANTOM COIN (PHT)</span>
            </div>
            <p className="text-[10px] text-emerald-700 font-semibold mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Multi-signature 2-of-3 Hardware Quorum</span>
            </p>
          </div>

          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Створити голосування</span>
          </button>
        </div>

        {/* Proposals List */}
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-3">
          <h4 className="font-bold text-xs text-[#21261F] flex items-center gap-1.5">
            <Vote className="w-4 h-4 text-[#D96C35]" />
            <span>Активні та завершені голосування</span>
          </h4>

          {proposals.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2.5 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">{p.title}</h5>
                  <p className="text-[11px] text-[#6E7568] mt-0.5">
                    Отримувач: <span className="font-semibold text-[#21261F]">@{p.recipient}</span> · Автор: {p.proposer}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-mono font-bold text-sm text-[#D96C35]">
                    {p.amount} PHT
                  </span>
                  <span className={`block text-[10px] font-bold uppercase ${
                    p.status === 'passed' ? 'text-emerald-600' : 'text-[#C98A2E]'
                  }`}>
                    {p.status === 'passed' ? 'Виплачено ✓' : 'Йде голосування'}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[#6E7568]">
                  <span>Голоси: {p.votesFor} / {p.threshold} необхідних</span>
                  <span>{Math.round((p.votesFor / p.threshold) * 100)}%</span>
                </div>
                <div className="w-full h-1.5 bg-[#EFE9DC] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      p.status === 'passed' ? 'bg-emerald-500' : 'bg-[#D96C35]'
                    }`}
                    style={{ width: `${Math.min(100, (p.votesFor / p.threshold) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              {p.status === 'active' && !p.hasVoted && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleVote(p.id, true)}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Підтримати (+1)</span>
                  </button>
                  <button
                    onClick={() => handleVote(p.id, false)}
                    className="py-1.5 px-3 bg-[#FAF8F5] hover:bg-red-50 text-red-600 border border-[#E5DEC9] rounded-lg text-xs font-semibold transition-colors"
                  >
                    Відхилити
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Modal: New Proposal */}
        {showNewModal && (
          <div className="fixed inset-0 phantom-scrim z-60 flex items-center justify-center p-4">
            <form
              onSubmit={handleCreateProposal}
              className="bg-white border border-[#E5DEC9] p-5 rounded-2xl w-full max-w-md shadow-2xl space-y-3 animate-in zoom-in-95"
            >
              <h4 className="font-bold text-sm text-[#21261F]">Нове голосування на виплату</h4>
              <div>
                <label className="text-[11px] font-semibold text-[#6E7568]">Опис або назва завдання</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="напр. Баунті за рефакторинг WebRTC"
                  className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-[#6E7568]">Сума (PHT)</label>
                  <input
                    type="number"
                    required
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F] font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#6E7568]">Отримувач (Нікнейм)</label>
                  <input
                    type="text"
                    required
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    placeholder="Саня"
                    className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F]"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 py-2 bg-[#FAF8F5] hover:bg-[#EFE9DC] rounded-lg text-xs font-semibold"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold"
                >
                  Опублікувати
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
