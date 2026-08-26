import React from 'react';
import { Layers, CheckCircle2, ListTodo, ExternalLink, Check, Sparkles } from 'lucide-react';
import { CanvasDocument } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';

interface CanvasCardEmbedProps {
  data: CanvasDocument;
  isSelf?: boolean;
  onOpenSplit?: (doc: CanvasDocument) => void;
  onUpdate?: (updated: CanvasDocument) => void;
}

export const CanvasCardEmbed: React.FC<CanvasCardEmbedProps> = ({
  data,
  isSelf: _isSelf,
  onOpenSplit,
  onUpdate,
}) => {
  const decisions = data.blocks?.filter((b) => b.type === 'decision') || [];
  const actionItems = data.blocks?.filter((b) => b.type === 'action-item') || [];

  const toggleCheck = (blockId: string) => {
    soundFx.playTap();
    const updatedBlocks = data.blocks.map((b) =>
      b.id === blockId ? { ...b, checked: !b.checked } : b
    );
    const updatedDoc = {
      ...data,
      blocks: updatedBlocks,
      lastUpdated: 'щойно',
    };
    onUpdate?.(updatedDoc);
  };

  return (
    <div className="w-full max-w-[460px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      {/* Header */}
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-[13px] font-bold text-[#21261F] truncate">{data.title}</h4>
            <p className="text-[10.5px] text-[#6E7568] flex items-center gap-1">
              <span>Спільний документ</span>
              <span>•</span>
              <span>Оновлено: {data.lastUpdated || 'щойно'}</span>
            </p>
          </div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] shrink-0">
          Canvas
        </span>
      </div>

      {/* Body: Highlights & Tasks */}
      <div className="p-3.5 space-y-3">
        {/* Decisions preview */}
        {decisions.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 text-[11px] font-bold text-[#D96C35]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Ключові рішення ({decisions.length}):</span>
            </div>
            {decisions.slice(0, 2).map((d, i) => (
              <div key={i} className="p-2 rounded-lg bg-[#FDF9F3] border border-[#EADCC8] text-[12px] leading-relaxed text-[#21261F]">
                {d.content}
              </div>
            ))}
          </div>
        )}

        {/* Action Items preview (interactive checklist) */}
        {actionItems.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 text-[11px] font-bold text-indigo-700">
              <ListTodo className="w-3.5 h-3.5" />
              <span>Завдання ({actionItems.filter((a) => !a.checked).length} відкритих):</span>
            </div>
            <div className="space-y-1">
              {actionItems.slice(0, 3).map((a) => (
                <div
                  key={a.id}
                  onClick={() => toggleCheck(a.id)}
                  className="flex items-start gap-2 p-1.5 rounded-md hover:bg-[#F0EADD] transition-colors cursor-pointer"
                >
                  <div
                    className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      a.checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-[#CCC4B5] bg-white'
                    }`}
                  >
                    {a.checked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className={`text-[12px] leading-tight ${a.checked ? 'line-through text-[#8A9186]' : 'text-[#21261F]'}`}>
                    {a.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {decisions.length === 0 && actionItems.length === 0 && (
          <p className="text-[11.5px] text-[#6E7568] italic py-1">
            Документ містить {data.blocks?.length || 0} блоків структурованої інформації.
          </p>
        )}
      </div>

      {/* Footer / Open Split Action Button */}
      <div className="p-2.5 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between">
        <span className="text-[11px] text-[#6E7568] flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#D96C35]" />
          Жива синхронізація
        </span>

        <button
          onClick={() => {
            soundFx.playTap();
            onOpenSplit?.(data);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D96C35] hover:bg-[#B85425] text-white text-[11.5px] font-bold shadow-sm transition-all active:scale-[0.98]"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Розгорнути Canvas</span>
        </button>
      </div>
    </div>
  );
};
