import React, { useState } from 'react';
import { Quote, ListChecks, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { MultiQuoteData } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface MultiQuoteEmbedProps {
  data: MultiQuoteData;
  isSelf?: boolean;
}

export const MultiQuoteEmbed: React.FC<MultiQuoteEmbedProps> = ({ data }) => {
  const [showFullQuotes, setShowFullQuotes] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const copySynthesis = () => {
    soundFx.playTap();
    const textToCopy = `📋 ${data.title || 'Зведена цитата'}:\n${data.synthesis?.keyPoints.map((k) => `• ${k}`).join('\n')}\n\nВисновок: ${data.synthesis?.conclusion || ''}`;
    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="space-y-3 pt-1 select-none text-[#1E2521]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E6DFD3]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-lg">
            <Quote className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs sm:text-sm text-[#1E2521] leading-tight">
              {data?.title || 'Комбінована цитата'}
            </h4>
            <span className="text-[10px] text-[#5F6A60]">
              {(data?.quotes || []).length} підкріплених повідомлень
            </span>
          </div>
        </div>

        <button
          onClick={copySynthesis}
          className="p-1.5 bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] rounded-lg text-xs transition-colors border border-[#E6DFD3]"
          title="Копіювати"
        >
          {isCopied ? <Check className="w-3.5 h-3.5 text-[#E87A42]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Synthesis Box */}
      {data?.synthesis && (
        <div className="p-3.5 bg-[#FDFCF9] rounded-2xl border border-[#E6DFD3] space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#E87A42]">
            <ListChecks className="w-3.5 h-3.5 text-[#E87A42]" />
            <span>Ключові тези:</span>
          </div>

          <div className="space-y-1.5 pl-1">
            {(data.synthesis.keyPoints || []).map((point, idx) => (
              <div key={idx} className="flex items-start gap-2 text-[#1E2521]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E87A42] mt-1.5 shrink-0" />
                <span className="leading-snug">{point}</span>
              </div>
            ))}
          </div>

          {data.synthesis.conclusion && (
            <div className="pt-2 border-t border-[#E6DFD3] text-[11px] text-[#5F6A60] font-medium leading-relaxed">
              <span className="font-bold text-[#1E2521]">Висновок:</span> {data.synthesis.conclusion}
            </div>
          )}
        </div>
      )}

      {/* Accordion to view original quoted messages */}
      <div className="bg-[#FDFCF9] rounded-xl border border-[#E6DFD3] overflow-hidden">
        <button
          onClick={() => {
            soundFx.playTap();
            setShowFullQuotes(!showFullQuotes);
          }}
          className="w-full px-3 py-2 text-left flex items-center justify-between text-xs font-semibold text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F9F7F1] transition-colors"
        >
          <span>Оригінальні цитати ({(data?.quotes || []).length})</span>
          {showFullQuotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showFullQuotes && (
          <div className="p-2 space-y-2 border-t border-[#E6DFD3] bg-[#F7F5EE] max-h-48 overflow-y-auto">
            {(data?.quotes || []).map((q) => (
              <div
                key={q.id}
                className="p-2.5 bg-[#FDFCF9] rounded-xl border border-[#E6DFD3] text-xs space-y-1 shadow-sm"
              >
                <div className="flex items-center justify-between text-[10px] text-[#5F6A60] font-medium">
                  <span className="font-bold text-[#1E2521]">{q.senderName}</span>
                  <span className="font-mono">{q.timestamp}</span>
                </div>
                <p className="text-[#1E2521] italic leading-relaxed">
                  "{q.text}"
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
