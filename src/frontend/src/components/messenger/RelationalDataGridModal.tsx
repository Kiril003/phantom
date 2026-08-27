import React, { useState } from 'react';
import {
  Database,
  Plus,
  Trash2,
  X,
  Search,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useWorkOsStore, TaskItem } from '../../stores/workOsStore';

interface RelationalDataGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const RelationalDataGridModal: React.FC<RelationalDataGridModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskItem['priority']>('medium');
  const [newAssignee, setNewAssignee] = useState('Kiril');

  const { tasks, addTask, deleteTask, moveTaskStatus } = useWorkOsStore();

  if (!isOpen) return null;

  const filteredTasks = tasks.filter(
    (t) =>
      !search ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.assigneeName && t.assigneeName.toLowerCase().includes(search.toLowerCase())) ||
      t.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    soundFx.playSend();
    addTask({
      title: newTitle.trim(),
      status: 'todo',
      priority: newPriority,
      assigneeName: newAssignee,
      tags: ['workos', newPriority],
    });
    setNewTitle('');
    setIsAdding(false);
  };

  const columns: Array<{ key: TaskItem['status']; title: string }> = [
    { key: 'todo', title: 'To Do (До виконання)' },
    { key: 'in_progress', title: 'In Progress (В роботі)' },
    { key: 'review', title: 'Review (Перевірка)' },
    { key: 'done', title: 'Done (Готово)' },
  ];

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Реляційна Таблиця & Kanban Завдань (Work OS Grid)
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Завдання, статуси, пріоритети та відповідальні
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'table' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Таблиця
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'kanban' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Kanban Дошка
              </button>
            </div>

            <button
              onClick={() => setIsAdding(!isAdding)}
              className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Створити задачу
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2.5 bg-[#FDFCF9] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#8A8577] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Пошук завдань або виконавців..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#F7F5EE] border border-[#E8E1D3] rounded-lg text-xs outline-none focus:border-[#D96C35]"
            />
          </div>
          <span className="text-xs text-[#8A8577]">{tasks.length} завдань у проєкті</span>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 bg-[#FAF8F5]">
          {isAdding && (
            <form onSubmit={handleAddTask} className="mb-4 p-4 bg-white border border-[#D96C35] rounded-xl space-y-3">
              <h4 className="font-bold text-xs text-[#D96C35]">Нове завдання</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Назва завдання..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as any)}
                  className="px-2 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <input
                  type="text"
                  placeholder="Виконавець..."
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-32 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-2.5 py-1 text-xs text-[#6E7568]"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-[#D96C35] text-white font-bold text-xs rounded-lg"
                >
                  Додати
                </button>
              </div>
            </form>
          )}

          {viewMode === 'table' ? (
            <div className="border border-[#E8E1D3] rounded-xl bg-white overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F5EE] border-b border-[#E8E1D3] text-[#6E7568] uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3">Завдання</th>
                    <th className="p-3">Статус</th>
                    <th className="p-3">Пріоритет</th>
                    <th className="p-3">Виконавець</th>
                    <th className="p-3 text-right">Дії</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E1D3]">
                  {filteredTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="p-3 font-medium text-[#21261F]">{t.title}</td>
                      <td className="p-3">
                        <select
                          value={t.status}
                          onChange={(e) => moveTaskStatus(t.id, e.target.value as any)}
                          className="px-2 py-0.5 rounded border border-[#E8E1D3] text-[11px] bg-white"
                        >
                          <option value="todo">To Do</option>
                          <option value="in_progress">In Progress</option>
                          <option value="review">Review</option>
                          <option value="done">Done</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                          t.priority === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="p-3 text-[#6E7568]">{t.assigneeName || '—'}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => {
                            soundFx.playTap();
                            deleteTask(t.id);
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {columns.map((col) => (
                <div key={col.key} className="bg-[#F7F5EE] border border-[#E8E1D3] rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E8E1D3]">
                    <span className="font-bold text-xs text-[#21261F]">{col.title}</span>
                    <span className="px-1.5 py-0.5 bg-white rounded text-[10px] text-[#6E7568]">
                      {filteredTasks.filter((t) => t.status === col.key).length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {filteredTasks
                      .filter((t) => t.status === col.key)
                      .map((task) => (
                        <div key={task.id} className="p-3 bg-white border border-[#E8E1D3] rounded-lg shadow-2xs space-y-2">
                          <h5 className="font-medium text-xs text-[#21261F]">{task.title}</h5>
                          <div className="flex items-center justify-between text-[10px] text-[#8A8577]">
                            <span>{task.assigneeName || '—'}</span>
                            <span className={`px-1.5 py-0.5 rounded font-bold ${
                              task.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                              task.priority === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {task.priority}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
