import React, { useState } from 'react';
import {
  Cpu,
  ShieldCheck,
  X,
  Play,
  CheckCircle2,
  HardDrive,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMeshStore } from '../../stores/meshStore';

interface P2PComputeSharingModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const P2PComputeSharingModal: React.FC<P2PComputeSharingModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'compute' | 'backup'>('compute');
  const [isDonatingCompute, setIsDonatingCompute] = useState(true);
  const { nodes, computeTasks, runComputeTask, addComputeTask } = useMeshStore();

  if (!isOpen) return null;

  const handleRunTask = (taskId: string) => {
    soundFx.playSend();
    void runComputeTask(taskId);
  };

  const handleNewBenchmark = () => {
    soundFx.playTap();
    const newTask = addComputeTask({
      name: `WASM Matrix & Tensor Ops (Worker #${computeTasks.length + 1})`,
      type: 'matrix_mult',
      assignedNodeId: 'node_alpha_radxa',
    });
    void runComputeTask(newTask.id);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Суверенний P2P-Комп'ютінг та Розподілений бекап
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · GPU/NPU Resource Pool та Shamir Backup Shards
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('compute')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'compute' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                P2P Комп'ютінг
              </button>
              <button
                onClick={() => setActiveTab('backup')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'backup' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Вузли мережі ({nodes.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'compute' ? (
            <>
              <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-[#21261F]">Статус власного вузла (Radxa Host)</h4>
                  <p className="text-[11px] text-[#6E7568]">
                    Надавати вільні NPU/WASM ресурси для спільних обчислень у mesh-мережі
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNewBenchmark}
                    className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] transition-all flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" /> Запустити бенчмарк
                  </button>
                  <input
                    type="checkbox"
                    checked={isDonatingCompute}
                    onChange={(e) => setIsDonatingCompute(e.target.checked)}
                    className="w-4 h-4 accent-[#D96C35] rounded"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-xs text-[#6E7568] uppercase tracking-wider">Черга P2P обчислень</h4>
                {computeTasks.map((t) => (
                  <div key={t.id} className="p-3.5 bg-white border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{t.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          t.status === 'running' ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      {t.resultSummary && (
                        <p className="text-[11px] text-emerald-700 mt-1 font-mono">{t.resultSummary}</p>
                      )}
                    </div>
                    {t.status !== 'completed' && t.status !== 'running' && (
                      <button
                        onClick={() => handleRunTask(t.id)}
                        className="p-1.5 text-[#D96C35] hover:bg-[#FDF5ED] rounded-lg transition-colors"
                        title="Виконати"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#6E7568] uppercase tracking-wider">Підключені P2P Mesh Вузли</h4>
              {nodes.map((n) => (
                <div key={n.nodeId} className="p-3.5 bg-white border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3] text-[#D96C35]">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{n.name}</h5>
                      <p className="text-[11px] text-[#6E7568]">
                        RTT: {n.pingMs}ms · Hop count: {n.dtnHopCount} · Compute shares: {n.computeShares}
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Онлайн
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Zero-Knowledge обчислення у WebAssembly пісочниці</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#EFE9DC] text-[#21261F] font-medium rounded-lg hover:bg-[#E5DEC9] transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
