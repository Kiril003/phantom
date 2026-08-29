import React, { useState } from 'react';
import { RACIData, RACIRow } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { ShieldCheck, Plus, Trash2, Layers } from 'lucide-react';
import { useMessengerStore } from '../../../stores/messengerStore';

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
  const [newR, setNewR] = useState('Frontend');
  const [newA, setNewA] = useState('Тімлід');
  const [newC, setNewC] = useState('Backend');
  const [newI, setNewI] = useState('Всі');
  const [exported, setExported] = useState(false);

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
    setIsAdding(false);
    onUpdate?.(updated);
  };

  const handleDeleteRow = (rowId: string) => {
    soundFx.playTap();
    const updated = {
      ...matrix,
      rows: matrix.rows.filter((r) => r.id !== rowId),
    };
    setMatrix(updated);
    onUpdate?.(updated);
  };

  const exportToCanvas = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    const mdTable =
      `### 🛡️ Матриця RACI: ${matrix.title}\n\n` +
      `| Завдання / Сфера | R (Виконавець) | A (Відповідальний) | C (Консультант) | I (Інформований) |\n` +
      `|---|---|---|---|---|\n` +
      matrix.rows.map((r) => `| ${r.task} | ${r.r} | ${r.a} | ${r.c} | ${r.i} |`).join('\n');

    store.addCustomMessage({
      id: `msg_raci_canvas_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:canvas',
      isSelf: true,
      canvasData: {
        id: `canvas_raci_${Date.now()}`,
        threadId: 'root',
        conversationId: 'current',
        title: `RACI Матриця: ${matrix.title}`,
        rawMarkdown: mdTable,
        decisionsCount: matrix.rows.length,
        openQuestionsCount: 0,
        updatedBy: store.currentUser.name,
        blocks: matrix.rows.map((r, idx) => ({
          id: `r_blk_${idx}`,
          type: 'decision',
          content: `RACI [${r.task}]: R=${r.r}, A=${r.a}, C=${r.c}, I=${r.i}`,
          updatedAt: 'щойно',
        })),
        lastUpdated: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      },
    });
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div className="w-full max-w-[620px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      {/* Header */}
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-[#21261F]">{matrix.title}</h4>
            <p className="text-[10.5px] text-[#6E7568]">
              {matrix.rows.length} зон відповідальності • R, A, C, I модель
            </p>
          </div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8]">
          RACI Governance
        </span>
      </div>

      {/* Table */}
      <div className="p-3 overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#E5DEC9] text-[11px] font-bold text-[#6E7568]">
              <th className="p-2">Завдання</th>
              <th className="p-2 text-center text-emerald-800">R (Responsible)</th>
              <th className="p-2 text-center text-[#D96C35]">A (Accountable)</th>
              <th className="p-2 text-center text-blue-800">C (Consulted)</th>
              <th className="p-2 text-center text-slate-700">I (Informed)</th>
              <th className="p-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAE4D7]">
            {matrix.rows.map((row) => (
              <tr key={row.id} className="hover:bg-[#FDFCF9] group transition-colors">
                <td className="p-2 font-semibold text-[#21261F]">{row.task}</td>
                <td className="p-2 text-center">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                    {row.r}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <span className="px-2 py-0.5 rounded-md bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] font-bold text-[11px]">
                    {row.a}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-medium text-[11px]">
                    {row.c}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium text-[11px]">
                    {row.i}
                  </span>
                </td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => handleDeleteRow(row.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-red-500 rounded transition-opacity"
                    title="Видалити рядок"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isAdding ? (
          <div className="mt-3 p-3 rounded-xl bg-white border border-[#D96C35] space-y-2 shadow-xs">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Назва завдання чи напрямку..."
              className="w-full text-xs p-2 bg-[#FAF7F0] border border-[#E5DEC9] rounded-lg focus:outline-none focus:border-[#D96C35]"
              autoFocus
            />
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <label className="text-[10px] font-bold text-emerald-800">R (Виконує)</label>
                <input
                  type="text"
                  value={newR}
                  onChange={(e) => setNewR(e.target.value)}
                  className="w-full p-1 border border-[#E5DEC9] rounded"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#D96C35]">A (Відповідає)</label>
                <input
                  type="text"
                  value={newA}
                  onChange={(e) => setNewA(e.target.value)}
                  className="w-full p-1 border border-[#E5DEC9] rounded"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-blue-800">C (Консультує)</label>
                <input
                  type="text"
                  value={newC}
                  onChange={(e) => setNewC(e.target.value)}
                  className="w-full p-1 border border-[#E5DEC9] rounded"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700">I (Інформується)</label>
                <input
                  type="text"
                  value={newI}
                  onChange={(e) => setNewI(e.target.value)}
                  className="w-full p-1 border border-[#E5DEC9] rounded"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setIsAdding(false)} className="text-xs text-[#6E7568]">
                Скасувати
              </button>
              <button
                onClick={handleAddRow}
                className="px-3 py-1 rounded bg-[#D96C35] text-white text-xs font-bold"
              >
                + Додати в матрицю
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full mt-2 py-2 border border-dashed border-[#E5DEC9] hover:border-[#D96C35] rounded-xl text-xs font-semibold text-[#6E7568] hover:text-[#D96C35] transition-colors flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Додати новий рядок RACI</span>
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
        <span>Вимога: рівно 1 особа з роллю Accountable на кожне завдання</span>
        <button
          onClick={exportToCanvas}
          className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] rounded-lg text-[#D96C35] font-bold shadow-2xs transition-all"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{exported ? 'Експортовано в Canvas ✓' : 'Експорт у Canvas'}</span>
        </button>
      </div>
    </div>
  );
};
