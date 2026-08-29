/**
 * PHANTOM OS — Local Tool Execution & Sovereignty Drawer (MCP & Tool Calling)
 * Локальний інструментальний суверенітет:
 * 1. Virtual Project Filesystem (створення файлів, перегляд дерева).
 * 2. In-Memory SQL Query Runner & Data Table Aggregator.
 * 3. System Hardware & P2P Diagnostics.
 */

import React, { useState } from 'react';
import {
  FolderTree,
  Database,
  Radio,
  FileCode,
  Plus,
  Play,
  X,
} from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface LocalToolExecutionDrawerProps {
  onClose: () => void;
}

export const LocalToolExecutionDrawer: React.FC<LocalToolExecutionDrawerProps> = ({ onClose }) => {
  const {
    virtualProjectFiles,
    createVirtualFile,
    activeSqlResult,
    runLocalSqlQuery,
    hardwareTelemetry,
    runHardwareDiagnostics,
  } = useAISynthesisStore();

  const [activeTab, setActiveTab] = useState<'files' | 'sql' | 'hardware'>('files');
  const [newFilePath, setNewFilePath] = useState('/src/models/aiRouter.ts');
  const [newFileContent, setNewFileContent] = useState('// ⚡ AIRouter Tier 1..Tier 4 Dynamic Routing\nexport const routeModel = (ctx: any) => ({ target: "local_webgpu" });');
  const [sqlQuery, setSqlQuery] = useState('SELECT node_id, transport, latency_ms, status FROM p2p_mesh_nodes WHERE latency_ms < 20.0 ORDER BY latency_ms ASC;');
  const [isExecutingSql, setIsExecutingSql] = useState(false);

  const handleCreateFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim()) return;
    createVirtualFile(newFilePath.trim(), newFileContent);
    setNewFilePath('');
    setNewFileContent('');
  };

  const handleExecuteSql = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecutingSql(true);
    soundFx.playSend();
    await runLocalSqlQuery(sqlQuery);
    setIsExecutingSql(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#FAF7F0] border-l border-[#E0D7C6] select-none text-xs">
      {/* Header */}
      <div className="p-4 bg-white border-b border-[#E8E1D3] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-[#C25925]">
            <FolderTree className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-[#1E2521]">Local Tool Sovereignty (MCP)</h3>
            <p className="text-[11px] text-[#6E7568]">Файлова система, SQL аналітика та P2P зондування</p>
          </div>
        </div>
        <button
          onClick={() => {
            soundFx.playTap();
            onClose();
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F2ECE1]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="p-3 bg-[#F5F1E6] border-b border-[#EBE3D3] flex gap-1.5">
        <button
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'files' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568]'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span>Файли ({virtualProjectFiles.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('sql')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'sql' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568]'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>SQL Аналітика</span>
        </button>
        <button
          onClick={() => setActiveTab('hardware')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'hardware' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568]'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>Зонд P2P</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'files' && (
          <div className="space-y-3">
            <span className="font-bold text-[#1E2521]">Віртуальне дерево проекту:</span>
            <div className="space-y-1.5">
              {virtualProjectFiles.map((file) => (
                <div
                  key={file.path}
                  className="p-2.5 bg-white border border-[#E0D7C6] rounded-xl flex items-center justify-between font-mono"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="w-4 h-4 text-[#C25925] shrink-0" />
                    <span className="truncate text-[11.5px] text-[#1E2521]">{file.path}</span>
                  </div>
                  <span className="text-[10px] text-[#8A9186] shrink-0">{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>

            {/* Create file box */}
            <form onSubmit={handleCreateFile} className="p-3 bg-white border border-[#E0D7C6] rounded-2xl space-y-2 mt-4">
              <span className="font-bold text-xs text-[#1E2521] flex items-center gap-1">
                <Plus className="w-3.5 h-3.5 text-[#C25925]" />
                <span>Створити новий файл проекту</span>
              </span>
              <input
                type="text"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="/path/to/file.ts"
                className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-mono text-xs text-[#1E2521]"
              />
              <textarea
                rows={3}
                value={newFileContent}
                onChange={(e) => setNewFileContent(e.target.value)}
                placeholder="Вміст файлу..."
                className="w-full p-2 bg-[#FAF7F0] border border-[#DDD3BF] rounded-xl font-mono text-xs text-[#1E2521] resize-none"
              />
              <button
                type="submit"
                className="w-full py-2 bg-[#C25925] text-white font-bold rounded-xl text-xs shadow-2xs"
              >
                Зберегти файл у віртуальний VFS
              </button>
            </form>
          </div>
        )}

        {activeTab === 'sql' && (
          <div className="space-y-3">
            <span className="font-bold text-[#1E2521]">In-Memory SQLite запит:</span>
            <form onSubmit={handleExecuteSql} className="space-y-2">
              <textarea
                rows={3}
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                className="w-full p-2.5 bg-[#1E2521] text-[#E0D7C6] border border-[#3A423B] rounded-xl font-mono text-xs resize-none"
              />
              <button
                type="submit"
                disabled={isExecutingSql}
                className="w-full py-2 bg-[#C25925] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-2xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isExecutingSql ? 'Виконується SQL...' : 'Виконати SQL-запит'}</span>
              </button>
            </form>

            {activeSqlResult && (
              <div className="p-3 bg-white border border-[#E0D7C6] rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-[#1E2521]">Результат ({activeSqlResult.rowCount} рядків):</span>
                  <span className="text-[#8A9186] font-mono">{activeSqlResult.executionMs} ms</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead>
                      <tr className="border-b border-[#E8E1D3] text-[#8A9186]">
                        {activeSqlResult.columns.map((c) => (
                          <th key={c} className="p-1.5">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F2ECE1]">
                      {activeSqlResult.rows.map((r, i) => (
                        <tr key={i} className="hover:bg-[#FAF7F0]">
                          {activeSqlResult.columns.map((c) => (
                            <td key={c} className="p-1.5 text-[#1E2521]">{String(r[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="space-y-3">
            <span className="font-bold text-[#1E2521]">Діагностика P2P Вузла & Заліза:</span>
            <div className="p-3 bg-white border border-[#E0D7C6] rounded-2xl space-y-2.5">
              <div className="flex justify-between">
                <span className="text-[#6E7568]">P2P RTT Затримка:</span>
                <span className="font-bold text-emerald-600">{hardwareTelemetry.p2pNodeLatencyMs} ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E7568]">Швидкість NVMe накопичувача:</span>
                <span className="font-bold text-[#1E2521]">{hardwareTelemetry.storageReadSpeedMb} MB/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E7568]">Температура GPU:</span>
                <span className="font-bold text-amber-600">{hardwareTelemetry.gpuTempCelsius} °C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E7568]">Навантаження GPU:</span>
                <span className="font-bold text-purple-600">{hardwareTelemetry.gpuLoadPct} %</span>
              </div>
            </div>

            <button
              onClick={() => runHardwareDiagnostics()}
              className="w-full py-2 bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#DDD3BF] text-[#1E2521] font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Radio className="w-3.5 h-3.5 text-[#C25925]" />
              <span>Оновити телеметрію вузла</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
