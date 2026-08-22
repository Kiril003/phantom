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
    <div className="space-y-3 pt-1 select-text bg-[#FDFCF9] border border-[#F1EDE3] rounded-2xl p-3 sm:p-4 shadow-xl text-[#1E2521]">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E6DFD3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl shrink-0 shadow-sm">
            <ListTodo className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="font-extrabold text-xs sm:text-sm text-[#1E2521] leading-tight truncate">
              {data.title}
            </h4>
            <p className="text-[11px] text-[#5F6A60]">
              Виконано {completedCount} з {totalCount} ({progressPercent}%)
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-2.5 py-1 bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors shrink-0 shadow-sm active:scale-95"
        >
          <Plus className="w-3 h-3 text-[#E87A42]" />
          <span>Задача</span>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-[#F7F5EE] h-2 rounded-full overflow-hidden border border-[#E6DFD3]">
        <div
          className="bg-gradient-to-r from-[#E87A42] to-[#10B981] h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(85,199,120,0.5)]"
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
                ? 'bg-[#F7F5EE]/60 border-[#E6DFD3] text-[#7A8479]'
                : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] border-[#E6DFD3] text-[#E2EFE5] shadow-sm'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                className={`p-0.5 rounded transition-colors ${
                  task.completed ? 'text-[#E87A42]' : 'text-[#7A8479]'
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
                  task.completed ? 'line-through text-[#7A8479]' : ''
                }`}
              >
                {task.title}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {task.dueDate && (
                <span className="text-[10px] text-[#5F6A60] flex items-center gap-0.5 bg-[#F7F5EE] px-2 py-0.5 rounded-md border border-[#E6DFD3] font-mono">
                  <Calendar className="w-2.5 h-2.5" />
                  {task.dueDate}
                </span>
              )}
              {task.assigneeName && (
                <span className="text-[10px] font-semibold text-[#E87A42] bg-[#F9F7F1] px-2 py-0.5 rounded-md border border-[#DDD4C4]">
                  {task.assigneeName}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Inline Add Task Form */}
        {isAdding && (
          <div className="p-2.5 bg-[#FDFCF9] border border-[#E87A42] rounded-xl space-y-2 shadow-md animate-in fade-in zoom-in-95 duration-100">
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
              className="w-full px-2.5 py-1.5 bg-[#F7F5EE] border border-[#E6DFD3] rounded-lg text-xs text-[#1E2521] placeholder-[#7A8479] focus:outline-none focus:border-[#E87A42]"
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
                className="flex-1 px-2.5 py-1.5 bg-[#F7F5EE] border border-[#E6DFD3] rounded-lg text-xs text-[#1E2521] placeholder-[#7A8479] focus:outline-none focus:border-[#E87A42]"
              />
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-2.5 py-1.5 text-xs text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F9F7F1] rounded-lg transition-colors"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleAddTask}
                className="px-3 py-1.5 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] font-bold rounded-lg text-xs flex items-center gap-1 transition-colors"
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
