import React, { useState } from 'react';
import {
  Cpu,
  ShieldCheck,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ComputeNode {
  id: string;
  name: string;
  hardware: string;
  powerTFLOPS: number;
  availableForGroup: boolean;
  status: 'Idle' | 'Compiling' | 'Rendering';
}

interface BackupShard {
  id: string;
  holderNode: string;
  shardIndex: string;
  status: 'Synced' | 'Verifying';
  lastPing: string;
}

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

  const nodes: ComputeNode[] = [
    { id: 'n1', name: 'Кирило (Radxa RK3588 NPU)', hardware: '8-core ARM64 + 6 TOPS NPU', powerTFLOPS: 1.2, availableForGroup: true, status: 'Idle' },
    { id: 'n2', name: 'Саня (RTX 4090 Workstation)', hardware: 'NVIDIA RTX 4090 24GB', powerTFLOPS: 82.6, availableForGroup: true, status: 'Rendering' },
    { id: 'n3', name: 'Марина (Apple M2 Max)', hardware: '12-core CPU / 38-core GPU', powerTFLOPS: 13.4, availableForGroup: true, status: 'Compiling' },
  ];

  const shards: BackupShard[] = [
    { id: 's1', holderNode: 'Саня (Node #319)', shardIndex: 'Shard 1/3 (Encrypted)', status: 'Synced', lastPing: '2 хв тому' },
    { id: 's2', holderNode: 'Марина (Node #842)', shardIndex: 'Shard 2/3 (Encrypted)', status: 'Synced', lastPing: '5 хв тому' },
    { id: 's3', holderNode: 'Офісний сервер Radxa', shardIndex: 'Shard 3/3 (Encrypted)', status: 'Synced', lastPing: 'Щойно' },
  ];

  if (!isOpen) return null;

  const totalCompute = nodes.reduce((acc, curr) => acc + curr.powerTFLOPS, 0).toFixed(1);

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
                Team Backup ({shards.length} шарди)
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
          {/* TAB 1: Compute Pool */}
          {activeTab === 'compute' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-indigo-900 font-semibold">Сумарна обчислювальна потужність групи:</span>
                  <p className="font-mono font-bold text-2xl text-indigo-950 mt-0.5">{totalCompute} TFLOPS</p>
                </div>
                <span className="text-xs font-bold text-indigo-800 bg-white px-3 py-1.5 rounded-xl border border-indigo-200 shadow-2xs">
                  Локальна LLM & Рендер готові
                </span>
              </div>

              <div className="space-y-2.5">
                {nodes.map((n) => (
                  <div key={n.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{n.name}</span>
                        <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                          {n.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">{n.hardware}</p>
                    </div>

                    <div className="text-right">
                      <span className="font-mono font-bold text-xs text-[#D96C35]">{n.powerTFLOPS} TFLOPS</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Ділитися незадіяними ресурсами NPU/GPU</h5>
                  <p className="text-[11px] text-[#6E7568]">Дозволяє команді запускати компіляцію та локальні моделі</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsDonatingCompute(!isDonatingCompute);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    isDonatingCompute ? 'bg-[#D96C35]' : 'bg-[#D5CEBF]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isDonatingCompute ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Shamir Backup */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Розподілене резервування (Friends & Team Backup / Shamir)</span>
                </div>
                <p className="leading-relaxed">
                  Ваші зашифровані бекапи розбиваються на $k$-з-$n$ шардів і зберігаються на вузлах довірених контактів. Жоден із них не може прочитати вміст, але при втраті вашого пристрою ви відновлюєте простір за 2 з 3 часток.
                </p>
              </div>

              <div className="space-y-2.5">
                {shards.map((s) => (
                  <div key={s.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{s.holderNode}</h5>
                      <p className="font-mono text-[10px] text-[#6E7568]">{s.shardIndex}</p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {s.status}
                      </span>
                      <span className="block text-[9px] text-[#8A9186] mt-0.5">{s.lastPing}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Distributed Sovereign Cloud</span>
          <span className="font-mono">P2P Sharding v3</span>
        </div>
      </div>
    </div>
  );
};
