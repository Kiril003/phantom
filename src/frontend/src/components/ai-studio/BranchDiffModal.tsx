/**
 * PHANTOM OS — Side-by-Side Branch Diff & Merge Insights Modal
 * Інтерактивне візуальне порівняння двох гілок мислення (Side-by-Side Diff)
 * та об'єднання висновків (Merge Insights) у спільний артефакт.
 */

import React, { useState } from 'react';
import {
  GitCompare,
  GitMerge,
  X,
  Sparkles,
} from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface BranchDiffModalProps {
  onClose: () => void;
}

export const BranchDiffModal: React.FC<BranchDiffModalProps> = ({ onClose }) => {
  const {
    sessions,
    activeSessionId,
    diffBranchIds,
    mergeBranchInsights,
  } = useAISynthesisStore();

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const thoughtNodes = currentSession?.thoughtNodes || [];

  const [leftBranchId, setLeftBranchId] = useState(diffBranchIds?.leftId || thoughtNodes[0]?.id || '');
  const [rightBranchId, setRightBranchId] = useState(
    diffBranchIds?.rightId || thoughtNodes[1]?.id || thoughtNodes[0]?.id || ''
  );

  const leftNode = thoughtNodes.find((n) => n.id === leftBranchId);
  const rightNode = thoughtNodes.find((n) => n.id === rightBranchId);

  const leftMessages = currentSession?.messages.filter((m) => m.branchId === leftBranchId) || [];
  const rightMessages = currentSession?.messages.filter((m) => m.branchId === rightBranchId) || [];

  const handleMerge = () => {
    soundFx.playChime();
    mergeBranchInsights(rightBranchId, leftBranchId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 select-none animate-in fade-in">
      <div className="w-full h-full max-w-6xl max-h-[860px] bg-[#FAF7F0] border border-[#E0D7C6] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#1E2521]">
        {/* Header */}
        <div className="p-4 bg-white border-b border-[#E8E1D3] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-[#1E2521]">Side-by-Side Branch Diff & Merge</h3>
              <p className="text-xs text-[#6E7568]">Порівняння паралельних гіпотез та безшовний синтез висновків</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleMerge}
              className="px-4 py-2 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <GitMerge className="w-4 h-4" />
              <span>Merge Insights</span>
            </button>
            <button
              onClick={() => {
                soundFx.playTap();
                onClose();
              }}
              className="w-8 h-8 rounded-xl bg-[#F2ECE1] hover:bg-[#EAE3D3] flex items-center justify-center text-[#1E2521]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Branch Selectors Bar */}
        <div className="grid grid-cols-2 divide-x divide-[#E0D7C6] bg-[#F5F1E6] border-b border-[#E8E1D3] p-3 text-xs">
          {/* Left Branch Selector */}
          <div className="px-3 flex items-center justify-between">
            <span className="font-bold text-[#1E2521]">Базова гілка (Base Branch):</span>
            <select
              value={leftBranchId}
              onChange={(e) => setLeftBranchId(e.target.value)}
              className="bg-white border border-[#DDD3BF] rounded-xl px-2.5 py-1 text-xs font-bold text-[#1E2521] focus:outline-none"
            >
              {thoughtNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.branchName}
                </option>
              ))}
            </select>
          </div>

          {/* Right Branch Selector */}
          <div className="px-3 flex items-center justify-between">
            <span className="font-bold text-[#C25925]">Гілка для порівняння (Compare Branch):</span>
            <select
              value={rightBranchId}
              onChange={(e) => setRightBranchId(e.target.value)}
              className="bg-white border border-[#DDD3BF] rounded-xl px-2.5 py-1 text-xs font-bold text-[#1E2521] focus:outline-none"
            >
              {thoughtNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.branchName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Side-by-Side Diff Content Body */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E0D7C6] overflow-hidden">
          {/* Left Column */}
          <div className="flex flex-col h-full overflow-y-auto p-4 space-y-3 bg-[#FAF7F0]">
            <div className="p-3 bg-white border border-[#E0D7C6] rounded-2xl">
              <span className="text-[10.5px] font-bold text-[#8A9186] uppercase">Фокус базової гілки</span>
              <h4 className="font-extrabold text-xs text-[#1E2521] mt-0.5">{leftNode?.branchName}</h4>
              <p className="text-xs text-[#6E7568] mt-1">{leftNode?.promptSnippet}</p>
            </div>

            <div className="space-y-2.5">
              {leftMessages.map((m) => (
                <div key={m.id} className="p-3 bg-white border border-[#E0D7C6] rounded-2xl text-xs space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[#8A9186]">
                    <span className="font-bold text-[#1E2521]">{m.role === 'user' ? 'Оператор' : 'AI Core'}</span>
                    <span>{m.timestamp}</span>
                  </div>
                  <p className="text-[#1E2521] whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column */}
          <div className="flex flex-col h-full overflow-y-auto p-4 space-y-3 bg-[#FAF7F0]">
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl">
              <span className="text-[10.5px] font-bold text-amber-800 uppercase">Альтернативна гіпотеза</span>
              <h4 className="font-extrabold text-xs text-amber-950 mt-0.5">{rightNode?.branchName}</h4>
              <p className="text-xs text-amber-900 mt-1">{rightNode?.promptSnippet}</p>
            </div>

            <div className="space-y-2.5">
              {rightMessages.map((m) => (
                <div key={m.id} className="p-3 bg-white border border-amber-200 rounded-2xl text-xs space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between text-[10px] text-[#8A9186]">
                    <span className="font-bold text-[#C25925]">{m.role === 'user' ? 'Оператор' : 'AI Core'}</span>
                    <span>{m.timestamp}</span>
                  </div>
                  <p className="text-[#1E2521] whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-white border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#C25925]" />
            <span>Натисніть «Merge Insights», щоб автоматично створити підсумковий звіт у Canvas.</span>
          </div>
          <span className="font-mono text-[11px] text-[#8A9186]">CRDT 3-Way Merge Ready</span>
        </div>
      </div>
    </div>
  );
};
