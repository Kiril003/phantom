import React, { useState } from 'react';
import { KanbanData, KanbanCard } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { Plus, User, ArrowRight, ArrowLeft } from 'lucide-react';

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
      assignee: 'Ви',
    };

    const updatedColumns = board.columns.map((col) => {
      if (col.id === colId) {
        return { ...col, items: [...col.items, newCard] };
      }
      return col;
    });

    const updatedBoard = { ...board, columns: updatedColumns };
    setBoard(updatedBoard);
    setNewCardTitle('');
    setAddingToCol(null);
    onUpdate?.(updatedBoard);
  };

  const priorityColor = (priority?: KanbanCard['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-400 bg-red-500/20 border-red-500/30';
      case 'high':
        return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'med':
        return 'text-amber-400 bg-amber-500/20 border-amber-500/30';
      default:
        return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
    }
  };

  return (
    <div className="w-full max-w-2xl bg-black/40 border border-white/15 rounded-2xl p-4 backdrop-blur-md shadow-lg space-y-3">
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
          <h3 className="text-sm font-bold text-white tracking-tight">{board.title || 'Kanban Спринт'}</h3>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
            Micro-App
          </span>
        </div>
        <span className="text-xs text-white/40">
          {board.columns.reduce((acc, c) => acc + c.items.length, 0)} карток
        </span>
      </div>

      {/* Columns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {board.columns.map((col, colIdx) => (
          <div
            key={col.id}
            className="flex flex-col bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-2.5 min-h-[160px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    colIdx === 0
                      ? 'bg-blue-400'
                      : colIdx === 1
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                />
                {col.title}
              </span>
              <span className="text-[11px] font-mono text-white/40 bg-black/40 px-1.5 py-0.5 rounded">
                {col.items.length}
              </span>
            </div>

            {/* Cards List */}
            <div className="space-y-2 flex-1">
              {col.items.map((card) => (
                <div
                  key={card.id}
                  className="bg-black/60 border border-white/10 hover:border-white/25 rounded-lg p-2.5 space-y-2 transition-all group shadow-sm"
                >
                  <p className="text-xs text-white/90 leading-snug">{card.title}</p>
                  <div className="flex items-center justify-between pt-1 text-[10px]">
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold tracking-wider ${priorityColor(
                        card.priority
                      )}`}
                    >
                      {card.priority || 'med'}
                    </span>

                    {card.assignee && (
                      <span className="flex items-center gap-1 text-white/50">
                        <User className="w-2.5 h-2.5" />
                        <span>{card.assignee}</span>
                      </span>
                    )}

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {colIdx > 0 && (
                        <button
                          onClick={() => moveCard(col.id, card.id, 'prev')}
                          title="Перемістити назад"
                          className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      )}
                      {colIdx < board.columns.length - 1 && (
                        <button
                          onClick={() => moveCard(col.id, card.id, 'next')}
                          title="Перемістити вперед"
                          className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {addingToCol === col.id ? (
                <div className="bg-black/80 border border-amber-500/40 rounded-lg p-2 space-y-2 animate-in fade-in">
                  <input
                    type="text"
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    placeholder="Назва картки..."
                    autoFocus
                    className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCard(col.id)}
                  />
                  <div className="flex items-center justify-between pt-1">
                    <select
                      value={newCardPriority}
                      onChange={(e) => setNewCardPriority(e.target.value as KanbanCard['priority'])}
                      className="bg-white/10 text-[10px] text-white rounded px-1 py-0.5 border border-white/20"
                    >
                      <option value="low" className="bg-[#1A1D24]">Low</option>
                      <option value="med" className="bg-[#1A1D24]">Med</option>
                      <option value="high" className="bg-[#1A1D24]">High</option>
                      <option value="urgent" className="bg-[#1A1D24]">Urgent</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setAddingToCol(null)}
                        className="text-[10px] text-white/40 hover:text-white px-1.5"
                      >
                        ✕
                      </button>
                      <button
                        onClick={() => handleAddCard(col.id)}
                        className="text-[10px] bg-amber-500 text-black font-bold px-2 py-0.5 rounded"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAddingToCol(col.id);
                    setNewCardTitle('');
                  }}
                  className="w-full py-1.5 border border-dashed border-white/10 hover:border-white/25 rounded-lg text-[11px] text-white/40 hover:text-white/80 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Додати</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
