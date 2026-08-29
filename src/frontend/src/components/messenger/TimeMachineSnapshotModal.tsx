import React, { useState } from 'react';
import {
  History,
  RotateCcw,
  GitCommit,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface SnapshotState {
  id: string;
  timestamp: string;
  author: string;
  commitHash: string;
  summary: string;
  tasksCount: number;
  decisionsCount: number;
}

interface TimeMachineSnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const TimeMachineSnapshotModal: React.FC<TimeMachineSnapshotModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('snap_3');
  const [isRewinding, setIsRewinding] = useState(false);
  const [rewoundSuccess, setRewoundSuccess] = useState(false);

  const snapshots: SnapshotState[] = [
    {
      id: 'snap_3',
      timestamp: 'Сьогодні, 20:45 (Поточний стан)',
      author: 'Кирило (ROOT)',
      commitHash: '0x8f2a41c',
      summary: 'Інтеграція Multi-view Canvas, Command Palette та CRDT Sync v3.4',
      tasksCount: 14,
      decisionsCount: 6,
    },
    {
      id: 'snap_2',
      timestamp: 'Вчора, 18:20',
      author: 'Саня',
      commitHash: '0x3e199df',
      summary: 'Додано P2P DataChannel та оптимізовано ресайзер спліту',
      tasksCount: 11,
      decisionsCount: 4,
    },
    {
      id: 'snap_1',
      timestamp: '24 Серпня, 14:10',
      author: 'Марина',
      commitHash: '0x1a78cc0',
      summary: 'Початкова схема бази знань та структуризація гілок',
      tasksCount: 8,
      decisionsCount: 2,
    },
  ];

  if (!isOpen) return null;

  const handleRewind = () => {
    soundFx.playSend();
    setIsRewinding(true);
    setTimeout(() => {
      setIsRewinding(false);
      setRewoundSuccess(true);
      setTimeout(() => {
        setRewoundSuccess(false);
        onClose();
      }, 1500);
    }, 800);
  };

  const currentSnap = snapshots.find((s) => s.id === selectedSnapshotId) || snapshots[0];

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                CRDT Time Machine & Snapshots
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Повернення стану простору на будь-яку точку в часі
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

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between text-xs text-indigo-900">
            <span>Всі зміни фіксуються в незмінному дереві операцій CRDT</span>
            <span className="font-mono font-bold">100% Deterministic</span>
          </div>

          {/* Timeline List */}
          <div className="space-y-2.5">
            {snapshots.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  soundFx.playTap();
                  setSelectedSnapshotId(s.id);
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  selectedSnapshotId === s.id
                    ? 'bg-[#FDF5ED] border-[#D96C35] shadow-xs'
                    : 'bg-white border-[#E5DEC9] hover:bg-[#FAF8F5]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <GitCommit className="w-4 h-4 text-[#D96C35]" />
                      <span className="font-bold text-xs text-[#21261F]">{s.timestamp}</span>
                      <span className="font-mono text-[10px] text-[#8A9186] bg-[#FAF8F5] px-1.5 rounded">
                        {s.commitHash}
                      </span>
                    </div>
                    <p className="text-xs text-[#6E7568]">{s.summary}</p>
                    <p className="text-[11px] text-[#8A9186]">Автор операції: {s.author}</p>
                  </div>

                  <div className="text-right text-[11px] font-medium text-[#6E7568] shrink-0">
                    <span>{s.tasksCount} задач · {s.decisionsCount} рішень</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Snapshot Comparison Details */}
          <div className="p-4 bg-[#FAF8F5] rounded-xl border border-[#E8E1D3] space-y-2">
            <h5 className="font-bold text-xs text-[#21261F]">Попередній перегляд обраного стану</h5>
            <p className="text-xs text-[#6E7568]">
              При відмотуванні всі документи Canvas, задачі та дерево обговорення повернуться до стану на{' '}
              <span className="font-bold text-[#21261F]">{currentSnap.timestamp}</span>.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between">
          <span className="text-xs text-[#8A9186]">3 снапшоти за останні 7 днів</span>
          <button
            onClick={handleRewind}
            disabled={isRewinding}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRewinding ? 'animate-spin' : ''}`} />
            <span>{rewoundSuccess ? 'Стан відновлено ✓' : isRewinding ? 'Відновлення...' : 'Відновити цей стан'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
