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
    <div className="space-y-3 pt-1 select-none text-[#E4EDE7]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#1F2B22]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-lg">
            <Quote className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs sm:text-sm text-white leading-tight">
              {data?.title || 'Комбінована цитата'}
            </h4>
            <span className="text-[10px] text-[#8EA093]">
              {(data?.quotes || []).length} підкріплених повідомлень
            </span>
          </div>
        </div>

        <button
          onClick={copySynthesis}
          className="p-1.5 bg-[#141C16] hover:bg-[#18231B] text-[#8EA093] hover:text-white rounded-lg text-xs transition-colors border border-[#223126]"
          title="Копіювати"
        >
          {isCopied ? <Check className="w-3.5 h-3.5 text-[#55C778]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Synthesis Box */}
      {data?.synthesis && (
        <div className="p-3.5 bg-[#141C16] rounded-2xl border border-[#223126] space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#55C778]">
            <ListChecks className="w-3.5 h-3.5 text-[#55C778]" />
            <span>Ключові тези:</span>
          </div>

          <div className="space-y-1.5 pl-1">
            {(data.synthesis.keyPoints || []).map((point, idx) => (
              <div key={idx} className="flex items-start gap-2 text-[#D1DFD6]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#55C778] mt-1.5 shrink-0" />
                <span className="leading-snug">{point}</span>
              </div>
            ))}
          </div>

          {data.synthesis.conclusion && (
            <div className="pt-2 border-t border-[#1F2B22] text-[11px] text-[#A4B8AB] font-medium leading-relaxed">
              <span className="font-bold text-white">Висновок:</span> {data.synthesis.conclusion}
            </div>
          )}
        </div>
      )}

      {/* Accordion to view original quoted messages */}
      <div className="bg-[#141C16] rounded-xl border border-[#223126] overflow-hidden">
        <button
          onClick={() => {
            soundFx.playTap();
            setShowFullQuotes(!showFullQuotes);
          }}
          className="w-full px-3 py-2 text-left flex items-center justify-between text-xs font-semibold text-[#8EA093] hover:text-white hover:bg-[#18231B] transition-colors"
        >
          <span>Оригінальні цитати ({(data?.quotes || []).length})</span>
          {showFullQuotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showFullQuotes && (
          <div className="p-2 space-y-2 border-t border-[#1F2B22] bg-[#0E1410] max-h-48 overflow-y-auto">
            {(data?.quotes || []).map((q) => (
              <div
                key={q.id}
                className="p-2.5 bg-[#141C16] rounded-xl border border-[#223126] text-xs space-y-1 shadow-sm"
              >
                <div className="flex items-center justify-between text-[10px] text-[#8EA093] font-medium">
                  <span className="font-bold text-white">{q.senderName}</span>
                  <span className="font-mono">{q.timestamp}</span>
                </div>
                <p className="text-[#D1DFD6] italic leading-relaxed">
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
