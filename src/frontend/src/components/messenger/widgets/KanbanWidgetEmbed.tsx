import React, { useState } from 'react';
import { KanbanData, KanbanCard } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { Plus, User, ArrowRight, ArrowLeft, Trash2, Columns } from 'lucide-react';

interface KanbanWidgetEmbedProps {
  data: KanbanData;
  isSelf?: boolean;
  onUpdate?: (updated: KanbanData) => void;
}

export const KanbanWidgetEmbed: React.FC<KanbanWidgetEmbedProps> = ({
  data,
  isSelf: _isSelf,
  onUpdate,
}) => {
  const [board, setBoard] = useState<KanbanData>(data);
  const [addingToCol, setAddingToCol] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardPriority, setNewCardPriority] = useState<KanbanCard['priority']>('med');
  const [newCardAssignee, setNewCardAssignee] = useState('Ви');

  const moveCard = (colId: string, cardId: string, direction: 'prev' | 'next') => {
    soundFx.playTap();
    const colIndex = board.columns.findIndex((c) => c.id === colId);
    if (colIndex === -1) return;
    const targetColIndex = direction === 'next' ? colIndex + 1 : colIndex - 1;
    if (targetColIndex < 0 || targetColIndex >= board.columns.length) return;

    const sourceCol = board.columns[colIndex];
    const targetCol = board.columns[targetColIndex];
    const cardToMove = sourceCol.items.find((item) => item.id === cardId);
    if (!cardToMove) return;

    const updatedSourceItems = sourceCol.items.filter((item) => item.id !== cardId);
    const updatedTargetItems = [...targetCol.items, cardToMove];

    const updatedColumns = board.columns.map((col, idx) => {
      if (idx === colIndex) return { ...col, items: updatedSourceItems };
      if (idx === targetColIndex) return { ...col, items: updatedTargetItems };
      return col;
    });

    const updatedBoard = { ...board, columns: updatedColumns };
    setBoard(updatedBoard);
    onUpdate?.(updatedBoard);
  };

  const deleteCard = (colId: string, cardId: string) => {
    soundFx.playTap();
    const updatedColumns = board.columns.map((c) =>
      c.id === colId ? { ...c, items: c.items.filter((i) => i.id !== cardId) } : c
    );
    const updated = { ...board, columns: updatedColumns };
    setBoard(updated);
    onUpdate?.(updated);
  };

  const handleAddCard = (colId: string) => {
    if (!newCardTitle.trim()) {
      setAddingToCol(null);
      return;
    }
    soundFx.playSend();
    const newCard: KanbanCard = {
      id: `card_${Date.now()}`,
      title: newCardTitle.trim(),
      priority: newCardPriority,
      assignee: newCardAssignee.trim() || 'Ви',
    };

    const updatedColumns = board.columns.map((col) =>
      col.id === colId ? { ...col, items: [...col.items, newCard] } : col
    );

    const updatedBoard = { ...board, columns: updatedColumns };
    setBoard(updatedBoard);
    setNewCardTitle('');
    setNewCardAssignee('Ви');
    setAddingToCol(null);
    onUpdate?.(updatedBoard);
  };

  const totalCards = board.columns.reduce((acc, c) => acc + c.items.length, 0);

  return (
    <div className="w-full max-w-[620px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      {/* Header */}
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35]">
            <Columns className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-[#21261F]">{board.title || 'Kanban Спринт'}</h4>
            <p className="text-[10.5px] text-[#6E7568]">
              {board.columns.length} колонки • {totalCards} активних завдань
            </p>
          </div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8]">
          Micro-App
        </span>
      </div>

      {/* Columns Grid */}
      <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 overflow-x-auto">
        {board.columns.map((col, colIdx) => (
          <div
            key={col.id}
            className="flex flex-col bg-[#FDFCF9] rounded-xl border border-[#E5DEC9] p-2.5 space-y-2 min-w-[170px]"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-1 border-b border-[#EAE4D7]">
              <span className="text-xs font-bold text-[#21261F] flex items-center gap-1.5">
                <span>{col.title}</span>
                <span className="px-1.5 py-0.2 bg-[#FAF7F0] border border-[#E5DEC9] rounded-full text-[10px] text-[#6E7568]">
                  {col.items.length}
                </span>
              </span>

              <button
                onClick={() => setAddingToCol(col.id)}
                className="p-1 hover:bg-[#FDF5ED] rounded text-[#D96C35]"
                title="Додати завдання"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Cards List */}
            <div className="space-y-1.5 flex-1 min-h-[50px]">
              {col.items.map((item) => (
                <div
                  key={item.id}
                  className="group relative p-2 rounded-lg bg-[#FAF7F0] border border-[#E5DEC9] hover:border-[#D96C35]/60 hover:bg-[#FDF9F3] transition-all space-y-1.5 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold text-[#21261F] leading-tight flex-1">
                      {item.title}
                    </p>
                    <button
                      onClick={() => deleteCard(col.id, item.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 text-red-500 rounded"
                      title="Видалити"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[#EAE4D7]/60 text-[10px]">
                    <span className="flex items-center gap-1 text-[#6E7568] font-medium">
                      <User className="w-2.5 h-2.5 text-[#D96C35]" />
                      <span>{item.assignee || 'Ви'}</span>
                    </span>

                    <span
                      className={`font-bold px-1.5 py-0.2 rounded border text-[9.5px] ${
                        item.priority === 'urgent'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : item.priority === 'high'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-white text-[#6E7568] border-[#E5DEC9]'
                      }`}
                    >
                      {item.priority === 'urgent'
                        ? '🔥 Терміново'
                        : item.priority === 'high'
                        ? 'Високий'
                        : 'Звичайний'}
                    </span>
                  </div>

                  {/* Move left / right controls */}
                  <div className="flex items-center justify-between pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => moveCard(col.id, item.id, 'prev')}
                      disabled={colIdx === 0}
                      className="p-0.5 hover:bg-white rounded text-[#6E7568] disabled:opacity-20"
                      title="Перемістити ліворуч"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveCard(col.id, item.id, 'next')}
                      disabled={colIdx === board.columns.length - 1}
                      className="p-0.5 hover:bg-white rounded text-[#6E7568] disabled:opacity-20"
                      title="Перемістити праворуч"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}

              {addingToCol === col.id && (
                <div className="p-2 rounded-lg bg-white border border-[#D96C35] space-y-1.5 shadow-xs">
                  <input
                    type="text"
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    placeholder="Назва завдання..."
                    className="w-full text-xs p-1 bg-transparent border-b border-[#E5DEC9] focus:outline-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-between gap-1">
                    <select
                      value={newCardPriority}
                      onChange={(e) => setNewCardPriority(e.target.value as KanbanCard['priority'])}
                      className="text-[10px] bg-[#FAF7F0] border border-[#E5DEC9] rounded p-0.5"
                    >
                      <option value="urgent">🔥 Терміново</option>
                      <option value="high">Високий</option>
                      <option value="med">Звичайний</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setAddingToCol(null)}
                        className="text-[10px] text-[#6E7568]"
                      >
                        Скасувати
                      </button>
                      <button
                        onClick={() => handleAddCard(col.id)}
                        className="px-2 py-0.5 rounded bg-[#D96C35] text-white text-[10px] font-bold"
                      >
                        + Додати
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
