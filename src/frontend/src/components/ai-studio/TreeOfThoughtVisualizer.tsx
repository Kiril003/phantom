/**
 * PHANTOM OS — Tree of Thought Visualization (Гілкування думок & Граф рішень)
 * Інтерактивне візуальне дерево гілок мислення. Дозволяє створювати альтернативні
 * гіпотези, розгалужувати діалог у будь-якій точці та перемикатися між варіантами без втрати контексту.
 */

import React, { useState } from 'react';
import { GitBranch, Plus, Check, Sparkles, X, MessageSquare, Layers } from 'lucide-react';
import { useAISynthesisStore, ThoughtNode } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface TreeOfThoughtVisualizerProps {
  onClose?: () => void;
}

export const TreeOfThoughtVisualizer: React.FC<TreeOfThoughtVisualizerProps> = ({ onClose }) => {
  const {
    activeSessionId,
    sessions,
    createThoughtBranch,
    switchBranch,
  } = useAISynthesisStore();

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const thoughtNodes = currentSession?.thoughtNodes || [];
  const currentBranchId = currentSession?.currentBranchId;

  const [newBranchTitle, setNewBranchTitle] = useState('');
  const [newBranchPrompt, setNewBranchPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchTitle.trim()) return;
    createThoughtBranch('root', newBranchTitle.trim(), newBranchPrompt.trim() || undefined);
    setNewBranchTitle('');
    setNewBranchPrompt('');
    setIsCreating(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#FAF7F0] border-l border-[#E0D7C6] select-none">
      {/* Header */}
      <div className="p-4 border-b border-[#E8E1D3] bg-white/80 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
            <GitBranch className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-[#1E2521]">Дерево думок (Tree of Thought)</h3>
            <p className="text-[11px] text-[#6E7568]">{thoughtNodes.length} активних гілок міркувань</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F2ECE1] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quick Action bar */}
      <div className="p-3 bg-[#F5F1E6] border-b border-[#EBE3D3] flex items-center justify-between">
        <span className="text-xs font-bold text-[#3A423B]">Паралельні гіпотези</span>
        <button
          onClick={() => {
            soundFx.playTap();
            setIsCreating(!isCreating);
          }}
          className="px-2.5 py-1 bg-[#C25925] hover:bg-[#AA491A] text-white text-xs font-bold rounded-xl flex items-center gap-1 shadow-2xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Нова гілка</span>
        </button>
      </div>

      {/* Branch creation form */}
      {isCreating && (
        <form onSubmit={handleCreateBranch} className="p-3.5 bg-white border-b border-[#E8E1D3] space-y-2.5 animate-in fade-in">
          <h4 className="text-xs font-bold text-[#1E2521] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#C25925]" />
            <span>Створити відгалуження міркувань</span>
          </h4>
          <input
            type="text"
            value={newBranchTitle}
            onChange={(e) => setNewBranchTitle(e.target.value)}
            placeholder="Назва гілки (напр. 'Тест Python WebAssembly')"
            className="w-full px-3 py-1.5 text-xs bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925]"
            autoFocus
          />
          <textarea
            rows={2}
            value={newBranchPrompt}
            onChange={(e) => setNewBranchPrompt(e.target.value)}
            placeholder="Альтернативний стартовий запит для цієї гілки (опціонально)..."
            className="w-full px-3 py-1.5 text-xs bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1 text-xs text-[#6E7568] hover:text-[#1E2521]"
            >
              Скасувати
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-[#C25925] text-white rounded-lg text-xs font-bold shadow-2xs"
            >
              Відгалузити
            </button>
          </div>
        </form>
      )}

      {/* Nodes Tree List & Visual Map */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {thoughtNodes.map((node: ThoughtNode, idx: number) => {
          const isActive = node.id === currentBranchId;
          const isRoot = idx === 0;

          return (
            <div
              key={node.id}
              onClick={() => switchBranch(node.id)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative group ${
                isActive
                  ? 'bg-white border-[#C25925] shadow-xs ring-1 ring-[#C25925]/30'
                  : 'bg-white/80 hover:bg-white border-[#E0D7C6] hover:border-[#D2C7B0]'
              }`}
            >
              {!isRoot && (
                <div className="absolute -top-3 left-6 w-0.5 h-3 bg-[#DDD3BF]" />
              )}

              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    isActive ? 'bg-[#C25925] text-white' : 'bg-[#F2ECE1] text-[#6E7568]'
                  }`}>
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs text-[#1E2521] truncate flex items-center gap-1.5">
                      <span>{node.branchName}</span>
                      {isRoot && (
                        <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[9.5px] uppercase font-bold">
                          Root
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-[#6E7568] truncate mt-0.5">{node.promptSnippet}</p>
                  </div>
                </div>

                {isActive && (
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  </span>
                )}
              </div>

              <div className="mt-2.5 pt-2 border-t border-[#F2ECE1] flex items-center justify-between text-[10.5px] text-[#8A9186]">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>{node.messagesCount} повідомлень</span>
                  </span>
                  {node.artifactsCount > 0 && (
                    <span className="flex items-center gap-1 text-[#C25925] font-semibold">
                      <Layers className="w-3 h-3" />
                      <span>{node.artifactsCount} артефакт</span>
                    </span>
                  )}
                </div>
                <span>{new Date(node.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
