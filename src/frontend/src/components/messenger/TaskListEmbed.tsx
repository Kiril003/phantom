import React, { useState } from 'react';
import { CheckSquare, Square, ListTodo, Plus, Calendar, Check } from 'lucide-react';
import { TaskListData, TaskItem } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface TaskListEmbedProps {
  data: TaskListData;
  isSelf?: boolean;
  onUpdateTaskList?: (updated: TaskListData) => void;
}

export const TaskListEmbed: React.FC<TaskListEmbedProps> = ({ data, onUpdateTaskList }) => {
  const [tasks, setTasks] = useState<TaskItem[]>(data.tasks || []);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const toggleTask = (taskId: string) => {
    soundFx.playTap();
    const updated = tasks.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    setTasks(updated);
    onUpdateTaskList?.({ ...data, tasks: updated });
  };

  const handleAddTask = () => {
    if (!newTitle.trim()) {
      setIsAdding(false);
      return;
    }
    const newTask: TaskItem = {
      id: `task_${Date.now()}`,
      title: newTitle.trim(),
      completed: false,
      assigneeName: newAssignee.trim() || undefined,
    };
    const updated = [...tasks, newTask];
    setTasks(updated);
    setNewTitle('');
    setNewAssignee('');
    setIsAdding(false);
    soundFx.playTap();
    onUpdateTaskList?.({ ...data, tasks: updated });
  };

  return (
    <div className="space-y-3 pt-1 select-text bg-[#121A15] border border-[#233127] rounded-2xl p-3 sm:p-4 shadow-xl text-[#E4EDE7]">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#1F2B22]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl shrink-0 shadow-sm">
            <ListTodo className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="font-extrabold text-xs sm:text-sm text-white leading-tight truncate">
              {data.title}
            </h4>
            <p className="text-[11px] text-[#8EA093]">
              Виконано {completedCount} з {totalCount} ({progressPercent}%)
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-2.5 py-1 bg-[#18231B] hover:bg-[#202E24] text-[#A4B8AB] hover:text-white border border-[#26372B] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors shrink-0 shadow-sm active:scale-95"
        >
          <Plus className="w-3 h-3 text-[#55C778]" />
          <span>Задача</span>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-[#0E1410] h-2 rounded-full overflow-hidden border border-[#1F2B22]">
        <div
          className="bg-gradient-to-r from-[#55C778] to-[#10B981] h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(85,199,120,0.5)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Task Items */}
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => toggleTask(task.id)}
            className={`p-2.5 rounded-xl flex items-center justify-between gap-2.5 cursor-pointer transition-all border ${
              task.completed
                ? 'bg-[#0E1410]/60 border-[#1B261D] text-[#6B8072]'
                : 'bg-[#141C16] hover:bg-[#18231B] border-[#223126] text-[#E2EFE5] shadow-sm'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                className={`p-0.5 rounded transition-colors ${
                  task.completed ? 'text-[#55C778]' : 'text-[#6B8072]'
                }`}
              >
                {task.completed ? (
                  <CheckSquare className="w-4 h-4 fill-current" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
              <span
                className={`text-xs font-medium truncate ${
                  task.completed ? 'line-through text-[#6B8072]' : ''
                }`}
              >
                {task.title}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {task.dueDate && (
                <span className="text-[10px] text-[#8EA093] flex items-center gap-0.5 bg-[#0E1410] px-2 py-0.5 rounded-md border border-[#1F2B22] font-mono">
                  <Calendar className="w-2.5 h-2.5" />
                  {task.dueDate}
                </span>
              )}
              {task.assigneeName && (
                <span className="text-[10px] font-semibold text-[#55C778] bg-[#1A261D] px-2 py-0.5 rounded-md border border-[#2B3E31]">
                  {task.assigneeName}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Inline Add Task Form */}
        {isAdding && (
          <div className="p-2.5 bg-[#141C16] border border-[#55C778] rounded-xl space-y-2 shadow-md animate-in fade-in zoom-in-95 duration-100">
            <input
              type="text"
              placeholder="Назва нової задачі..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTask();
                if (e.key === 'Escape') setIsAdding(false);
              }}
              className="w-full px-2.5 py-1.5 bg-[#0E1410] border border-[#26372B] rounded-lg text-xs text-white placeholder-[#6B8072] focus:outline-none focus:border-[#55C778]"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Відповідальний (необов'язково)"
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTask();
                  if (e.key === 'Escape') setIsAdding(false);
                }}
                className="flex-1 px-2.5 py-1.5 bg-[#0E1410] border border-[#26372B] rounded-lg text-xs text-white placeholder-[#6B8072] focus:outline-none focus:border-[#55C778]"
              />
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-2.5 py-1.5 text-xs text-[#8EA093] hover:text-white hover:bg-[#1E2B22] rounded-lg transition-colors"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleAddTask}
                className="px-3 py-1.5 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] font-bold rounded-lg text-xs flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Додати</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
