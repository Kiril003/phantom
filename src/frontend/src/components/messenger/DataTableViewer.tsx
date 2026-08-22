import React, { useState } from 'react';
import { Search, ArrowUpDown, Download, Plus, Check, FileSpreadsheet, Trash2 } from 'lucide-react';
import { TableData } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface DataTableViewerProps {
  data: TableData;
  isSelf?: boolean;
  onUpdateTableData?: (updated: TableData) => void;
}

export const DataTableViewer: React.FC<DataTableViewerProps> = ({ data, onUpdateTableData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [rows, setRows] = useState<Record<string, any>[]>(data?.rows || []);
  const [isCopied, setIsCopied] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});

  const handleSort = (key: string) => {
    soundFx.playTap();
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const handleCellClick = (rowIdx: number, colKey: string, currentVal: any) => {
    setEditingCell({ rowIdx, colKey });
    setEditValue(String(currentVal ?? ''));
  };

  const handleSaveCell = (rowIdx: number, colKey: string) => {
    const updated = [...rows];
    const columnDef = (data?.columns || []).find((c) => c.key === colKey);
    const parsedVal = columnDef?.type === 'number' ? (Number(editValue) || 0) : editValue;
    updated[rowIdx] = { ...updated[rowIdx], [colKey]: parsedVal };
    setRows(updated);
    setEditingCell(null);
    soundFx.playTap();
    onUpdateTableData?.({ ...data, rows: updated });
  };

  const handleAddRow = () => {
    if (Object.keys(newRowData).length === 0) {
      setIsAddingRow(false);
      return;
    }
    const newRow: Record<string, any> = { id: `row_${Date.now()}` };
    (data?.columns || []).forEach((col) => {
      const val = newRowData[col.key] || '';
      newRow[col.key] = col.type === 'number' ? (Number(val) || 0) : val;
    });
    const updated = [...rows, newRow];
    setRows(updated);
    setNewRowData({});
    setIsAddingRow(false);
    soundFx.playTap();
    onUpdateTableData?.({ ...data, rows: updated });
  };

  const handleDeleteRow = (rowIdx: number) => {
    soundFx.playTap();
    const updated = rows.filter((_, idx) => idx !== rowIdx);
    setRows(updated);
    onUpdateTableData?.({ ...data, rows: updated });
  };

  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (!searchTerm) return true;
      return Object.values(row).some((val) =>
        String(val).toLowerCase().includes(searchTerm.toLowerCase())
      );
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      const valA = a.row[sortKey];
      const valB = b.row[sortKey];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });

  const exportCSV = () => {
    soundFx.playTap();
    const columns = data?.columns || [];
    const headers = columns.map((c) => c.label).join(',');
    const rowsCSV = rows
      .map((r) => columns.map((c) => `"${r[c.key] ?? ''}"`).join(','))
      .join('\n');
    const blob = new Blob([`${headers}\n${rowsCSV}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title ? data.title.replace(/\s+/g, '_') : 'aura_table'}.csv`;
    a.click();
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="space-y-2.5 pt-1 select-text bg-[#FDFCF9] border border-[#F1EDE3] rounded-2xl p-3 sm:p-4 shadow-xl text-[#1E2521]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E6DFD3]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl shrink-0 shadow-sm">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="font-extrabold text-xs sm:text-sm text-[#1E2521] leading-tight truncate">
              {data.title}
            </h4>
            {data.description && (
              <p className="text-[11px] text-[#5F6A60] truncate mt-0.5">{data.description}</p>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setIsAddingRow(!isAddingRow)}
            className="px-2.5 py-1 bg-[#F9F7F1] hover:bg-[#202E24] text-[#5F6A60] hover:text-[#1E2521] border border-[#26372B] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors active:scale-95 shadow-sm"
            title="Додати новий рядок"
          >
            <Plus className="w-3 h-3 text-[#E87A42]" />
            <span>Рядок</span>
          </button>

          <button
            onClick={exportCSV}
            className="px-2.5 py-1 bg-[#F9F7F1] hover:bg-[#202E24] text-[#5F6A60] hover:text-[#1E2521] border border-[#26372B] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors active:scale-95 shadow-sm"
            title="Експортувати в CSV"
          >
            {isCopied ? <Check className="w-3 h-3 text-[#E87A42]" /> : <Download className="w-3 h-3 text-[#5F6A60]" />}
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#7A8479] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Пошук або фільтр рядків таблиці..."
          className="w-full pl-8 pr-3 py-1.5 bg-[#F7F5EE] border border-[#202E23] rounded-xl text-xs text-[#F0FAF3] placeholder-[#7A8479] focus:outline-none focus:border-[#E87A42] focus:ring-1 focus:ring-[#E87A42]/30 transition-colors shadow-inner"
        />
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl border border-[#E6DFD3] bg-[#F7F5EE] shadow-inner">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#FDFCF9] text-[#5F6A60] font-bold border-b border-[#E6DFD3] uppercase tracking-wider text-[10.5px]">
              {data.columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2 cursor-pointer hover:bg-[#F9F7F1] hover:text-[#1E2521] transition-colors whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    <span>{col.label}</span>
                    <ArrowUpDown className="w-3 h-3 text-[#7A8479]" />
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 w-8 text-center text-[#7A8479]">···</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1B261D]">
            {filteredRows.map(({ row, originalIndex }) => (
              <tr key={row.id || originalIndex} className="hover:bg-[#FDFCF9] group/row transition-colors">
                {data.columns.map((col) => {
                  const val = row[col.key];
                  const isEditing = editingCell?.rowIdx === originalIndex && editingCell?.colKey === col.key;

                  if (isEditing) {
                    return (
                      <td key={col.key} className="px-2 py-1 whitespace-nowrap bg-[#EFF6F0]">
                        <div className="flex items-center gap-1">
                          <input
                            type={col.type === 'number' ? 'number' : 'text'}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveCell(originalIndex, col.key);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="px-2 py-1 border border-[#E87A42] rounded text-xs w-full bg-[#F7F5EE] text-[#1E2521] focus:outline-none"
                          />
                          <button
                            onClick={() => handleSaveCell(originalIndex, col.key)}
                            className="p-1 bg-[#E87A42] text-[#F7F5EE] rounded hover:bg-[#C25925]"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    );
                  }

                  // Render badge type
                  if (col.type === 'badge') {
                    const strVal = String(val).toLowerCase();
                    const isDone = strVal.includes('готов') || strVal.includes('done') || strVal.includes('викон') || strVal.includes('затвердж');
                    const isInProgress = strVal.includes('процес') || strVal.includes('progress') || strVal.includes('робот');

                    return (
                      <td
                        key={col.key}
                        onClick={() => handleCellClick(originalIndex, col.key, val)}
                        className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-[#F9F7F1]"
                        title="Натисніть для зміни"
                      >
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            isDone
                              ? 'bg-[#183021] text-[#E87A42] border-[#2A5439]'
                              : isInProgress
                              ? 'bg-[#2E2413] text-[#FBBF24] border-[#4E3C1E]'
                              : 'bg-[#2B1B36] text-[#C084FC] border-[#48285D]'
                          }`}
                        >
                          {val}
                        </span>
                      </td>
                    );
                  }

                  // Render numeric progress or number
                  if (col.key === 'progress') {
                    return (
                      <td
                        key={col.key}
                        onClick={() => handleCellClick(originalIndex, col.key, val)}
                        className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-[#F9F7F1]"
                        title="Натисніть для редагування"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#1B261D] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#E87A42] to-[#10B981] rounded-full transition-all"
                              style={{ width: `${Math.min(Number(val) || 0, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] font-bold text-[#5F6A60]">{val}%</span>
                        </div>
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col.key}
                      onClick={() => handleCellClick(originalIndex, col.key, val)}
                      className={`px-3 py-2 text-[#1E2521] cursor-pointer hover:bg-[#F9F7F1] ${
                        col.type === 'number' ? 'font-mono text-right font-medium text-[#F4AF25]' : ''
                      }`}
                      title="Натисніть для редагування"
                    >
                      {val ?? ''}
                    </td>
                  );
                })}

                {/* Delete row action */}
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => handleDeleteRow(originalIndex)}
                    className="opacity-0 group-hover/row:opacity-100 text-[#7A8479] hover:text-red-400 transition-opacity p-0.5"
                    title="Видалити рядок"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}

            {/* Inline Add Row Form */}
            {isAddingRow && (
              <tr className="bg-[#FDFCF9] border-t-2 border-[#E87A42]">
                {data.columns.map((col) => (
                  <td key={col.key} className="px-2 py-1.5">
                    <input
                      type={col.type === 'number' ? 'number' : 'text'}
                      placeholder={col.label}
                      value={newRowData[col.key] || ''}
                      onChange={(e) =>
                        setNewRowData({ ...newRowData, [col.key]: e.target.value })
                      }
                      className="w-full px-2 py-1 bg-[#F7F5EE] border border-[#26372B] rounded text-xs text-[#1E2521] placeholder-[#7A8479] focus:outline-none focus:border-[#E87A42]"
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={handleAddRow}
                    className="p-1 bg-[#E87A42] text-[#F7F5EE] rounded hover:bg-[#C25925]"
                    title="Зберегти новий рядок"
                  >
                    <Check className="w-3.5 h-3.5 font-bold" />
                  </button>
                </td>
              </tr>
            )}

            {/* Summary Row if present */}
            {data.summaryRow && (
              <tr className="bg-[#162019] font-bold text-[#1E2521] border-t-2 border-[#26372B]">
                {data.columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 ${
                      col.type === 'number' ? 'font-mono text-right text-[#E87A42]' : ''
                    }`}
                  >
                    {data.summaryRow?.[col.key] ?? ''}
                  </td>
                ))}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
