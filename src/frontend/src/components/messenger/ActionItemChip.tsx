import React, { useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ActionItemChipProps {
  text: string;
  senderName: string;
  onCreateTask?: (taskTitle: string) => void;
  onAddToCanvas?: (decisionText: string) => void;
}

export const ActionItemChip: React.FC<ActionItemChipProps> = ({
  text,
  senderName,
  onCreateTask,
  onAddToCanvas: _onAddToCanvas,
}) => {
  const [created, setCreated] = useState(false);

  // Check if text has action commitment keywords in Ukrainian / English
  const isActionItem =
    /(?:зроблю|дороблю|підготую|задеплою|пофікшу|рев'ю|перевірю|надішлю|до \d\d:\d\d|i will|will do|todo)/i.test(
      text
    );

  if (!isActionItem || text.length < 8) return null;

  const handleCreate = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundFx.playTap();
    setCreated(true);
    onCreateTask?.(`${text} (${senderName})`);
    setTimeout(() => setCreated(false), 3000);
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 animate-in fade-in duration-200">
      <button
        onClick={handleCreate}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
          created
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/25 hover:border-indigo-500/40 shadow-sm'
        }`}
      >
        {created ? (
          <>
            <Check className="w-3 h-3 text-emerald-400" />
            <span>Завдання створено!</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
            <span>AI: Створити завдання в 1 клік</span>
          </>
        )}
      </button>
    </div>
  );
};
