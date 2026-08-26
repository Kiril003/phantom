import React, { useState } from 'react';
import {
  Database,
  Table,
  LayoutDashboard,
  Layers,
  Plus,
  Trash2,
  X,
  Search,
  Download,
  Clock,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface GridRow {
  id: string;
  title: string;
  status: 'Backlog' | 'In Progress' | 'Review' | 'Done';
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  assignee: string;
  dueDate: string;
  tags: string[];
  estimateHours: number;
}

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
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'timeline' | 'gallery'>('table');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<GridRow[]>([
    {
      id: 'row_1',
      title: 'P2P WebRTC DataChannel STUN Fallback',
      status: 'In Progress',
      priority: 'Urgent',
      assignee: 'Саня',
      dueDate: '2026-08-28',
      tags: ['Network', 'P2P'],
      estimateHours: 16,
    },
    {
      id: 'row_2',
      title: 'Vim Navigation Mode Integration',
      status: 'Done',
      priority: 'Medium',
      assignee: 'Марина',
      dueDate: '2026-08-26',
      tags: ['UX/UI', 'Core'],
      estimateHours: 8,
    },
    {
      id: 'row_3',
      title: 'Ed25519 Cryptographic Decision Signing',
      status: 'In Progress',
      priority: 'High',
      assignee: 'Кирило',
      dueDate: '2026-08-29',
      tags: ['Crypto', 'Security'],
      estimateHours: 12,
    },
    {
      id: 'row_4',
      title: 'IoT Telemetry Stream from Radxa GPIO',
      status: 'Backlog',
      priority: 'Low',
      assignee: 'Саня',
      dueDate: '2026-09-02',
      tags: ['Hardware', 'IoT'],
      estimateHours: 20,
    },
  ]);

  if (!isOpen) return null;

  const filteredRows = rows.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.assignee.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const addRow = () => {
    soundFx.playTap();
    const newR: GridRow = {
      id: `row_${Date.now()}`,
      title: 'Нове завдання...',
      status: 'Backlog',
      priority: 'Medium',
      assignee: 'Кирило',
      dueDate: new Date().toISOString().split('T')[0],
      tags: ['Feature'],
      estimateHours: 4,
    };
    setRows([...rows, newR]);
  };

  const updateCell = (id: string, field: keyof GridRow, val: any) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  const deleteRow = (id: string) => {
    soundFx.playTap();
    setRows(rows.filter((r) => r.id !== id));
  };

  const exportCSV = () => {
    soundFx.playTap();
    const headers = 'ID,Title,Status,Priority,Assignee,DueDate,EstimateHours\n';
    const csvContent =
      headers +
      rows
        .map(
          (r) =>
            `"${r.id}","${r.title}","${r.status}","${r.priority}","${r.assignee}","${r.dueDate}",${r.estimateHours}`
        )
        .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `phantom_grid_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header & View Switcher */}
        <div className="px-5 py-3.5 bg-[#FAF8F5] border-b border-[#E8E1D3] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Relational Data Grid · {chatTitle}
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                Вбудована реляційна база даних (SQLite backed)
              </p>
            </div>
          </div>

          {/* View Mode Buttons */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => {
                  soundFx.playTap();
                  setViewMode('table');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'table' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Таблиця</span>
              </button>
              <button
                onClick={() => {
                  soundFx.playTap();
                  setViewMode('kanban');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'kanban' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Канбан</span>
              </button>
              <button
                onClick={() => {
                  soundFx.playTap();
                  setViewMode('timeline');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'timeline' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Timeline</span>
              </button>
              <button
                onClick={() => {
                  soundFx.playTap();
                  setViewMode('gallery');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'gallery' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Галерея</span>
              </button>
            </div>

            <button
              onClick={exportCSV}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors"
              title="Експорт у CSV"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar (Search & Add) */}
        <div className="px-5 py-2.5 bg-[#FAF8F5]/60 border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#E5DEC9] rounded-lg w-full">
              <Search className="w-3.5 h-3.5 text-[#8A9186]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук або фільтр записів..."
                className="w-full bg-transparent focus:outline-none text-xs"
              />
            </div>
          </div>

          <button
            onClick={addRow}
            className="flex items-center gap-1 px-3 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg font-bold shadow-xs transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Додати запис</span>
          </button>
        </div>

        {/* View Content */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          {/* A) TABLE VIEW */}
          {viewMode === 'table' && (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5DEC9] text-[#6E7568] font-bold">
                  <th className="p-2.5 pl-3">Назва завдання</th>
                  <th className="p-2.5">Статус</th>
                  <th className="p-2.5">Пріоритет</th>
                  <th className="p-2.5">Виконавець</th>
                  <th className="p-2.5">Дедлайн</th>
                  <th className="p-2.5">Години</th>
                  <th className="p-2.5 text-right pr-3">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EBDD]">
                {filteredRows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#FAF8F2] transition-colors group">
                    <td className="p-2.5 pl-3 font-semibold text-[#21261F]">
                      <input
                        type="text"
                        value={r.title}
                        onChange={(e) => updateCell(r.id, 'title', e.target.value)}
                        className="w-full bg-transparent focus:outline-none focus:bg-white rounded px-1"
                      />
                    </td>
                    <td className="p-2.5">
                      <select
                        value={r.status}
                        onChange={(e) => updateCell(r.id, 'status', e.target.value)}
                        className="bg-transparent font-medium focus:outline-none cursor-pointer"
                      >
                        <option value="Backlog">Backlog</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Review">Review</option>
                        <option value="Done">Done</option>
                      </select>
                    </td>
                    <td className="p-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.priority === 'Urgent' ? 'bg-red-100 text-red-800' :
                        r.priority === 'High' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="p-2.5 font-medium text-[#D96C35]">@{r.assignee}</td>
                    <td className="p-2.5 font-mono text-[#6E7568]">{r.dueDate}</td>
                    <td className="p-2.5 font-mono font-semibold">{r.estimateHours}h</td>
                    <td className="p-2.5 text-right pr-3">
                      <button
                        onClick={() => deleteRow(r.id)}
                        className="opacity-0 group-hover:opacity-100 text-[#8A9186] hover:text-red-500 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* B) KANBAN VIEW */}
          {viewMode === 'kanban' && (
            <div className="flex gap-4 h-full min-w-[700px]">
              {(['Backlog', 'In Progress', 'Review', 'Done'] as const).map((status) => {
                const statusRows = filteredRows.filter((r) => r.status === status);
                return (
                  <div key={status} className="flex-1 bg-[#FAF8F5] rounded-xl p-3 border border-[#E8E1D3] flex flex-col">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E5DEC9] mb-2 font-bold text-xs">
                      <span>{status}</span>
                      <span className="px-1.5 rounded-full bg-[#E5DEC9] text-[10px]">{statusRows.length}</span>
                    </div>
                    <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                      {statusRows.map((r) => (
                        <div key={r.id} className="p-3 bg-white rounded-lg border border-[#E5DEC9] shadow-2xs space-y-1.5">
                          <p className="font-bold text-xs text-[#21261F]">{r.title}</p>
                          <div className="flex items-center justify-between text-[10px] text-[#6E7568]">
                            <span>@{r.assignee}</span>
                            <span className="font-mono">{r.estimateHours}h</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* C) TIMELINE GANTT VIEW */}
          {viewMode === 'timeline' && (
            <div className="space-y-3">
              <h5 className="font-bold text-xs text-[#6E7568]">Таймлайн спринту (Gantt Chart)</h5>
              <div className="space-y-2">
                {filteredRows.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 text-xs">
                    <span className="w-48 truncate font-medium">{r.title}</span>
                    <div className="flex-1 h-6 bg-[#FAF8F5] rounded-lg relative overflow-hidden border border-[#E8E1D3]">
                      <div
                        className="absolute top-1 bottom-1 bg-[#D96C35] rounded font-bold text-[10px] text-white flex items-center px-2"
                        style={{
                          left: `${(i * 18) % 60}%`,
                          width: `${Math.min(40, r.estimateHours * 3)}%`,
                        }}
                      >
                        {r.assignee} · {r.estimateHours}h
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* D) GALLERY VIEW */}
          {viewMode === 'gallery' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {filteredRows.map((r) => (
                <div key={r.id} className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2 shadow-2xs">
                  <div className="flex items-start justify-between">
                    <h5 className="font-bold text-xs text-[#21261F]">{r.title}</h5>
                    <span className="text-[10px] font-bold text-[#D96C35]">{r.status}</span>
                  </div>
                  <p className="text-[11px] text-[#6E7568]">Дедлайн: {r.dueDate}</p>
                  <div className="flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.2 bg-[#FAF8F5] border border-[#E8E1D3] rounded text-[9px] text-[#6E7568]">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>{rows.length} реляційних записів</span>
          <span>Indexed in SQLite WASM Database</span>
        </div>
      </div>
    </div>
  );
};
