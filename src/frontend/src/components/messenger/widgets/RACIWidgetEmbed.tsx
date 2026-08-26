import React, { useState } from 'react';
import { RACIData, RACIRow } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { ShieldCheck, Plus, Trash2 } from 'lucide-react';

interface RACIWidgetEmbedProps {
  data: RACIData;
  isSelf?: boolean;
  onUpdate?: (updated: RACIData) => void;
}

export const RACIWidgetEmbed: React.FC<RACIWidgetEmbedProps> = ({
  data,
  isSelf: _isSelf,
  onUpdate,
}) => {
  const [matrix, setMatrix] = useState<RACIData>(data);
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [newR, setNewR] = useState('');
  const [newA, setNewA] = useState('');
  const [newC, setNewC] = useState('');
  const [newI, setNewI] = useState('');

  const handleAddRow = () => {
    if (!newTask.trim()) {
      setIsAdding(false);
      return;
    }
    soundFx.playSend();
    const newRow: RACIRow = {
      id: `raci_${Date.now()}`,
      task: newTask.trim(),
      r: newR.trim() || '—',
      a: newA.trim() || '—',
      c: newC.trim() || '—',
      i: newI.trim() || '—',
    };
    const updated = {
      ...matrix,
      rows: [...matrix.rows, newRow],
    };
    setMatrix(updated);
    setNewTask('');
    setNewR('');
    setNewA('');
    setNewC('');
    setNewI('');
    setIsAdding(false);
    onUpdate?.(updated);
  };

  const handleDeleteRow = (rowId: string) => {
    const updated = {
      ...matrix,
      rows: matrix.rows.filter((r) => r.id !== rowId),
    };
    setMatrix(updated);
    onUpdate?.(updated);
  };

  return (
    <div className="w-full max-w-2xl bg-black/40 border border-white/15 rounded-2xl p-4 backdrop-blur-md shadow-lg space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">{matrix.title || 'Матриця RACI'}</h3>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
            Governance
          </span>
        </div>
        <span className="text-xs text-white/40">{matrix.rows.length} завдань</span>
      </div>

      {/* RACI Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-[11px] text-white/40 font-mono">
              <th className="pb-2 font-medium">Завдання</th>
              <th className="pb-2 font-medium text-center text-amber-400 w-16" title="Responsible (Виконавець)">R</th>
              <th className="pb-2 font-medium text-center text-red-400 w-16" title="Accountable (Затверджувач)">A</th>
              <th className="pb-2 font-medium text-center text-blue-400 w-16" title="Consulted (Консультант)">C</th>
              <th className="pb-2 font-medium text-center text-emerald-400 w-16" title="Informed (Поінформований)">I</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {matrix.rows.map((row) => (
              <tr key={row.id} className="group hover:bg-white/[0.02] transition-colors">
                <td className="py-2.5 pr-2 font-medium text-white/90">{row.task}</td>
                <td className="py-2.5 text-center font-mono text-[11px] text-amber-300 bg-amber-500/5">{row.r}</td>
                <td className="py-2.5 text-center font-mono text-[11px] text-red-300 bg-red-500/5">{row.a}</td>
                <td className="py-2.5 text-center font-mono text-[11px] text-blue-300 bg-blue-500/5">{row.c}</td>
                <td className="py-2.5 text-center font-mono text-[11px] text-emerald-300 bg-emerald-500/5">{row.i}</td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => handleDeleteRow(row.id)}
                    className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Row */}
      {isAdding ? (
        <div className="bg-black/60 border border-purple-500/30 rounded-xl p-3 space-y-2 animate-in fade-in">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Назва завдання..."
            className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none"
          />
          <div className="grid grid-cols-4 gap-2">
            <input
              type="text"
              value={newR}
              onChange={(e) => setNewR(e.target.value)}
              placeholder="R (хто робить)"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 text-center"
            />
            <input
              type="text"
              value={newA}
              onChange={(e) => setNewA(e.target.value)}
              placeholder="A (хто приймає)"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 text-center"
            />
            <input
              type="text"
              value={newC}
              onChange={(e) => setNewC(e.target.value)}
              placeholder="C (консультант)"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 text-center"
            />
            <input
              type="text"
              value={newI}
              onChange={(e) => setNewI(e.target.value)}
              placeholder="I (поінформований)"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 text-center"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setIsAdding(false)}
              className="text-xs text-white/50 hover:text-white px-2"
            >
              Скасувати
            </button>
            <button
              onClick={handleAddRow}
              className="text-xs bg-purple-500 hover:bg-purple-400 text-white font-semibold px-3 py-1 rounded"
            >
              Додати
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full py-1.5 border border-dashed border-white/10 hover:border-purple-500/30 rounded-lg text-xs text-white/40 hover:text-purple-300 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Додати рядок матриці</span>
        </button>
      )}
    </div>
  );
};
