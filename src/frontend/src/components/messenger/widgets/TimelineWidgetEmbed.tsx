import React, { useState } from 'react';
import { Calendar, Clock, Plus, User } from 'lucide-react';
import { TimelineData, TimelineMilestone } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';

interface TimelineWidgetEmbedProps {
  data: TimelineData;
  isSelf?: boolean;
  onUpdate?: (updated: TimelineData) => void;
}

export const TimelineWidgetEmbed: React.FC<TimelineWidgetEmbedProps> = ({
  data,
  onUpdate,
}) => {
  const [timeline, setTimeline] = useState<TimelineData>(data);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newAssignee, setNewAssignee] = useState('');

  const updateMilestone = (id: string, updates: Partial<TimelineMilestone>) => {
    soundFx.playTap();
    const updatedMilestones = timeline.milestones.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    );
    const updatedTimeline = { ...timeline, milestones: updatedMilestones };
    setTimeline(updatedTimeline);
    onUpdate?.(updatedTimeline);
  };

  const handleAddMilestone = () => {
    if (!newTitle.trim()) {
      setIsAdding(false);
      return;
    }
    soundFx.playSend();
    const newM: TimelineMilestone = {
      id: `ms_${Date.now()}`,
      title: newTitle.trim(),
      status: 'in_progress',
      progress: 0,
      dueDate: newDueDate || 'Без дати',
      assignee: newAssignee.trim() || 'Ви',
    };
    const updated = {
      ...timeline,
      milestones: [...timeline.milestones, newM],
    };
    setTimeline(updated);
    setNewTitle('');
    setNewDueDate('');
    setNewAssignee('');
    setIsAdding(false);
    onUpdate?.(updated);
  };

  const avgProgress = Math.round(
    timeline.milestones.reduce((acc, m) => acc + (m.progress || 0), 0) /
      (timeline.milestones.length || 1)
  );

  return (
    <div className="w-full max-w-[500px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-[13px] font-bold text-[#21261F] truncate">{timeline.title}</h4>
            <p className="text-[10.5px] text-[#6E7568]">
              {timeline.milestones.length} етапів • Загальний поступ: <b>{avgProgress}%</b>
            </p>
          </div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] shrink-0">
          Timeline / Gantt
        </span>
      </div>

      <div className="w-full bg-[#E5DEC9] h-1.5 overflow-hidden">
        <div
          className="h-full bg-[#D96C35] transition-all duration-300 rounded-r"
          style={{ width: `${avgProgress}%` }}
        />
      </div>

      <div className="p-3.5 space-y-3">
        {timeline.milestones.map((m, idx) => (
          <div
            key={m.id}
            className="p-3 rounded-xl bg-[#FDFCF9] border border-[#E5DEC9] space-y-2 hover:border-[#D96C35]/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-[#FAF7F0] border border-[#E5DEC9] text-[11px] font-bold flex items-center justify-center text-[#6E7568] shrink-0">
                  {idx + 1}
                </span>
                <span className="text-[13px] font-bold text-[#21261F] truncate">{m.title}</span>
              </div>

              <button
                onClick={() => {
                  const nextStatus: TimelineMilestone['status'] =
                    m.status === 'pending'
                      ? 'in_progress'
                      : m.status === 'in_progress'
                      ? 'completed'
                      : m.status === 'completed'
                      ? 'blocked'
                      : 'pending';
                  const nextProgress =
                    nextStatus === 'completed' ? 100 : nextStatus === 'pending' ? 0 : m.progress;
                  updateMilestone(m.id, { status: nextStatus, progress: nextProgress });
                }}
                className={`text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-all ${
                  m.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : m.status === 'in_progress'
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : m.status === 'blocked'
                    ? 'bg-red-50 text-red-700 border-red-300'
                    : 'bg-[#FAF7F0] text-[#6E7568] border-[#E5DEC9]'
                }`}
              >
                {m.status === 'completed'
                  ? 'Виконано ✓'
                  : m.status === 'in_progress'
                  ? 'У процесі'
                  : m.status === 'blocked'
                  ? 'Заблоковано ✖'
                  : 'Очікує'}
              </button>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10.5px] text-[#6E7568]">
                <span>Прогрес етапу:</span>
                <span className="font-mono font-bold text-[#21261F]">{m.progress}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={m.progress}
                onChange={(e) => {
                  const p = parseInt(e.target.value, 10);
                  updateMilestone(m.id, {
                    progress: p,
                    status: p === 100 ? 'completed' : p > 0 ? 'in_progress' : m.status,
                  });
                }}
                className="w-full accent-[#D96C35] cursor-pointer h-1.5 bg-[#E5DEC9] rounded-lg appearance-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[#F0EADD] text-[11px] text-[#6E7568]">
              <span className="flex items-center gap-1">
                <User className="w-3 h-3 text-[#D96C35]" />
                <b>{m.assignee || 'Не призначено'}</b>
              </span>

              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#6E7568]" />
                <span>{m.dueDate || 'Без дедлайну'}</span>
              </span>
            </div>
          </div>
        ))}

        {isAdding ? (
          <div className="p-3.5 rounded-xl border border-[#D96C35] bg-[#FDF9F3] space-y-2.5">
            <h5 className="text-xs font-bold text-[#21261F] flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-[#D96C35]" />
              Новий етап у Timeline
            </h5>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Назва етапу або майлстоуну..."
              className="w-full p-2 bg-white border border-[#E5DEC9] rounded-lg text-xs text-[#21261F] focus:outline-none focus:border-[#D96C35]"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                placeholder="Виконавець..."
                className="w-1/2 p-2 bg-white border border-[#E5DEC9] rounded-lg text-xs text-[#21261F] focus:outline-none focus:border-[#D96C35]"
              />
              <input
                type="text"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                placeholder="Дедлайн (напр. 30 сер)..."
                className="w-1/2 p-2 bg-white border border-[#E5DEC9] rounded-lg text-xs text-[#21261F] focus:outline-none focus:border-[#D96C35]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setIsAdding(false)}
                className="px-3 py-1 text-xs text-[#6E7568] hover:text-[#21261F]"
              >
                Скасувати
              </button>
              <button
                onClick={handleAddMilestone}
                className="px-3.5 py-1 rounded-lg bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm"
              >
                Додати етап
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full py-2.5 border-2 border-dashed border-[#E5DEC9] hover:border-[#D96C35] rounded-xl text-xs font-semibold text-[#6E7568] hover:text-[#D96C35] hover:bg-[#FDF5ED] transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Додати новий етап у Timeline</span>
          </button>
        )}
      </div>
    </div>
  );
};
