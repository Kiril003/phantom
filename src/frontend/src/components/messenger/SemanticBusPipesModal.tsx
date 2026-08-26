import React, { useState } from 'react';
import {
  Terminal,
  Activity,
  Play,
  X,
  Server,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface LiveDataPipe {
  id: string;
  name: string;
  source: 'stdout' | 'WebSocket' | 'Linux FIFO Pipe (/dev/pht_pipe)';
  targetCell: string;
  status: 'Streaming' | 'Paused';
  currentValue: string;
  ratePerSec: string;
}

interface RpcService {
  id: string;
  targetNode: string;
  serviceName: string;
  command: string;
  lastExecution: string;
  status: 'Ready' | 'Executing' | 'Idle';
}

interface SemanticBusPipesModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SemanticBusPipesModal: React.FC<SemanticBusPipesModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Простір',
}) => {
  const [activeTab, setActiveTab] = useState<'pipes' | 'rpc'>('pipes');
  const [rpcExecutingId, setRpcExecutingId] = useState<string | null>(null);

  const [pipes] = useState<LiveDataPipe[]>([
    {
      id: 'p1',
      name: 'Cargo Build Output Stream',
      source: 'stdout',
      targetCell: 'Canvas Block #7 (Build Status)',
      status: 'Streaming',
      currentValue: 'Compiling phantom-engine v0.4.2 [38/42 crates]...',
      ratePerSec: '12 evt/s',
    },
    {
      id: 'p2',
      name: 'Radxa RK3588 NPU Telemetry',
      source: 'Linux FIFO Pipe (/dev/pht_pipe)',
      targetCell: 'Data Grid Col "NPU_Load"',
      status: 'Streaming',
      currentValue: 'NPU Load: 44.2% · Temp: 48.5°C · 6 TOPS',
      ratePerSec: '1 evt/s',
    },
    {
      id: 'p3',
      name: 'P2P Gossipsub Mesh Telemetry',
      source: 'WebSocket',
      targetCell: 'Header Status Pill',
      status: 'Streaming',
      currentValue: '8 peers connected · RTT 14ms',
      ratePerSec: '2 evt/s',
    },
  ]);

  const [rpcServices, setRpcServices] = useState<RpcService[]>([
    {
      id: 'r1',
      targetNode: 'Саня (RTX 4090 Workstation)',
      serviceName: 'Blender 3D CLI High-Poly Preview',
      command: 'blender -b asset_mesh.blend -f 1 --optix',
      lastExecution: '5 хв тому (0.8с)',
      status: 'Ready',
    },
    {
      id: 'r2',
      targetNode: 'Марина (M2 Max Server)',
      serviceName: 'Rust Cross-Compiler (ARM64 / x86_64)',
      command: 'cargo build --target aarch64-unknown-linux-musl --release',
      lastExecution: '12 хв тому (4.2с)',
      status: 'Ready',
    },
  ]);

  if (!isOpen) return null;

  const handleExecuteRpc = (id: string) => {
    soundFx.playSend();
    setRpcExecutingId(id);
    setTimeout(() => {
      setRpcExecutingId(null);
      setRpcServices((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, lastExecution: 'Щойно (0.6с, результат отримано)' } : s
        )
      );
    }, 1200);
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
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Semantic Bus & Event Fabric (Live Data Pipes & RPC)
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Потоки даних stdout/FIFO та віддалені RPC виклики між вузлами
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('pipes')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'pipes' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Live Data Pipes
              </button>
              <button
                onClick={() => setActiveTab('rpc')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'rpc' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                P2P RPC Мікросервіси
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Live Data Pipes */}
          {activeTab === 'pipes' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Terminal className="w-4 h-4 text-indigo-600" />
                  <span>Пряма трансляція системних процесів у Canvas / Таблиці</span>
                </div>
                <span className="font-mono font-bold">0 re-render lag</span>
              </div>

              <div className="space-y-3">
                {pipes.map((pipe) => (
                  <div key={pipe.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{pipe.name}</span>
                        <span className="text-[10px] font-mono text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded border border-[#E5DEC9]">
                          {pipe.source}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        ● {pipe.ratePerSec}
                      </span>
                    </div>

                    <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[11px] text-[#21261F]">
                      {pipe.currentValue}
                    </div>

                    <div className="text-[10px] text-[#8A9186]">
                      Цільова комірка: <span className="text-[#6E7568] font-semibold">{pipe.targetCell}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: P2P RPC */}
          {activeTab === 'rpc' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Server className="w-4 h-4 text-emerald-600" />
                  <span>Віддалений виклик процедур (E2EE P2P RPC Channel)</span>
                </div>
                <p className="leading-relaxed">
                  Викликайте дозволені мікросервіси та важкі задачі на вузлах партнерів по захищеному наскрізному каналу без потреби в публічних API чи сторонніх хмарах.
                </p>
              </div>

              <div className="space-y-3">
                {rpcServices.map((rpc) => (
                  <div key={rpc.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="font-bold text-xs text-[#21261F]">{rpc.serviceName}</h5>
                        <p className="text-[11px] text-[#6E7568]">Вузол: {rpc.targetNode}</p>
                      </div>

                      <button
                        onClick={() => handleExecuteRpc(rpc.id)}
                        disabled={rpcExecutingId === rpc.id}
                        className="px-3.5 py-1.5 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                      >
                        <Play className={`w-3 h-3 ${rpcExecutingId === rpc.id ? 'animate-spin' : ''}`} />
                        <span>{rpcExecutingId === rpc.id ? 'Виконання...' : 'Викликати RPC'}</span>
                      </button>
                    </div>

                    <div className="p-2 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[10px] text-[#6E7568]">
                      $ {rpc.command}
                    </div>

                    <div className="text-[10px] text-[#8A9186] flex justify-between">
                      <span>Статус: {rpc.status}</span>
                      <span className="font-mono">{rpc.lastExecution}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Semantic Bus Event Fabric</span>
          <span className="font-mono">P2P RPC Protocol v3.4</span>
        </div>
      </div>
    </div>
  );
};
