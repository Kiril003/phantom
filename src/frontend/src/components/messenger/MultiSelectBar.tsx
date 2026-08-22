import React from 'react';
import {
  Sparkles,
  Reply,
  Copy,
  Forward,
  X,
  CheckSquare,
  Calendar
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface MultiSelectBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onSynthesize: () => void;
  onReplyMultiple?: () => void;
  onCreateMultiQuote: () => void;
  onCopyAll: () => void;
  onForward: () => void;
  onCalendarSync?: () => void;
}

export const MultiSelectBar: React.FC<MultiSelectBarProps> = ({
  selectedCount,
  onClearSelection,
  onSynthesize,
  onReplyMultiple,
  onCreateMultiQuote: _onCreateMultiQuote,
  onCopyAll,
  onForward,
  onCalendarSync,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-y-1/2 z-40 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] shadow-2xl rounded-2xl p-2 sm:p-2.5 flex items-center gap-1.5 sm:gap-2 animate-in fade-in slide-in-from-bottom-3 text-xs max-w-[95%] sm:max-w-xl text-[#1E2521]">
      {/* Count pill */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl font-bold shrink-0">
        <CheckSquare className="w-3.5 h-3.5" />
        <span>{selectedCount} обрано</span>
      </div>

      {/* 1. Reply to multiple / Multi-Quote Reply */}
      {onReplyMultiple && (
        <button
          onClick={() => {
            soundFx.playTap();
            onReplyMultiple();
          }}
          className="px-3 py-1.5 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] rounded-xl font-bold flex items-center gap-1.5 transition-colors shrink-0 shadow-md active:scale-95"
          title="Відповісти / цитувати обрані повідомлення"
        >
          <Reply className="w-3.5 h-3.5" />
          <span>Відповісти ({selectedCount})</span>
        </button>
      )}

      {/* 2. AI Synthesize Button */}
      <button
        onClick={() => {
          soundFx.playChime();
          onSynthesize();
        }}
        className="px-3 py-1.5 bg-[#F1EDE3] hover:bg-[#F1EDE3] text-[#E87A42] border border-[#DDD4C4] rounded-xl font-bold flex items-center gap-1.5 transition-colors shrink-0 shadow-sm active:scale-95"
        title="Синтезувати зміст обраних повідомлень через AI"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">AI Синтез ✦</span>
      </button>

      {/* 3. Calendar Sync from Selection */}
      {onCalendarSync && (
        <button
          onClick={() => {
            soundFx.playTap();
            onCalendarSync();
          }}
          className="px-2.5 py-1.5 bg-[#F9F7F1] hover:bg-[#E6DFD3] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3] rounded-xl font-semibold flex items-center gap-1 transition-colors"
          title="Створити подію в календарі з обраних"
        >
          <Calendar className="w-3.5 h-3.5 text-[#E87A42]" />
          <span className="hidden md:inline">Подія</span>
        </button>
      )}

      {/* 4. Copy All */}
      <button
        onClick={() => {
          soundFx.playTap();
          onCopyAll();
        }}
        className="p-2 bg-[#F9F7F1] hover:bg-[#E6DFD3] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3] rounded-xl transition-colors"
        title="Копіювати всі тексти"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>

      {/* 5. Forward */}
      <button
        onClick={() => {
          soundFx.playTap();
          onForward();
        }}
        className="p-2 bg-[#F9F7F1] hover:bg-[#E6DFD3] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3] rounded-xl transition-colors"
        title="Переслати"
      >
        <Forward className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-5 bg-[#F1EDE3] my-auto" />

      {/* Cancel selection */}
      <button
        onClick={() => {
          soundFx.playTap();
          onClearSelection();
        }}
        className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-lg transition-colors"
        title="Скасувати виділення"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

