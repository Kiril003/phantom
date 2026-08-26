import React, { useState } from 'react';
import { Sparkles, Check, Layers } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface ActionItemChipProps {
  text: string;
  senderName: string;
  chatId?: string;
  onCreateTask?: (taskTitle: string) => void;
  onAddToCanvas?: (decisionText: string) => void;
}

export const ActionItemChip: React.FC<ActionItemChipProps> = ({
  text,
  senderName,
  chatId,
  onCreateTask,
  onAddToCanvas,
}) => {
  const [createdTask, setCreatedTask] = useState(false);
  const [addedCanvas, setAddedCanvas] = useState(false);

  const isActionItem =
    /(?:зроблю|дороблю|підготую|задеплою|пофікшу|пофіксю|рев'ю|перевірю|надішлю|скину|до \d\d:\d\d|до завтра|i will|will do|todo|task)/i.test(
      text
    );

  if (!isActionItem || text.length < 8) return null;

  const handleCreateTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundFx.playSend();
    setCreatedTask(true);
    onCreateTask?.(`${text} (${senderName})`);
    setTimeout(() => setCreatedTask(false), 2500);
  };

  const handleAddToCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundFx.playSend();
    setAddedCanvas(true);
    if (chatId) {
      const store = useMessengerStore.getState();
      store.addCustomMessage({
        id: `msg_k_${Date.now()}`,
        senderId: store.currentUser.id,
        senderName: store.currentUser.name,
        senderAvatar: store.currentUser.avatar,
        timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
        type: 'widget:kanban',
        isSelf: true,
        kanbanData: {
          id: `kb_${Date.now()}`,
          title: `Доручення: ${senderName}`,
          columns: [
            {
              id: 'c1',
              title: 'В роботі',
              items: [{ id: `k_${Date.now()}`, title: text, assignee: senderName, priority: 'high' }],
            },
            { id: 'c2', title: 'Готово', items: [] },
          ],
        },
      });
    }
    onAddToCanvas?.(text);
    setTimeout(() => setAddedCanvas(false), 2500);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 animate-in fade-in duration-200">
      <button
        onClick={handleCreateTask}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all shadow-xs ${
          createdTask
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
            : 'bg-[#FDF5ED] hover:bg-[#FBE8D6] text-[#D96C35] border-[#EADCC8]'
        }`}
      >
        {createdTask ? (
          <>
            <Check className="w-3 h-3 text-emerald-600" />
            <span>Завдання створено!</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3 h-3 text-[#D96C35] animate-pulse" />
            <span>AI: Доручення в 1 клік</span>
          </>
        )}
      </button>

      <button
        onClick={handleAddToCanvas}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all shadow-xs ${
          addedCanvas
            ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
            : 'bg-white hover:bg-[#FAF7F0] text-[#6E7568] border-[#E5DEC9]'
        }`}
      >
        {addedCanvas ? (
          <>
            <Check className="w-3 h-3 text-indigo-600" />
            <span>У Kanban-дошку ✓</span>
          </>
        ) : (
          <>
            <Layers className="w-3 h-3 text-[#6E7568]" />
            <span>+ В Kanban</span>
          </>
        )}
      </button>
    </div>
  );
};
