import React from 'react';
import { FileText, ArrowRight } from 'lucide-react';
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
  onUpdate: _onUpdate,
}) => {
  const decisions = data.blocks?.filter((b) => b.type === 'decision') || [];
  const actionItems = data.blocks?.filter((b) => b.type === 'action-item') || [];

  return (
    <div
      onClick={() => {
        soundFx.playTap();
        onOpenSplit?.(data);
      }}
      className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#FAF7F0] hover:bg-[#FDF9F3] border border-[#E5DEC9] hover:border-[#D96C35]/60 transition-all cursor-pointer group shadow-2xs text-[#21261F] max-w-sm select-none mt-1"
    >
      <div className="w-6 h-6 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shrink-0">
        <FileText className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <h5 className="text-xs font-bold text-[#21261F] truncate group-hover:text-[#D96C35] transition-colors">
          {data.title || 'Спільний документ'}
        </h5>
        <p className="text-[10.5px] text-[#6E7568] truncate">
          {actionItems.length > 0 ? `${actionItems.length} завдань` : ''}
          {actionItems.length > 0 && decisions.length > 0 ? ' • ' : ''}
          {decisions.length > 0 ? `${decisions.length} рішень` : ''}
          {actionItems.length === 0 && decisions.length === 0 ? 'Документ рішень' : ''}
        </p>
      </div>
      <span className="text-[11px] font-bold text-[#D96C35] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5 ml-1">
        <span>Відкрити</span>
        <ArrowRight className="w-3 h-3" />
      </span>
    </div>
  );
};
